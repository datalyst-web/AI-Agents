import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isRouteOpenWhileLapsed, isSubscriptionLapsed } from "../lib/subscriptionAccess.js";

vi.mock("../env.js", () => ({ env: { JWT_SECRET: "test-secret-that-is-long-enough-000000", JWT_ISSUER: "test", JWT_EXPIRY: "1h" } }));

// Stands in for the database: tenant id -> subscription row. "boom" throws.
const tenants = new Map<string, { subscriptionState: string; trialEndsAt: Date | null } | "boom">();
vi.mock("@chat-agent/db", () => ({
  withTenant: async (_prisma: unknown, { tenantId }: { tenantId: string }, fn: (tx: unknown) => unknown) => {
    const row = tenants.get(tenantId);
    if (row === "boom") throw new Error("database unavailable");
    return fn({ tenant: { findUnique: async () => row ?? null } });
  },
}));

const { default: authPlugin } = await import("./auth.js");

const DAY = 24 * 60 * 60 * 1000;
const ids = {
  active: "11111111-1111-4111-8111-111111111111",
  trialOk: "22222222-2222-4222-8222-222222222222",
  trialOver: "33333333-3333-4333-8333-333333333333",
  suspended: "44444444-4444-4444-8444-444444444444",
  cancelled: "55555555-5555-4555-8555-555555555555",
  pastDue: "66666666-6666-4666-8666-666666666666",
  broken: "77777777-7777-4777-8777-777777777777",
};

const app = Fastify();
beforeAll(async () => {
  tenants.set(ids.active, { subscriptionState: "ACTIVE", trialEndsAt: null });
  tenants.set(ids.trialOk, { subscriptionState: "TRIAL", trialEndsAt: new Date(Date.now() + 5 * DAY) });
  tenants.set(ids.trialOver, { subscriptionState: "TRIAL", trialEndsAt: new Date(Date.now() - DAY) });
  tenants.set(ids.suspended, { subscriptionState: "SUSPENDED", trialEndsAt: null });
  tenants.set(ids.cancelled, { subscriptionState: "CANCELLED", trialEndsAt: null });
  tenants.set(ids.pastDue, { subscriptionState: "PAST_DUE", trialEndsAt: null });
  tenants.set(ids.broken, "boom");

  await app.register(authPlugin, { prisma: {} as never });
  const ok = async () => ({ ok: true });
  for (const url of [
    "/v1/tenants/:tenantId/agents",
    "/v1/tenants/:tenantId/billing/plans",
    "/v1/tenants/:tenantId/usage/summary",
    "/v1/tenants/:tenantId/support-tickets",
    "/v1/auth/me",
  ]) {
    app.get(url, { preHandler: [app.authenticate] }, ok);
  }
  await app.ready();
});
afterAll(() => app.close());

async function call(url: string, claims: { role: string; tenantId?: string }) {
  const token = app.jwt.sign({ sub: "user-1", ...claims } as never);
  const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  return { status: res.statusCode, body: res.json() };
}

describe("lapsed-subscription lock (plugins/auth.ts)", () => {
  it("lets active, in-trial and past-due clients use everything", async () => {
    for (const id of [ids.active, ids.trialOk, ids.pastDue]) {
      expect((await call(`/v1/tenants/${id}/agents`, { role: "tenant_owner", tenantId: id })).status).toBe(200);
    }
  });

  it("locks a client whose trial ran out, or who is suspended or cancelled, with 402", async () => {
    for (const id of [ids.trialOver, ids.suspended, ids.cancelled]) {
      const res = await call(`/v1/tenants/${id}/agents`, { role: "tenant_member", tenantId: id });
      expect(res.status).toBe(402);
      expect(res.body.error).toBe("subscription_required");
      expect(res.body.message).toMatch(/Billing page/);
    }
  });

  it("keeps billing, usage, support and /me open to a locked client so they can pay or get help", async () => {
    for (const path of ["billing/plans", "usage/summary", "support-tickets"]) {
      expect((await call(`/v1/tenants/${ids.suspended}/${path}`, { role: "tenant_owner", tenantId: ids.suspended })).status).toBe(200);
    }
    expect((await call("/v1/auth/me", { role: "tenant_owner", tenantId: ids.suspended })).status).toBe(200);
  });

  it("never locks staff, even while they manage a lapsed client", async () => {
    expect((await call(`/v1/tenants/${ids.cancelled}/agents`, { role: "platform_admin" })).status).toBe(200);
    expect((await call(`/v1/tenants/${ids.cancelled}/agents`, { role: "setup_specialist", tenantId: ids.cancelled })).status).toBe(200);
  });

  it("fails open if the subscription lookup itself errors", async () => {
    expect((await call(`/v1/tenants/${ids.broken}/agents`, { role: "tenant_owner", tenantId: ids.broken })).status).toBe(200);
  });

  it("still rejects a missing or forged token before any of this", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/tenants/${ids.active}/agents`, headers: { authorization: "Bearer nope" } });
    expect(res.statusCode).toBe(401);
  });
});

describe("isSubscriptionLapsed", () => {
  const now = new Date("2026-09-22T12:00:00Z");
  it("treats the trial end date as the truth even before the sweep suspends the tenant", () => {
    expect(isSubscriptionLapsed({ subscriptionState: "TRIAL", trialEndsAt: new Date("2026-09-22T11:59:59Z") }, now)).toBe(true);
    expect(isSubscriptionLapsed({ subscriptionState: "TRIAL", trialEndsAt: "2026-09-23T00:00:00Z" }, now)).toBe(false);
    expect(isSubscriptionLapsed({ subscriptionState: "TRIAL", trialEndsAt: null }, now)).toBe(false);
  });
  it("does not lock a past-due account during its grace period", () => {
    expect(isSubscriptionLapsed({ subscriptionState: "PAST_DUE", trialEndsAt: null }, now)).toBe(false);
  });
});

describe("isRouteOpenWhileLapsed", () => {
  it("matches registered route patterns only", () => {
    expect(isRouteOpenWhileLapsed("/v1/tenants/:tenantId/billing/checkout")).toBe(true);
    expect(isRouteOpenWhileLapsed("/v1/tenants/:tenantId/agents")).toBe(false);
    expect(isRouteOpenWhileLapsed(undefined)).toBe(false);
  });
});
