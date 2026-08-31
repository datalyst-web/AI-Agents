import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { initiateWebPayment, initiateMobilePayment, verifyAndParseStatusUpdate, isPaidStatus } from "../lib/paynow.js";
import { env } from "../env.js";

/**
 * Fixed, server-side subscription pricing (USD/month) — a checkout request
 * only ever names WHICH tier to buy, never an amount; the amount actually
 * charged always comes from here, never from the request body. Letting a
 * client-supplied amount reach Paynow would let anyone pay whatever they
 * want for a subscription. ENTERPRISE has no self-serve price on purpose —
 * that tier is quoted and set up by staff, not bought through this flow.
 *
 * These are placeholder launch prices — confirm/adjust before relying on
 * this for real revenue.
 */
const SUBSCRIPTION_PRICING_USD: Partial<Record<"STARTER" | "GROWTH" | "SCALE", string>> = {
  STARTER: "49.00",
  GROWTH: "149.00",
  SCALE: "399.00",
};

const CheckoutSchema = z.object({ tier: z.enum(["STARTER", "GROWTH", "SCALE"]) });
const MobileCheckoutSchema = CheckoutSchema.extend({
  phone: z.string().min(9).max(15),
  method: z.enum(["ecocash", "onemoney"]),
});

/**
 * No human ever initiates a "payment confirmed" audit entry — Paynow's
 * webhook does, once its hash verifies. Same well-known all-zero sentinel
 * pattern as agentLoop.ts's SYSTEM_AGENT_ACTOR_ID for the same reason: no
 * User row exists for "the payment gateway told us this happened."
 */
const SYSTEM_PAYNOW_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

const PERIOD_DAYS = 30;

export async function registerPaynowBillingRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get(
    "/v1/tenants/:tenantId/billing/plans",
    { preHandler: [...scoped, requirePermission("billing:read")] },
    async (request) => {
      const tenant = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.tenant.findUniqueOrThrow({ where: { id: request.tenantCtx!.tenantId }, select: { subscriptionTier: true, subscriptionState: true } }),
      );
      return {
        currentTier: tenant.subscriptionTier,
        currentState: tenant.subscriptionState,
        plans: Object.entries(SUBSCRIPTION_PRICING_USD).map(([tier, priceUsd]) => ({ tier, priceUsd })),
        paynowConfigured: Boolean(env.PAYNOW_INTEGRATION_ID && env.PAYNOW_INTEGRATION_KEY),
      };
    },
  );

  app.get(
    "/v1/tenants/:tenantId/billing/payments",
    { preHandler: [...scoped, requirePermission("billing:read")] },
    async (request) => {
      return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.paynowPayment.findMany({
          where: { tenantId: request.tenantCtx!.tenantId },
          orderBy: { createdAt: "desc" },
          take: 20,
        }),
      );
    },
  );

  app.get(
    "/v1/tenants/:tenantId/billing/payments/:reference",
    { preHandler: [...scoped, requirePermission("billing:read")] },
    async (request, reply) => {
      const { reference } = request.params as { reference: string };
      const payment = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.paynowPayment.findFirst({ where: { tenantId: request.tenantCtx!.tenantId, reference } }),
      );
      if (!payment) {
        reply.code(404).send({ error: "payment_not_found" });
        return;
      }
      reply.send(payment);
    },
  );

  app.post(
    "/v1/tenants/:tenantId/billing/checkout",
    { preHandler: [...scoped, requirePermission("billing:write")] },
    async (request, reply) => {
      const { tier } = CheckoutSchema.parse(request.body);
      const priceUsd = SUBSCRIPTION_PRICING_USD[tier];
      if (!priceUsd) {
        reply.code(400).send({ error: "no_self_serve_price", message: `${tier} has no self-serve price — contact us to set this tier up.` });
        return;
      }
      if (!env.PAYNOW_INTEGRATION_ID || !env.PAYNOW_INTEGRATION_KEY) {
        reply.code(503).send({ error: "paynow_not_configured" });
        return;
      }

      const { reference, description, authEmail } = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: request.tenantCtx!.tenantId } });
        const owner = await tx.user.findFirst({ where: { tenantId: request.tenantCtx!.tenantId, role: "tenant_owner" } });
        const reference = `sub-${tenant.slug}-${randomUUID().slice(0, 8)}`;
        const description = `${tier} plan — ${tenant.name}`;
        const periodStart = new Date();
        const periodEnd = new Date(periodStart.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
        await tx.paynowPayment.create({
          data: {
            tenantId: tenant.id,
            reference,
            skuType: "SUBSCRIPTION",
            description,
            amountUsd: priceUsd,
            subscriptionTier: tier,
            periodStart,
            periodEnd,
            status: "PENDING",
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          action: "billing_checkout_initiated",
          metadata: { reference, tier, amountUsd: priceUsd },
        });
        return { reference, description, authEmail: owner?.email ?? request.authUser!.sub };
      });

      const result = await initiateWebPayment({ reference, amountUsd: priceUsd, description, authEmail });
      if (!result.ok) {
        reply.code(502).send({ error: "paynow_checkout_failed", message: result.error });
        return;
      }
      reply.send({ reference, redirectUrl: result.redirectUrl });
    },
  );

  app.post(
    "/v1/tenants/:tenantId/billing/checkout/mobile",
    { preHandler: [...scoped, requirePermission("billing:write")] },
    async (request, reply) => {
      const { tier, phone, method } = MobileCheckoutSchema.parse(request.body);
      const priceUsd = SUBSCRIPTION_PRICING_USD[tier];
      if (!priceUsd) {
        reply.code(400).send({ error: "no_self_serve_price", message: `${tier} has no self-serve price — contact us to set this tier up.` });
        return;
      }
      if (!env.PAYNOW_INTEGRATION_ID || !env.PAYNOW_INTEGRATION_KEY) {
        reply.code(503).send({ error: "paynow_not_configured" });
        return;
      }

      const { reference, description, authEmail } = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: request.tenantCtx!.tenantId } });
        const owner = await tx.user.findFirst({ where: { tenantId: request.tenantCtx!.tenantId, role: "tenant_owner" } });
        const reference = `sub-${tenant.slug}-${randomUUID().slice(0, 8)}`;
        const description = `${tier} plan — ${tenant.name}`;
        const periodStart = new Date();
        const periodEnd = new Date(periodStart.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
        await tx.paynowPayment.create({
          data: {
            tenantId: tenant.id,
            reference,
            skuType: "SUBSCRIPTION",
            description,
            amountUsd: priceUsd,
            subscriptionTier: tier,
            periodStart,
            periodEnd,
            status: "PENDING",
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          action: "billing_checkout_initiated",
          metadata: { reference, tier, amountUsd: priceUsd, method },
        });
        return { reference, description, authEmail: owner?.email ?? request.authUser!.sub };
      });

      const result = await initiateMobilePayment({ reference, amountUsd: priceUsd, description, authEmail, phone, method });
      if (!result.ok) {
        reply.code(502).send({ error: "paynow_checkout_failed", message: result.error });
        return;
      }
      reply.send({ reference, instructions: result.instructions });
    },
  );

  /**
   * Public — Paynow calls this server-to-server (the "result URL"), no
   * dashboard session involved. This is the ONLY source of truth for
   * "did this actually get paid" — the customer's browser redirect back to
   * /billing (the "return URL") is not verified and must never be treated
   * as proof of payment on its own; it only tells the dashboard which
   * reference to poll /billing/payments/:reference for.
   *
   * Fastify has no built-in application/x-www-form-urlencoded parser (only
   * JSON/text by default), so this route registers its own — scoped to
   * just this route via Fastify's plugin encapsulation, same pattern as
   * the Meta channel webhook and the old billing webhook's raw-JSON
   * parser. Kept as the raw string (not parsed into an object first) since
   * hash verification needs to walk the fields in the exact order Paynow
   * sent them.
   */
  await app.register(async (webhookScope) => {
    webhookScope.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
      done(null, body);
    });

    webhookScope.post("/v1/billing/paynow/webhook", async (request, reply) => {
      const rawFormBody = request.body as string;
      const update = verifyAndParseStatusUpdate(rawFormBody);
      if (!update) {
        // Always 200 — Paynow doesn't retry on non-2xx the way some
        // webhooks do, but there's no reason to hint anything to a prober
        // either way. A failed-verification call is logged server-side via
        // the request logger, not surfaced to the caller.
        request.log.warn("paynow webhook hash verification failed");
        reply.code(200).send({ received: true });
        return;
      }

      await withPlatformContext(ctx.prisma, async (tx) => {
        const payment = await tx.paynowPayment.findFirst({ where: { reference: update.reference } });
        if (!payment) return;
        // Idempotent — Paynow can call the result URL more than once for
        // the same transaction; never double-create a BillingLineItem or
        // re-fire the subscription-activation side effects for a payment
        // already recorded as PAID.
        if (payment.status === "PAID") return;

        const newStatus = isPaidStatus(update.status) ? "PAID" : update.status.toLowerCase() === "cancelled" ? "CANCELLED" : payment.status;

        await withTenant(ctx.prisma, { tenantId: payment.tenantId }, async (tenantTx) => {
          await tenantTx.paynowPayment.update({
            where: { id: payment.id },
            data: { status: newStatus, paynowReference: update.paynowReference, pollUrl: update.pollUrl ?? payment.pollUrl },
          });

          if (newStatus === "PAID") {
            await tenantTx.billingLineItem.create({
              data: {
                tenantId: payment.tenantId,
                skuType: payment.skuType,
                description: payment.description,
                amountUsd: payment.amountUsd,
                periodStart: payment.periodStart ?? payment.createdAt,
                periodEnd: payment.periodEnd ?? payment.createdAt,
              },
            });
            if (payment.subscriptionTier) {
              await tenantTx.tenant.update({
                where: { id: payment.tenantId },
                data: { subscriptionState: "ACTIVE", subscriptionTier: payment.subscriptionTier },
              });
            }
            await writeAuditLog(tenantTx, { tenantId: payment.tenantId }, {
              actorUserId: SYSTEM_PAYNOW_ACTOR_ID,
              action: "billing_payment_confirmed",
              metadata: { reference: payment.reference, paynowReference: update.paynowReference, amountUsd: payment.amountUsd.toString() },
            });
          }
        });
      });

      reply.code(200).send({ received: true });
    });
  });
}
