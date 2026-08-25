import { createHmac, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { env } from "../env.js";

const WebhookEventSchema = z.object({
  type: z.string(),
  tenantId: z.string().uuid(),
  data: z.object({
    skuType: z.enum(["SUBSCRIPTION", "AI_INFERENCE_OVERAGE", "MANAGED_SETUP_ONE_TIME", "MANAGED_SETUP_RECURRING_MAINTENANCE"]).optional(),
    description: z.string().optional(),
    amountUsd: z.number().optional(),
    periodStart: z.string().datetime().optional(),
    periodEnd: z.string().datetime().optional(),
    newSubscriptionState: z.enum(["ACTIVE", "TRIAL", "PAST_DUE", "SUSPENDED", "CANCELLED"]).optional(),
  }),
});

function verifySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signatureHeader);
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * Billing provider webhook (Stripe or equivalent) — proxied, never exposed
 * to clients directly (CLAUDE.md Security Requirements). HMAC verification
 * needs the byte-for-byte raw request body — a provider's signature is
 * computed over the exact bytes it sent, and re-serializing the parsed
 * body via JSON.stringify can reorder keys/change whitespace/encoding,
 * which breaks verification against a real provider (or makes it trivially
 * bypassable). So this route registers its own content-type parser, scoped
 * to just this route via Fastify's plugin encapsulation (app.register
 * creates a child context — addContentTypeParser here does NOT affect JSON
 * parsing anywhere else in the app), that captures the raw buffer before
 * parsing it as JSON. On subscription expiry the tenant is SUSPENDED, never
 * deleted, per CLAUDE.md's Client Lifecycle section — the actual
 * inbound-request fallback lives in chat.routes.ts, which checks
 * subscriptionState before processing a turn.
 */
export async function registerBillingRoutes(app: FastifyInstance, ctx: AppContext) {
  await app.register(async function billingWebhookScope(instance) {
    instance.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
      request.rawBody = body as Buffer;
      if (body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString("utf8")));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    instance.post("/v1/billing/webhook", async (request, reply) => {
      if (!env.BILLING_WEBHOOK_SECRET) {
        reply.code(503).send({ error: "billing_webhook_not_configured" });
        return;
      }
      const signature = request.headers["x-billing-signature"] as string | undefined;
      if (!request.rawBody || !verifySignature(request.rawBody, signature, env.BILLING_WEBHOOK_SECRET)) {
        reply.code(401).send({ error: "invalid_signature" });
        return;
      }

      const event = WebhookEventSchema.parse(request.body);

      await withPlatformContext(ctx.prisma, async (tx) => {
        if (event.data.newSubscriptionState) {
          await tx.tenant.update({
            where: { id: event.tenantId },
            data: { subscriptionState: event.data.newSubscriptionState },
          });
        }
        if (event.data.skuType && event.data.amountUsd !== undefined && event.data.periodStart && event.data.periodEnd) {
          await tx.billingLineItem.create({
            data: {
              id: randomUUID(),
              tenantId: event.tenantId,
              skuType: event.data.skuType,
              description: event.data.description ?? event.type,
              amountUsd: event.data.amountUsd,
              periodStart: new Date(event.data.periodStart),
              periodEnd: new Date(event.data.periodEnd),
            },
          });
        }
      });

      reply.send({ received: true });
    });
  });
}
