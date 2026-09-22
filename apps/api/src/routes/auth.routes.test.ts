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
/** Captures 2FA codes login/verify-2fa send — see extractTwoFactorCode below. Never reset between tests; every test uses a unique email so lookups by `to` never collide. */
let sentEmails: { to: string; subject: string; text: string }[] = [];

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

/**
 * Since login/Google now stop at a 2FA challenge (see auth.routes.ts's
 * issueTwoFactorCode call) rather than issuing a token directly, ctx.email
 * has to actually work here — a login test against `{ prisma } as never`
 * with no email provider throws inside issueTwoFactorCode the moment a
 * password check succeeds. Same stub-EmailProvider pattern as
 * team.routes.test.ts's own doc comment on why: real capture, not a mock
 * that would hide a broken send path.
 */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(authPlugin);
  const email = {
    send: async (message: { to: string; subject: string; text: string }) => {
      sentEmails.push(message);
      return { sent: true };
    },
  };
  await registerAuthRoutes(app, { prisma, email } as never);
  await app.ready();
  return app;
}

function extractTwoFactorCode(text: string): string {
  const match = text.match(/Your sign-in code is (\d{6})/);
  if (!match) throw new Error(`no 2FA code found in email text: ${text}`);
  return match[1]!;
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
    expect(body.tenant.id).toBeTruthy();
    createdTenantIds.push(body.tenant.id);
    // Signup proves the email address first: a code, not a session.
    expect(body.requiresTwoFactor).toBe(true);
    expect(body.token).toBeUndefined();

    const code = extractTwoFactorCode(sentEmails.filter((m) => m.to === email).at(-1)!.text);
    const verify = await app.inject({ method: "POST", url: "/v1/auth/verify-2fa", payload: { challenge: body.challenge, code } });
    expect(verify.statusCode).toBe(200);
    const verifyBody = JSON.parse(verify.body);
    expect(verifyBody.token).toBeTruthy();
    expect(verifyBody.user.tenantId).toBe(body.tenant.id);

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
    expect(JSON.parse(second.body)).toMatchObject({ error: "email_already_registered" });

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
    // A correct password now earns a 2FA challenge, not a session — the
    // whole point of guarding this path is that neither it nor Google
    // alone hands back a usable token.
    expect(loginBody.requiresTwoFactor).toBe(true);
    expect(loginBody.challenge).toBeTruthy();
    expect(loginBody.token).toBeUndefined();

    // The latest code: signup already emailed one to this address, and
    // issuing the login code replaced it.
    const code = extractTwoFactorCode(sentEmails.filter((m) => m.to === email).at(-1)!.text);
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-2fa",
      payload: { challenge: loginBody.challenge, code },
    });
    expect(verify.statusCode).toBe(200);
    const verifyBody = JSON.parse(verify.body);
    expect(verifyBody.token).toBeTruthy();
    expect(verifyBody.user.email).toBe(email);
    expect(verifyBody.user.tenantId).toBe(tenantId);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${verifyBody.token}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = JSON.parse(me.body);
    expect(meBody.email).toBe(email);
    expect(meBody.tenantId).toBe(tenantId);

    await app.close();
  });

  it("verify-2fa rejects a wrong code, then accepts the right one — a bad guess costs an attempt, not the whole challenge", async () => {
    const app = await buildApp();
    const email = `auth-rls-2fa-wrong-${randomUUID()}@example.com`;
    const password = "correct-horse-battery-staple";

    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS 2FA Wrong-Code Co", email, password },
    });
    createdTenantIds.push(JSON.parse(signup.body).tenant.id);

    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
    const { challenge } = JSON.parse(login.body);
    const realCode = extractTwoFactorCode(sentEmails.filter((m) => m.to === email).at(-1)!.text);
    const wrongCode = realCode === "000000" ? "111111" : "000000";

    const badAttempt = await app.inject({ method: "POST", url: "/v1/auth/verify-2fa", payload: { challenge, code: wrongCode } });
    expect(badAttempt.statusCode).toBe(401);
    expect(JSON.parse(badAttempt.body).error).toBe("invalid");

    const goodAttempt = await app.inject({ method: "POST", url: "/v1/auth/verify-2fa", payload: { challenge, code: realCode } });
    expect(goodAttempt.statusCode).toBe(200);
    expect(JSON.parse(goodAttempt.body).token).toBeTruthy();

    await app.close();
  });

  it("verify-2fa voids the challenge outright after five wrong codes — the real code stops working too", async () => {
    const app = await buildApp();
    const email = `auth-rls-2fa-lockout-${randomUUID()}@example.com`;
    const password = "correct-horse-battery-staple";

    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS 2FA Lockout Co", email, password },
    });
    createdTenantIds.push(JSON.parse(signup.body).tenant.id);

    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });
    const { challenge } = JSON.parse(login.body);
    const realCode = extractTwoFactorCode(sentEmails.filter((m) => m.to === email).at(-1)!.text);
    const wrongCode = realCode === "000000" ? "111111" : "000000";

    let last: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < 5; i++) {
      last = await app.inject({ method: "POST", url: "/v1/auth/verify-2fa", payload: { challenge, code: wrongCode } });
    }
    expect(JSON.parse(last!.body).error).toBe("too_many_attempts");

    // The keyspace-walk this guards against: even the correct code must
    // now be refused, since the challenge itself is gone, not just that
    // one guess.
    const afterLockout = await app.inject({ method: "POST", url: "/v1/auth/verify-2fa", payload: { challenge, code: realCode } });
    expect(afterLockout.statusCode).toBe(401);

    await app.close();
  });

  it("verify-2fa rejects a real session token used as a challenge — the purpose claim can't be replayed across token types", async () => {
    const app = await buildApp();
    const email = `auth-rls-2fa-purpose-${randomUUID()}@example.com`;
    const password = "correct-horse-battery-staple";

    const signup = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "RLS 2FA Purpose Co", email, password },
    });
    createdTenantIds.push(JSON.parse(signup.body).tenant.id);
    // A real session token: signup's emailed code, completed.
    const signupCode = extractTwoFactorCode(sentEmails.filter((m) => m.to === email).at(-1)!.text);
    const completed = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-2fa",
      payload: { challenge: JSON.parse(signup.body).challenge, code: signupCode },
    });
    const sessionToken = JSON.parse(completed.body).token;
    expect(sessionToken).toBeTruthy();

    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-2fa",
      payload: { challenge: sessionToken, code: "000000" },
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe("challenge_expired");

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
