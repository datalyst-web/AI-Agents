import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Regression coverage for the RLS entry-point bug (CLAUDE.md principle 1):
 * auth.routes.ts used to call `ctx.prisma.user.findUnique/create()`
 * directly with NO withTenant/withPlatformContext wrapper at all. Since
 * `users`/`tenants` have FORCE ROW LEVEL SECURITY, every one of those calls
 * silently returned nothing (reads) or was rejected outright (writes) —
 * meaning signup, login, and /me were ALL completely non-functional
 * against a real RLS-enforced database, despite passing fine against mocks.
 * This only surfaces by actually running these routes against a real
 * RLS-enforced connection — CHAT_APP_DATABASE_URL (the `chat_app_user`
 * role), never the admin/owner URL, which would bypass RLS and mask the
 * exact bug this file exists to catch.
 *
 * env.js (via @chat-agent/config) validates process.env eagerly at import
 * time, so env vars must be set before dynamically importing the auth
 * plugin/routes — see billing.routes.test.ts for the same pattern.
 */

let registerAuthRoutes: typeof import("./auth.routes.js").registerAuthRoutes;
let authPlugin: typeof import("../plugins/auth.js").default;
let createPrismaClient: typeof import("@chat-agent/db").createPrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let prisma: import("@chat-agent/db").PrismaClient;

const createdUserEmails: string[] = [];
const createdTenantIds: string[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

  ({ registerAuthRoutes } = await import("./auth.routes.js"));
  ({ default: authPlugin } = await import("../plugins/auth.js"));
  ({ createPrismaClient, withPlatformContext } = await import("@chat-agent/db"));

  prisma = createPrismaClient(process.env.CHAT_APP_DATABASE_URL as string);
  await connectWithRetry(prisma);
});

/**
 * The free Neon instance auto-suspends when idle — the first connection can
 * fail with P1001 ("Can't reach database server") for reasons unrelated to
 * the code under test, especially when several test files race to
 * reconnect at once. Retry a couple of times with a short delay before
 * giving up for real.
 */
async function connectWithRetry(client: import("@chat-agent/db").PrismaClient, attempts = 4): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await client.$queryRaw`SELECT 1`;
      return;
    } catch (err) {
      if (i === attempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

afterAll(async () => {
  if (createdTenantIds.length) {
    await withPlatformContext(prisma, async (tx) => {
      for (const id of createdTenantIds) {
        await tx.tenant.delete({ where: { id } }).catch(() => undefined);
      }
    });
  }
  await prisma.$disconnect();
});

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(authPlugin);
  await registerAuthRoutes(app, { prisma } as never);
  await app.ready();
  return app;
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("auth routes — RLS entry-point regression (real chat_app_user connection)", () => {
  it("signup creates a tenant + user and is readable back — the exact code path FORCE RLS used to silently break", async () => {
    const app = await buildApp();
    const email = `auth-rls-test-${randomUUID()}@example.com`;
    createdUserEmails.push(email);

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS Auth Test Co", email, password: "correct-horse-battery" },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token).toBeTruthy();
    expect(body.tenant.id).toBeTruthy();
    createdTenantIds.push(body.tenant.id);

    await app.close();
  });

  it("signup rejects a duplicate email with 409 (proves the pre-insert lookup actually sees the row it just created)", async () => {
    const app = await buildApp();
    const email = `auth-rls-dup-${randomUUID()}@example.com`;

    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS Dup Test Co", email, password: "correct-horse-battery" },
    });
    expect(first.statusCode).toBe(200);
    createdTenantIds.push(JSON.parse(first.body).tenant.id);

    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS Dup Test Co Again", email, password: "another-password" },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body)).toEqual({ error: "email_already_registered" });

    await app.close();
  });

  it("login succeeds for a user created via signup, and /auth/me returns that user's own record", async () => {
    const app = await buildApp();
    const email = `auth-rls-login-${randomUUID()}@example.com`;
    const password = "correct-horse-battery-staple";

    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS Login Test Co", email, password },
    });
    expect(signup.statusCode).toBe(200);
    const tenantId = JSON.parse(signup.body).tenant.id;
    createdTenantIds.push(tenantId);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = JSON.parse(login.body);
    expect(loginBody.token).toBeTruthy();
    expect(loginBody.user.email).toBe(email);
    expect(loginBody.user.tenantId).toBe(tenantId);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = JSON.parse(me.body);
    expect(meBody.email).toBe(email);
    expect(meBody.tenantId).toBe(tenantId);

    await app.close();
  });

  it("login rejects a wrong password with 401", async () => {
    const app = await buildApp();
    const email = `auth-rls-badpw-${randomUUID()}@example.com`;

    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS Bad Password Co", email, password: "the-real-password" },
    });
    createdTenantIds.push(JSON.parse(signup.body).tenant.id);

    const login = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password: "definitely-not-it" },
    });
    expect(login.statusCode).toBe(401);
    expect(JSON.parse(login.body)).toEqual({ error: "invalid_credentials" });

    await app.close();
  });

  it("/auth/me rejects an unauthenticated request with 401", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/auth/me" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
