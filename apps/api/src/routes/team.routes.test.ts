import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Exercises the full invite lifecycle against a real chat_app_user (RLS-
 * enforced) connection — same reasoning as auth.routes.test.ts's doc
 * comment: these routes were never actually run against FORCE RLS until
 * now, and a bare mock would happily let a missing withTenant() wrapper
 * slide by unnoticed. The invite token itself is only ever available in
 * the sent email (by design — POST /team/invites never returns it), so
 * these tests capture it via a stub EmailProvider rather than reading it
 * back out of the database, exercising the exact same path a real
 * teammate clicking the email link would.
 */

let registerAuthRoutes: typeof import("./auth.routes.js").registerAuthRoutes;
let registerTeamRoutes: typeof import("./team.routes.js").registerTeamRoutes;
let authPlugin: typeof import("../plugins/auth.js").default;
let createPrismaClient: typeof import("@chat-agent/db").createPrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let prisma: import("@chat-agent/db").PrismaClient;

const createdTenantIds: string[] = [];
let sentEmails: { to: string; subject: string; text: string }[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

  ({ registerAuthRoutes } = await import("./auth.routes.js"));
  ({ registerTeamRoutes } = await import("./team.routes.js"));
  ({ default: authPlugin } = await import("../plugins/auth.js"));
  ({ createPrismaClient, withPlatformContext } = await import("@chat-agent/db"));

  prisma = createPrismaClient(process.env.CHAT_APP_DATABASE_URL as string);
  await connectWithRetry(prisma);
});

/** See auth.routes.test.ts's doc comment on this same helper — Neon cold-start P1001. */
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

function extractInviteToken(text: string): string {
  const match = text.match(/token=([a-f0-9]+)/);
  if (!match) throw new Error(`no invite token found in email text: ${text}`);
  return match[1]!;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(authPlugin);
  const email = {
    send: async (message: { to: string; subject: string; text: string }) => {
      sentEmails.push(message);
      return { sent: true };
    },
  };
  await registerAuthRoutes(app, { prisma } as never);
  await registerTeamRoutes(app, { prisma, email } as never);
  await app.ready();
  return app;
}

async function signupOwner(): Promise<{ app: FastifyInstance; token: string; tenantId: string }> {
  const app = await buildApp();
  const ownerEmail = `team-test-owner-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { tenantName: "Team Test Co", email: ownerEmail, password: "correct-horse-battery" },
  });
  const body = JSON.parse(res.body);
  createdTenantIds.push(body.tenant.id);
  return { app, token: body.token, tenantId: body.tenant.id };
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("team routes — real chat_app_user connection", () => {
  it("owner invites a teammate, and it shows up as a pending invite (not yet a member)", async () => {
    const { app, token, tenantId } = await signupOwner();
    const inviteEmail = `teammate-${randomUUID()}@example.com`;

    const invite = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: inviteEmail, role: "tenant_agent_editor" },
    });
    expect(invite.statusCode).toBe(200);

    const list = await app.inject({ method: "GET", url: `/v1/tenants/${tenantId}/team`, headers: { authorization: `Bearer ${token}` } });
    const body = JSON.parse(list.body);
    expect(body.members).toHaveLength(1);
    expect(body.members[0].role).toBe("tenant_owner");
    expect(body.invites).toHaveLength(1);
    expect(body.invites[0].email).toBe(inviteEmail);
    expect(body.invites[0].role).toBe("tenant_agent_editor");

    await app.close();
  });

  it("re-inviting the same email upserts the pending invite rather than duplicating it", async () => {
    const { app, token, tenantId } = await signupOwner();
    const inviteEmail = `teammate-reinvite-${randomUUID()}@example.com`;

    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: inviteEmail, role: "tenant_viewer" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: inviteEmail, role: "tenant_admin" },
    });

    const list = await app.inject({ method: "GET", url: `/v1/tenants/${tenantId}/team`, headers: { authorization: `Bearer ${token}` } });
    const body = JSON.parse(list.body);
    const matching = body.invites.filter((i: { email: string }) => i.email === inviteEmail);
    expect(matching).toHaveLength(1);
    expect(matching[0].role).toBe("tenant_admin");

    await app.close();
  });

  it("rejects inviting an email that's already a registered user (409)", async () => {
    const { app, token, tenantId } = await signupOwner();
    const { token: otherOwnerToken } = await signupOwner();
    const meRes = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { authorization: `Bearer ${otherOwnerToken}` } });
    const existingEmail = JSON.parse(meRes.body).email;

    const invite = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: existingEmail, role: "tenant_viewer" },
    });
    expect(invite.statusCode).toBe(409);

    await app.close();
  });

  it("accepting an invite (via the token from the actual sent email) creates a logged-in member", async () => {
    const { app, token, tenantId } = await signupOwner();
    const inviteEmail = `teammate-accept-${randomUUID()}@example.com`;

    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: inviteEmail, role: "tenant_viewer" },
    });
    const sent = sentEmails.find((m) => m.to === inviteEmail);
    expect(sent).toBeTruthy();
    const rawToken = extractInviteToken(sent!.text);

    const lookup = await app.inject({ method: "GET", url: `/v1/auth/invites/${rawToken}` });
    expect(lookup.statusCode).toBe(200);
    expect(JSON.parse(lookup.body)).toMatchObject({ email: inviteEmail, role: "tenant_viewer", tenantName: "Team Test Co" });

    const accept = await app.inject({
      method: "POST",
      url: "/v1/auth/accept-invite",
      payload: { token: rawToken, displayName: "New Teammate", password: "another-strong-password" },
    });
    expect(accept.statusCode).toBe(200);
    const acceptBody = JSON.parse(accept.body);
    expect(acceptBody.token).toBeTruthy();
    expect(acceptBody.tenant.id).toBe(tenantId);

    // The token is single-use — accepting again must fail, not silently create a second account.
    const acceptAgain = await app.inject({
      method: "POST",
      url: "/v1/auth/accept-invite",
      payload: { token: rawToken, displayName: "New Teammate", password: "another-strong-password" },
    });
    expect(acceptAgain.statusCode).toBe(400);

    const list = await app.inject({ method: "GET", url: `/v1/tenants/${tenantId}/team`, headers: { authorization: `Bearer ${token}` } });
    const body = JSON.parse(list.body);
    expect(body.members).toHaveLength(2);
    expect(body.invites).toHaveLength(0);

    await app.close();
  });

  it("a viewer (no team:invite permission) cannot invite teammates", async () => {
    const { app, token, tenantId } = await signupOwner();
    const inviteEmail = `teammate-viewer-${randomUUID()}@example.com`;

    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: inviteEmail, role: "tenant_viewer" },
    });
    const rawToken = extractInviteToken(sentEmails.find((m) => m.to === inviteEmail)!.text);
    const accept = await app.inject({
      method: "POST",
      url: "/v1/auth/accept-invite",
      payload: { token: rawToken, displayName: "Viewer Teammate", password: "viewer-password-here" },
    });
    const viewerToken = JSON.parse(accept.body).token;

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { email: `another-${randomUUID()}@example.com`, role: "tenant_viewer" },
    });
    expect(forbidden.statusCode).toBe(403);

    await app.close();
  });

  it("owner can remove a teammate, who can then no longer log in", async () => {
    const { app, token, tenantId } = await signupOwner();
    const memberEmail = `teammate-remove-${randomUUID()}@example.com`;
    const memberPassword = "removable-password-here";

    await app.inject({
      method: "POST",
      url: `/v1/tenants/${tenantId}/team/invites`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: memberEmail, role: "tenant_agent_editor" },
    });
    const rawToken = extractInviteToken(sentEmails.find((m) => m.to === memberEmail)!.text);
    const accept = await app.inject({
      method: "POST",
      url: "/v1/auth/accept-invite",
      payload: { token: rawToken, displayName: "Removable Teammate", password: memberPassword },
    });
    const memberId = JSON.parse(accept.body).token
      ? JSON.parse(Buffer.from(JSON.parse(accept.body).token.split(".")[1], "base64").toString())["sub"]
      : null;
    expect(memberId).toBeTruthy();

    const remove = await app.inject({
      method: "DELETE",
      url: `/v1/tenants/${tenantId}/team/members/${memberId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(remove.statusCode).toBe(204);

    const loginAfterRemoval = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: memberEmail, password: memberPassword },
    });
    expect(loginAfterRemoval.statusCode).toBe(401);

    await app.close();
  });

  it("owner cannot remove themselves", async () => {
    const { app, token, tenantId } = await signupOwner();
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { authorization: `Bearer ${token}` } });
    const ownerId = JSON.parse(me.body).id;

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/tenants/${tenantId}/team/members/${ownerId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: "cannot_remove_self" });

    await app.close();
  });
});
