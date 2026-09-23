import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, createHmac, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Meta's data-deletion callback — required for app review, and the one
 * public endpoint that deliberately reaches across tenants (the same
 * person can have messaged several of our clients' Pages). Exercised
 * against the real RLS-enforced connection, because the thing most likely
 * to go wrong is the erasure silently doing nothing.
 */

const APP_SECRET = "meta-test-app-secret";

let registerChannelRoutes: typeof import("./channels.routes.js").registerChannelRoutes;
let createPrismaClient: typeof import("@chat-agent/db").createPrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let prisma: import("@chat-agent/db").PrismaClient;

const createdTenantIds: string[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  process.env.META_APP_SECRET = APP_SECRET;

  ({ registerChannelRoutes } = await import("./channels.routes.js"));
  ({ createPrismaClient, withPlatformContext, withTenant } = await import("@chat-agent/db"));

  prisma = createPrismaClient(process.env.CHAT_APP_DATABASE_URL as string);
  for (let i = 0; i < 4; i++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      break;
    } catch (err) {
      if (i === 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
});

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

function signedRequest(userId: string, secret = APP_SECRET, issuedAt = Math.floor(Date.now() / 1000)): string {
  const payload = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", issued_at: issuedAt, user_id: userId })).toString(
    "base64url",
  );
  return `${createHmac("sha256", secret).update(payload).digest("base64url")}.${payload}`;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate("authenticate", async () => undefined);
  await registerChannelRoutes(app, { prisma } as never);
  await app.ready();
  return app;
}

/** A tenant whose agent has already talked to `metaUserId` on Messenger. */
async function createTenantWithCustomer(metaUserId: string) {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name: "Meta Deletion Test Co", slug: `meta-del-${randomUUID()}` } }),
  );
  createdTenantIds.push(tenant.id);

  const actorId = randomUUID();
  return withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
    const agent = await tx.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Meta Test Agent",
        status: "LIVE",
        personality: {
          tone: "friendly",
          name: "Ava",
          greeting: "Hi",
          languagePrimary: "en",
          languagesSupported: ["en"],
          systemInstructions: "Be helpful.",
          guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
        },
        modelRouting: { failoverChain: ["anthropic", "openai", "gemini"] },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        createdBySource: "CLIENT",
        createdByUserId: actorId,
        lastEditedBySource: "CLIENT",
        lastEditedByUserId: actorId,
      },
    });
    const identity = await tx.customerIdentity.create({
      data: {
        tenantId: tenant.id,
        agentId: agent.id,
        identifierType: "facebook_psid",
        identifierHash: createHash("sha256").update(metaUserId.trim().toLowerCase()).digest("hex"),
        encryptedExternalHandle: "encrypted-handle-placeholder",
      },
    });
    const conversation = await tx.conversation.create({
      data: { tenantId: tenant.id, agentId: agent.id, channel: "FACEBOOK_MESSENGER", customerIdentityId: identity.id },
    });
    await tx.crossConversationMemoryFact.create({
      data: {
        tenantId: tenant.id,
        agentId: agent.id,
        customerIdentityId: identity.id,
        fact: "Prefers morning appointments",
        sourceConversationId: conversation.id,
        sourceMessageId: randomUUID(),
        confidence: 0.9,
      },
    });
    return { tenantId: tenant.id, agentId: agent.id, identityId: identity.id };
  });
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("POST /v1/channels/meta/data-deletion", () => {
  it("erases the person's data across every tenant they messaged, and keeps the audit record", async () => {
    const app = await buildApp();
    const metaUserId = `psid-${randomUUID()}`;
    const first = await createTenantWithCustomer(metaUserId);
    const second = await createTenantWithCustomer(metaUserId);

    const res = await app.inject({
      method: "POST",
      url: "/v1/channels/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(signedRequest(metaUserId))}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.confirmation_code).toBeTruthy();
    expect(body.url).toContain("/data-deletion");
    expect(body.url).toContain(body.confirmation_code);

    for (const tenant of [first, second]) {
      await withPlatformContext(prisma, async (tx) => {
        expect(await tx.conversation.count({ where: { customerIdentityId: tenant.identityId } })).toBe(0);
        expect(await tx.crossConversationMemoryFact.count({ where: { customerIdentityId: tenant.identityId } })).toBe(0);
        const identity = await tx.customerIdentity.findUnique({ where: { id: tenant.identityId } });
        // The identity row survives, holding only a one-way hash — deleting
        // it would cascade away the proof the erasure happened.
        expect(identity?.encryptedExternalHandle).toBeNull();
        const audit = await tx.memoryForgetRequest.findFirst({ where: { customerIdentityId: tenant.identityId } });
        expect(audit?.fulfilledAt).toBeTruthy();
      });
    }

    const status = await app.inject({ method: "GET", url: `/v1/channels/meta/data-deletion/${body.confirmation_code}` });
    expect(status.statusCode).toBe(200);
    expect(JSON.parse(status.body).status).toBe("completed");

    await app.close();
  });

  it("leaves another customer's data alone", async () => {
    const app = await buildApp();
    const bystander = await createTenantWithCustomer(`psid-${randomUUID()}`);

    const res = await app.inject({
      method: "POST",
      url: "/v1/channels/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(signedRequest(`psid-${randomUUID()}`))}`,
    });

    expect(res.statusCode).toBe(200);
    await withPlatformContext(prisma, async (tx) => {
      expect(await tx.conversation.count({ where: { customerIdentityId: bystander.identityId } })).toBe(1);
      expect(await tx.crossConversationMemoryFact.count({ where: { customerIdentityId: bystander.identityId } })).toBe(1);
    });

    await app.close();
  });

  it("rejects a request not signed by the app secret", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/channels/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(signedRequest("psid-1", "wrong-secret"))}`,
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("reports an unrecognised confirmation code as unknown rather than erroring", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/channels/meta/data-deletion/not-a-real-code" });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).status).toBe("unknown");
    await app.close();
  });

  it("still confirms a deletion for someone we hold nothing about", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/channels/meta/data-deletion",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `signed_request=${encodeURIComponent(signedRequest(`psid-${randomUUID()}`))}`,
    });
    expect(res.statusCode).toBe(200);
    const code = JSON.parse(res.body).confirmation_code as string;
    expect(code.startsWith("none-")).toBe(true);

    const status = await app.inject({ method: "GET", url: `/v1/channels/meta/data-deletion/${code}` });
    expect(JSON.parse(status.body)).toMatchObject({ status: "completed", heldData: false });
    await app.close();
  });
});
