import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Regression coverage for the RLS entry-point bug in widgetConfig.routes.ts
 * (see auth.routes.test.ts's doc comment for the full story): the public
 * widget-config lookup used to call `ctx.prisma.agent.findFirst()` /
 * `tenant.findUniqueOrThrow()` with no withPlatformContext wrapper, so
 * against a real FORCE-RLS database the embed script's very first call —
 * `<script data-agent-id="...">` resolving its own config — silently
 * 404'd for every tenant, always, everywhere. Exercised here against the
 * real chat_app_user (RLS-enforced) connection, never the admin/owner URL.
 */

let registerWidgetConfigRoutes: typeof import("./widgetConfig.routes.js").registerWidgetConfigRoutes;
let createPrismaClient: typeof import("@chat-agent/db").createPrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let prisma: import("@chat-agent/db").PrismaClient;

const createdTenantIds: string[] = [];

beforeAll(async () => {
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder";
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

  ({ registerWidgetConfigRoutes } = await import("./widgetConfig.routes.js"));
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
  await registerWidgetConfigRoutes(app, { prisma } as never);
  await app.ready();
  return app;
}

async function createTenantWithAgent(overrides: {
  status?: "LIVE" | "DRAFT";
  subscriptionState?: "ACTIVE" | "SUSPENDED" | "CANCELLED";
} = {}): Promise<{ tenantId: string; agentId: string }> {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({
      data: {
        name: "Widget Config RLS Test Co",
        slug: `widget-rls-${randomUUID()}`,
        subscriptionState: overrides.subscriptionState ?? "ACTIVE",
      },
    }),
  );
  createdTenantIds.push(tenant.id);

  const actorId = randomUUID();
  const agent = await withTenant(prisma, { tenantId: tenant.id }, (tx) =>
    tx.agent.create({
      data: {
        tenantId: tenant.id,
        name: "Widget Test Agent",
        status: overrides.status ?? "LIVE",
        personality: {
          tone: "friendly",
          name: "Ava",
          greeting: "Hi there, how can I help?",
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
    }),
  );

  return { tenantId: tenant.id, agentId: agent.id };
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("GET /v1/widget-config/:agentId — RLS entry-point regression (real chat_app_user connection)", () => {
  it("resolves config for a LIVE agent under an ACTIVE tenant — the exact lookup FORCE RLS used to silently 404", async () => {
    const app = await buildApp();
    const { agentId } = await createTenantWithAgent({ status: "LIVE", subscriptionState: "ACTIVE" });

    const res = await app.inject({ method: "GET", url: `/v1/widget-config/${agentId}` });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.agentId).toBe(agentId);
    expect(body.name).toBe("Ava");
    expect(body.greeting).toBe("Hi there, how can I help?");
    expect(body.widgetToken).toBeTruthy();
    // White-label safe — never leak provider/model identity to the browser.
    expect(JSON.stringify(body)).not.toMatch(/anthropic|openai|gemini|claude|gpt/i);

    await app.close();
  });

  it("404s for a DRAFT (not-yet-LIVE) agent", async () => {
    const app = await buildApp();
    const { agentId } = await createTenantWithAgent({ status: "DRAFT" });

    const res = await app.inject({ method: "GET", url: `/v1/widget-config/${agentId}` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("404s for a LIVE agent whose tenant is SUSPENDED", async () => {
    const app = await buildApp();
    const { agentId } = await createTenantWithAgent({ status: "LIVE", subscriptionState: "SUSPENDED" });

    const res = await app.inject({ method: "GET", url: `/v1/widget-config/${agentId}` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it("404s for a nonexistent agentId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/widget-config/${randomUUID()}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
