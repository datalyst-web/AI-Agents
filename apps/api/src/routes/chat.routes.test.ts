import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Regression coverage for the RLS entry-point bug in chat.routes.ts — see
 * auth.routes.test.ts's doc comment for the full story. Unlike the POST
 * .../messages endpoint (which drives the full agent loop and a real LLM
 * call), the GET .../messages history endpoint exercises the same
 * withTenant()-scoped Prisma access pattern without needing a model
 * provider, so it's covered here directly against the real chat_app_user
 * (RLS-enforced) connection.
 */

let registerChatRoutes: typeof import("./chat.routes.js").registerChatRoutes;
let signWidgetToken: typeof import("../lib/widgetToken.js").signWidgetToken;
let createPrismaClient: typeof import("@chat-agent/db").createPrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let prisma: import("@chat-agent/db").PrismaClient;

const createdTenantIds: string[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

  ({ registerChatRoutes } = await import("./chat.routes.js"));
  ({ signWidgetToken } = await import("../lib/widgetToken.js"));
  ({ createPrismaClient, withPlatformContext, withTenant } = await import("@chat-agent/db"));

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

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // ctx.router/secrets/queue aren't touched by the GET-messages route or by
  // the tenant-suspension check on POST — only processCustomerMessage
  // (the LLM-driving path) needs them, which these tests don't exercise.
  await registerChatRoutes(app, { prisma } as never);
  await app.ready();
  return app;
}

async function seedTenantAgentConversationWithMessage(): Promise<{
  tenantId: string;
  agentId: string;
  conversationId: string;
}> {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({
      data: { name: "Chat RLS Test Co", slug: `chat-rls-${randomUUID()}`, subscriptionState: "ACTIVE" },
    }),
  );
  createdTenantIds.push(tenant.id);

  const actorId = randomUUID();
  const { agent, conversation } = await withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
    const agent = await tx.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Chat Test Agent",
        status: "LIVE",
        personality: {
          tone: "friendly",
          name: "Ava",
          greeting: "Hi!",
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
    const conversation = await tx.conversation.create({
      data: { tenantId: tenant.id, agentId: agent.id, channel: "WIDGET" },
    });
    await tx.message.create({
      data: {
        tenantId: tenant.id,
        agentId: agent.id,
        conversationId: conversation.id,
        role: "customer",
        content: "Hello, is anyone there?",
      },
    });
    return { agent, conversation };
  });

  return { tenantId: tenant.id, agentId: agent.id, conversationId: conversation.id };
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)(
  "GET /v1/chat/:agentId/conversations/:conversationId/messages — RLS entry-point regression (real chat_app_user connection)",
  () => {
    it("returns the conversation's messages for a widget token verified against the tenant — the exact withTenant() lookup FORCE RLS used to break when unwrapped", async () => {
      const app = await buildApp();
      const { tenantId, agentId, conversationId } = await seedTenantAgentConversationWithMessage();
      const token = signWidgetToken({ tenantId, agentId });

      const res = await app.inject({
        method: "GET",
        url: `/v1/chat/${agentId}/conversations/${conversationId}/messages`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].content).toBe("Hello, is anyone there?");
      expect(body[0].role).toBe("customer");

      await app.close();
    });

    it("rejects with 401 when there's no widget token", async () => {
      const app = await buildApp();
      const { agentId, conversationId } = await seedTenantAgentConversationWithMessage();

      const res = await app.inject({
        method: "GET",
        url: `/v1/chat/${agentId}/conversations/${conversationId}/messages`,
      });
      expect(res.statusCode).toBe(401);

      await app.close();
    });

    it("rejects with 401 when the widget token's agentId doesn't match the URL", async () => {
      const app = await buildApp();
      const { tenantId, agentId, conversationId } = await seedTenantAgentConversationWithMessage();
      const tokenForDifferentAgent = signWidgetToken({ tenantId, agentId: randomUUID() });

      const res = await app.inject({
        method: "GET",
        url: `/v1/chat/${agentId}/conversations/${conversationId}/messages`,
        headers: { authorization: `Bearer ${tokenForDifferentAgent}` },
      });
      expect(res.statusCode).toBe(401);

      await app.close();
    });

    it("a widget token for a DIFFERENT tenant cannot read this tenant's conversation (RLS backstop, not just app-layer filtering)", async () => {
      const app = await buildApp();
      const { agentId, conversationId } = await seedTenantAgentConversationWithMessage();
      // Forge a token claiming a tenantId that never owned this conversation.
      const foreignToken = signWidgetToken({ tenantId: randomUUID(), agentId });

      const res = await app.inject({
        method: "GET",
        url: `/v1/chat/${agentId}/conversations/${conversationId}/messages`,
        headers: { authorization: `Bearer ${foreignToken}` },
      });

      // withTenant() scopes to the foreign tenantId, so RLS must return
      // zero rows for a conversation that belongs to a different tenant —
      // never a 500, and never the real tenant's messages.
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);

      await app.close();
    });
  },
);
