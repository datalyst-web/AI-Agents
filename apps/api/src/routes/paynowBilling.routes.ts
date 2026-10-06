import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { withTenant, withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { recordSubscriptionStateChange } from "../lib/subscriptionHistory.js";
import { PLAN_PRICE_USD, SELF_CHECKOUT_TIERS, planPrice, provisionUsageLimits } from "../lib/planLimits.js";
import {
  initiateWebPayment,
  initiateMobilePayment,
  verifyAndParseStatusUpdate,
  isPaidStatus,
  pollPaymentStatus,
  isPaynowConfigured,
  type PaynowCurrency,
  type PaynowStatusUpdate,
} from "../lib/paynow.js";
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
// From the single price table in lib/planLimits.ts.
const SUBSCRIPTION_PRICING_USD: Partial<Record<"STARTER" | "GROWTH" | "SCALE", string>> = Object.fromEntries(
  SELF_CHECKOUT_TIERS.map((tier) => [tier, PLAN_PRICE_USD[tier].toFixed(2)]),
);

const CheckoutSchema = z.object({ tier: z.enum(["STARTER", "GROWTH", "SCALE"]), currency: z.enum(["USD", "ZWG"]).default("USD") });

function currencyUnavailable(currency: PaynowCurrency) {
  return {
    error: "paynow_not_configured",
    message: currency === "ZWG" ? "ZiG payments aren't available right now — please pay in USD." : "USD payments aren't available right now — please pay in ZiG.",
  };
}
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

/** How far back a pending payment is still worth asking Paynow about. */
const RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;
const MAX_RECONCILE_PER_LIST = 5;

/**
 * Records a hash-verified status update from Paynow — its result-URL call,
 * or our own poll of the payment's pollUrl.
 */
async function applyPaynowStatusUpdate(ctx: AppContext, update: PaynowStatusUpdate): Promise<void> {
  await withPlatformContext(ctx.prisma, async (tx) => {
    const payment = await tx.paynowPayment.findFirst({ where: { reference: update.reference } });
    if (!payment) return;
    // Signed by the other currency's integration — not an answer about this payment.
    if (payment.currency !== update.currency) return;
    // Idempotent — Paynow can call the result URL more than once for
    // the same transaction; never double-create a BillingLineItem or
    // re-fire the subscription-activation side effects for a payment
    // already recorded as PAID.
    if (payment.status === "PAID") return;

    const newStatus = isPaidStatus(update.status) ? "PAID" : update.status.toLowerCase() === "cancelled" ? "CANCELLED" : payment.status;

    await withTenant(ctx.prisma, { tenantId: payment.tenantId }, async (tenantTx) => {
      // Conditional on the status we read, so when Paynow's result-URL call
      // and our own poll land together only one of them activates the plan.
      const { count } = await tenantTx.paynowPayment.updateMany({
        where: { id: payment.id, status: payment.status },
        data: { status: newStatus, paynowReference: update.paynowReference, pollUrl: update.pollUrl ?? payment.pollUrl },
      });

      if (count === 1 && newStatus === "PAID") {
        const before = await tenantTx.tenant.findUniqueOrThrow({
          where: { id: payment.tenantId },
          select: { subscriptionState: true, paidUntil: true },
        });
        // 30 days from now, or from the end of the current period when
        // renewing early — a client never loses days they already paid for.
        const now = new Date();
        const periodStart = before.paidUntil && before.paidUntil > now ? before.paidUntil : now;
        const paidUntil = new Date(periodStart.getTime() + PERIOD_DAYS * 24 * 60 * 60 * 1000);
        await tenantTx.billingLineItem.create({
          data: {
            tenantId: payment.tenantId,
            skuType: payment.skuType,
            description: payment.description,
            amountUsd: payment.amountUsd,
            periodStart: payment.subscriptionTier ? periodStart : (payment.periodStart ?? payment.createdAt),
            periodEnd: payment.subscriptionTier ? paidUntil : (payment.periodEnd ?? payment.createdAt),
          },
        });
        if (payment.subscriptionTier) {
          await tenantTx.tenant.update({
            where: { id: payment.tenantId },
            // trialEndsAt is cleared, not left to lapse — otherwise
            // trialExpirySweep would still see a past date on a tenant
            // that has since paid.
            data: { subscriptionState: "ACTIVE", subscriptionTier: payment.subscriptionTier, trialEndsAt: null, paidUntil },
          });
          await recordSubscriptionStateChange(tenantTx, payment.tenantId, before.subscriptionState, "ACTIVE");
          // The paid plan's allowance replaces whatever trial/lower-tier
          // limits were in place — this is the moment the client starts
          // getting what they actually paid for.
          await provisionUsageLimits(tenantTx, payment.tenantId, payment.subscriptionTier, "ACTIVE");
        }
        await writeAuditLog(tenantTx, { tenantId: payment.tenantId }, {
          actorUserId: SYSTEM_PAYNOW_ACTOR_ID,
          action: "billing_payment_confirmed",
          metadata: {
            reference: payment.reference,
            paynowReference: update.paynowReference,
            amountUsd: payment.amountUsd.toString(),
            currency: payment.currency,
            amountCharged: (payment.amountCharged ?? payment.amountUsd).toString(),
          },
        });
      }
    });
  });
}

/**
 * Asks Paynow directly about a payment still PENDING here. Paynow's
 * result-URL call can be late or never arrive (seen live on the first test
 * payment), and without this a client who has paid stays locked out. The
 * poll response is hash-verified exactly like the result-URL call.
 * Returns true if the stored status may have changed.
 */
async function reconcilePendingPayment(
  ctx: AppContext,
  payment: { reference: string; status: string; pollUrl: string | null; currency: PaynowCurrency },
  log: { warn: (obj: object, msg: string) => void },
): Promise<boolean> {
  if (payment.status !== "PENDING" || !payment.pollUrl) return false;
  try {
    const update = await pollPaymentStatus(payment.pollUrl, payment.currency);
    // Only ever apply a verified answer about this exact payment.
    if (!update || update.reference !== payment.reference) return false;
    await applyPaynowStatusUpdate(ctx, update);
    return true;
  } catch (err) {
    log.warn({ err }, "paynow status poll failed");
    return false;
  }
}

export async function registerPaynowBillingRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  // Kept so the payment can be reconciled if Paynow's result-URL call never arrives.
  const savePollUrl = async (tenantCtx: NonNullable<FastifyRequest["tenantCtx"]>, reference: string, pollUrl: string | undefined) => {
    if (!pollUrl) return;
    await withTenant(ctx.prisma, tenantCtx, (tx) =>
      tx.paynowPayment.updateMany({ where: { tenantId: tenantCtx.tenantId, reference }, data: { pollUrl } }),
    );
  };

  app.get(
    "/v1/tenants/:tenantId/billing/plans",
    { preHandler: [...scoped, requirePermission("billing:read")] },
    async (request) => {
      const tenant = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.tenant.findUniqueOrThrow({
          where: { id: request.tenantCtx!.tenantId },
          select: { subscriptionTier: true, subscriptionState: true, paidUntil: true },
        }),
      );
      return {
        currentTier: tenant.subscriptionTier,
        currentState: tenant.subscriptionState,
        paidUntil: tenant.paidUntil,
        plans: SELF_CHECKOUT_TIERS.map((tier) => ({
          tier,
          priceUsd: planPrice(tier, "USD").toFixed(2),
          priceZwg: planPrice(tier, "ZWG").toFixed(2),
        })),
        currencies: { USD: isPaynowConfigured("USD"), ZWG: isPaynowConfigured("ZWG") },
        paynowConfigured: isPaynowConfigured("USD") || isPaynowConfigured("ZWG"),
      };
    },
  );

  app.get(
    "/v1/tenants/:tenantId/billing/payments",
    { preHandler: [...scoped, requirePermission("billing:read")] },
    async (request) => {
      const list = () =>
        withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
          tx.paynowPayment.findMany({
            where: { tenantId: request.tenantCtx!.tenantId },
            orderBy: { createdAt: "desc" },
            take: 20,
          }),
        );
      const payments = await list();
      const pending = payments
        .filter((p) => p.status === "PENDING" && p.pollUrl && Date.now() - p.createdAt.getTime() < RECONCILE_WINDOW_MS)
        .slice(0, MAX_RECONCILE_PER_LIST);
      if (pending.length === 0) return payments;
      const changed = await Promise.all(pending.map((p) => reconcilePendingPayment(ctx, p, request.log)));
      return changed.some(Boolean) ? list() : payments;
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
      if (await reconcilePendingPayment(ctx, payment, request.log)) {
        reply.send(
          await withTenant(ctx.prisma, request.tenantCtx!, (tx) => tx.paynowPayment.findUniqueOrThrow({ where: { id: payment.id } })),
        );
        return;
      }
      reply.send(payment);
    },
  );

  app.post(
    "/v1/tenants/:tenantId/billing/checkout",
    { preHandler: [...scoped, requirePermission("billing:write")] },
    async (request, reply) => {
      const { tier, currency } = CheckoutSchema.parse(request.body);
      const priceUsd = SUBSCRIPTION_PRICING_USD[tier];
      if (!priceUsd) {
        reply.code(400).send({ error: "no_self_serve_price", message: `${tier} has no self-serve price — contact us to set this tier up.` });
        return;
      }
      if (!isPaynowConfigured(currency)) {
        reply.code(503).send(currencyUnavailable(currency));
        return;
      }
      const amount = planPrice(tier, currency).toFixed(2);

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
            currency,
            amountCharged: amount,
            subscriptionTier: tier,
            periodStart,
            periodEnd,
            status: "PENDING",
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          action: "billing_checkout_initiated",
          metadata: { reference, tier, amountUsd: priceUsd, currency, amountCharged: amount },
        });
        return { reference, description, authEmail: owner?.email ?? request.authUser!.sub };
      });

      const result = await initiateWebPayment({ reference, amount, currency, description, authEmail });
      if (!result.ok) {
        reply.code(502).send({ error: "paynow_checkout_failed", message: result.error });
        return;
      }
      await savePollUrl(request.tenantCtx!, reference, result.pollUrl);
      reply.send({ reference, redirectUrl: result.redirectUrl });
    },
  );

  app.post(
    "/v1/tenants/:tenantId/billing/checkout/mobile",
    { preHandler: [...scoped, requirePermission("billing:write")] },
    async (request, reply) => {
      const { tier, currency, phone, method } = MobileCheckoutSchema.parse(request.body);
      const priceUsd = SUBSCRIPTION_PRICING_USD[tier];
      if (!priceUsd) {
        reply.code(400).send({ error: "no_self_serve_price", message: `${tier} has no self-serve price — contact us to set this tier up.` });
        return;
      }
      if (!isPaynowConfigured(currency)) {
        reply.code(503).send(currencyUnavailable(currency));
        return;
      }
      const amount = planPrice(tier, currency).toFixed(2);

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
            currency,
            amountCharged: amount,
            subscriptionTier: tier,
            periodStart,
            periodEnd,
            status: "PENDING",
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          action: "billing_checkout_initiated",
          metadata: { reference, tier, amountUsd: priceUsd, currency, amountCharged: amount, method },
        });
        return { reference, description, authEmail: owner?.email ?? request.authUser!.sub };
      });

      const result = await initiateMobilePayment({ reference, amount, currency, description, authEmail, phone, method });
      if (!result.ok) {
        reply.code(502).send({ error: "paynow_checkout_failed", message: result.error });
        return;
      }
      await savePollUrl(request.tenantCtx!, reference, result.pollUrl);
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

      await applyPaynowStatusUpdate(ctx, update);

      reply.code(200).send({ received: true });
    });
  });
}
