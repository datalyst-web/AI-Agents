import { describe, it, expect, beforeAll } from "vitest";
import jwt from "jsonwebtoken";
import type { FastifyRequest } from "fastify";

// app.ts imports env.js at module scope — same timing gotcha as
// agentLoop.ts's tests.
let rateLimitKey: typeof import("./app.js").rateLimitKey;
const JWT_SECRET = "test-jwt-secret-not-real-0123456789";

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  ({ rateLimitKey } = await import("./app.js"));
});

function fakeRequest(opts: { authorization?: string; ip?: string }): FastifyRequest {
  return { headers: { authorization: opts.authorization }, ip: opts.ip ?? "203.0.113.5" } as unknown as FastifyRequest;
}

/**
 * Regression coverage for the per-tenant rate-limit gap: previously every
 * request shared one bucket per client IP regardless of tenant, so (a) a
 * popular tenant's widget traffic spread across many customer IPs was
 * never actually limited "as a tenant," and (b) unrelated tenants/staff
 * sharing one IP (a shared office network, a corporate NAT) shared a
 * single bucket unfairly.
 */
describe("rateLimitKey", () => {
  it("buckets a dashboard session's request by tenantId, not IP", () => {
    const token = jwt.sign({ sub: "user-1", tenantId: "tenant-a", role: "tenant_owner" }, JWT_SECRET);
    const request = fakeRequest({ authorization: `Bearer ${token}` });
    expect(rateLimitKey(request)).toBe("tenant:tenant-a");
  });

  it("buckets a widget token's request by tenantId too (same JWT shape, different claims)", () => {
    const token = jwt.sign({ tenantId: "tenant-b", agentId: "agent-1" }, JWT_SECRET, { audience: "chat-widget" });
    const request = fakeRequest({ authorization: `Bearer ${token}` });
    expect(rateLimitKey(request)).toBe("tenant:tenant-b");
  });

  it("two different tenants get two different buckets even from the same IP", () => {
    const tokenA = jwt.sign({ tenantId: "tenant-a", role: "tenant_owner" }, JWT_SECRET);
    const tokenB = jwt.sign({ tenantId: "tenant-b", role: "tenant_owner" }, JWT_SECRET);
    const sameIp = "198.51.100.1";
    expect(rateLimitKey(fakeRequest({ authorization: `Bearer ${tokenA}`, ip: sameIp }))).not.toBe(
      rateLimitKey(fakeRequest({ authorization: `Bearer ${tokenB}`, ip: sameIp })),
    );
  });

  it("falls back to IP for a staff session mid-impersonation (JWT deliberately carries no tenantId)", () => {
    const token = jwt.sign({ sub: "staff-1", role: "setup_specialist", impersonation: { staffUserId: "staff-1", sessionId: "s1", expiresAt: "2099-01-01" } }, JWT_SECRET);
    const request = fakeRequest({ authorization: `Bearer ${token}`, ip: "203.0.113.9" });
    expect(rateLimitKey(request)).toBe("ip:203.0.113.9");
  });

  it("falls back to IP with no Authorization header at all (login, signup)", () => {
    expect(rateLimitKey(fakeRequest({ ip: "203.0.113.20" }))).toBe("ip:203.0.113.20");
  });

  it("falls back to IP for a malformed/garbage Bearer token rather than throwing", () => {
    const request = fakeRequest({ authorization: "Bearer not-a-real-jwt-at-all", ip: "203.0.113.30" });
    expect(() => rateLimitKey(request)).not.toThrow();
    expect(rateLimitKey(request)).toBe("ip:203.0.113.30");
  });
});
