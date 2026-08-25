import { describe, it, expect, beforeAll, vi } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Regression coverage for the billing webhook HMAC fix: signatures must be
 * verified against the exact raw request bytes (captured via a custom
 * content-type parser), never a JSON.stringify() re-serialization of the
 * parsed body, which can reorder keys/change whitespace and either break
 * verification against a real provider or make it trivially bypassable.
 *
 * env.js validates process.env eagerly at import time (DATABASE_URL,
 * JWT_SECRET are required), so the env vars this test needs are set before
 * dynamically importing registerBillingRoutes — a static top-level import
 * would run env validation before this file gets a chance to configure it.
 */

const WEBHOOK_SECRET = "test-billing-webhook-secret";

let registerBillingRoutes: typeof import("./billing.routes.js").registerBillingRoutes;

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/test";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real";
  process.env.BILLING_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  ({ registerBillingRoutes } = await import("./billing.routes.js"));
});

function sign(rawBody: Buffer, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** A fake AppContext exposing just enough of `prisma` for withPlatformContext(). */
function fakeCtx(spies?: { tenantUpdate?: ReturnType<typeof vi.fn>; billingLineItemCreate?: ReturnType<typeof vi.fn> }) {
  const tx = {
    $executeRaw: vi.fn(async () => undefined),
    tenant: { update: spies?.tenantUpdate ?? vi.fn(async () => ({})) },
    billingLineItem: { create: spies?.billingLineItemCreate ?? vi.fn(async () => ({})) },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { ctx: { prisma } as any, tx };
}

async function buildApp(ctx: any): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerBillingRoutes(app, ctx);
  await app.ready();
  return app;
}

describe("POST /v1/billing/webhook — signature verification", () => {
  it("accepts a request with a correct HMAC over the exact raw bytes", async () => {
    const tenantUpdate = vi.fn(async () => ({}));
    const { ctx } = fakeCtx({ tenantUpdate });
    const app = await buildApp(ctx);

    const tenantId = randomUUID();
    const rawBody = Buffer.from(
      JSON.stringify({
        type: "subscription.updated",
        tenantId,
        data: { newSubscriptionState: "SUSPENDED" },
      }),
      "utf8",
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "x-billing-signature": sign(rawBody) },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ received: true });
    expect(tenantUpdate).toHaveBeenCalledTimes(1);
    expect(tenantUpdate.mock.calls[0][0]).toMatchObject({
      where: { id: tenantId },
      data: { subscriptionState: "SUSPENDED" },
    });

    await app.close();
  });

  it("rejects a request with a wrong signature", async () => {
    const { ctx } = fakeCtx();
    const app = await buildApp(ctx);

    const rawBody = Buffer.from(
      JSON.stringify({ type: "subscription.updated", tenantId: randomUUID(), data: {} }),
      "utf8",
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "x-billing-signature": "0".repeat(64) },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: "invalid_signature" });

    await app.close();
  });

  it("rejects a tampered payload even though it carries a validly-formed signature for the ORIGINAL payload", async () => {
    const { ctx } = fakeCtx();
    const app = await buildApp(ctx);

    const originalBody = Buffer.from(
      JSON.stringify({ type: "subscription.updated", tenantId: randomUUID(), data: {} }),
      "utf8",
    );
    const signatureForOriginal = sign(originalBody);

    // Attacker swaps in a different tenantId after the signature was computed.
    const tamperedBody = Buffer.from(
      JSON.stringify({ type: "subscription.updated", tenantId: randomUUID(), data: {} }),
      "utf8",
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json", "x-billing-signature": signatureForOriginal },
      payload: tamperedBody,
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("rejects a request with no signature header at all", async () => {
    const { ctx } = fakeCtx();
    const app = await buildApp(ctx);

    const rawBody = Buffer.from(JSON.stringify({ type: "x", tenantId: randomUUID(), data: {} }), "utf8");

    const res = await app.inject({
      method: "POST",
      url: "/v1/billing/webhook",
      headers: { "content-type": "application/json" },
      payload: rawBody,
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });
});
