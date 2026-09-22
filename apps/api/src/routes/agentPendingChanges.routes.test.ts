import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Edits to a LIVE agent must not reach customers until the client approves
 * and they're published (lib/publishedAgentConfig.ts). Exercised end to end
 * against the real RLS-enforced chat_app_user connection, observing what a
 * customer sees through the public widget-config route.
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let app: FastifyInstance;
const createdTenantIds: string[] = [];

beforeAll(async () => {
  if (!process.env.CHAT_APP_DATABASE_URL) return;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const db = await import("@chat-agent/db");
  ({ withPlatformContext, withTenant } = db);
  prisma = db.createPrismaClient(process.env.CHAT_APP_DATABASE_URL);
  await prisma.$queryRaw`SELECT 1`;

  const { default: authPlugin } = await import("../plugins/auth.js");
  const { registerAgentRoutes } = await import("./agents.routes.js");
  const { registerWidgetConfigRoutes } = await import("./widgetConfig.routes.js");
  app = Fastify({ logger: false });
  app.setErrorHandler((err, _request, reply) => {
    reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ error: err.message });
  });
  await app.register(authPlugin, { prisma });
  await registerAgentRoutes(app, { prisma } as never);
  await registerWidgetConfigRoutes(app, { prisma } as never);
  await app.ready();
});

afterAll(async () => {
  if (!prisma) return;
  await withPlatformContext(prisma, async (tx) => {
    for (const id of createdTenantIds) await tx.tenant.delete({ where: { id } }).catch(() => undefined);
  });
  await app?.close();
  await prisma.$disconnect();
});

async function createLiveAgent() {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name: "Pending Changes Co", slug: `pending-${randomUUID()}`, subscriptionState: "ACTIVE" } }),
  );
  createdTenantIds.push(tenant.id);
  const ownerId = randomUUID();
  const personality = {
    tone: "friendly", name: "Ava", greeting: "Hello from the approved version", languagePrimary: "en",
    languagesSupported: ["en"], systemInstructions: "Be helpful.", guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
  };
  const agent = await withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
    await tx.user.create({ data: { id: ownerId, tenantId: tenant.id, email: `o-${randomUUID()}@example.com`, passwordHash: "x", role: "tenant_owner", displayName: "Owner" } });
    const a = await tx.agent.create({
      data: {
        tenantId: tenant.id, name: "Agent", status: "LIVE", version: "v1.0", personality,
        modelRouting: { failoverChain: ["openai"], reasoningEffort: "low" }, enabledToolIds: [], crossAgentMemoryPeerIds: [],
        createdBySource: "CLIENT", createdByUserId: ownerId, lastEditedBySource: "CLIENT", lastEditedByUserId: ownerId,
        approvedByClientUserId: ownerId, approvedAt: new Date(),
      },
    });
    await tx.agentVersionSnapshot.create({
      data: {
        agentId: a.id, tenantId: tenant.id, version: "v1.0", personality, modelRouting: a.modelRouting as object,
        enabledToolIds: [], knowledgeSnapshotId: randomUUID(), status: "LIVE", publishedAt: new Date(),
      },
    });
    return a;
  });
  // Fully managed: staff edit and roll back (a client has no agent:write);
  // the client approves and publishes.
  const token = app.jwt.sign({ sub: ownerId, tenantId: tenant.id, role: "tenant_owner" } as never);
  const staffToken = app.jwt.sign({ sub: randomUUID(), role: "platform_admin" } as never);
  return { tenantId: tenant.id, agentId: agent.id, token, staffToken };
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("pending changes on a LIVE agent (real chat_app_user connection)", () => {
  it("holds an edit back from customers until it's approved and published", async () => {
    const { tenantId, agentId, token, staffToken } = await createLiveAgent();
    const auth = { authorization: `Bearer ${token}` };
    const staff = { authorization: `Bearer ${staffToken}` };
    const base = `/v1/tenants/${tenantId}/agents/${agentId}`;
    const customerGreeting = async () => (await app.inject({ method: "GET", url: `/v1/widget-config/${agentId}` })).json().greeting;
    const detail = async () => (await app.inject({ method: "GET", url: base, headers: auth })).json();

    expect((await detail()).hasUnpublishedChanges).toBe(false);

    const edit = await app.inject({ method: "PATCH", url: base, headers: staff, payload: { personality: { greeting: "Hello from the new draft" } } });
    expect(edit.statusCode).toBe(200);
    expect(await detail()).toMatchObject({ status: "LIVE", version: "v1.0", hasUnpublishedChanges: true, approvedAt: null });
    expect(await customerGreeting()).toBe("Hello from the approved version");

    const early = await app.inject({ method: "POST", url: `${base}/publish`, headers: auth });
    expect(early.statusCode).toBe(409);
    expect(early.json().error).toMatch(/Approve the pending changes/);

    expect((await app.inject({ method: "POST", url: `${base}/approve`, headers: auth })).statusCode).toBe(200);
    expect(await detail()).toMatchObject({ status: "LIVE", hasUnpublishedChanges: true });
    expect(await customerGreeting()).toBe("Hello from the approved version");

    const published = await app.inject({ method: "POST", url: `${base}/publish`, headers: auth });
    expect(published.statusCode).toBe(200);
    expect(published.json()).toMatchObject({ status: "LIVE", version: "v1.1" });
    expect(await customerGreeting()).toBe("Hello from the new draft");
    expect((await detail()).hasUnpublishedChanges).toBe(false);

    const again = await app.inject({ method: "POST", url: `${base}/publish`, headers: auth });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toMatch(/Nothing new to publish/);
  });

  it("refuses to approve a LIVE agent with nothing pending", async () => {
    const { tenantId, agentId, token } = await createLiveAgent();
    const res = await app.inject({ method: "POST", url: `/v1/tenants/${tenantId}/agents/${agentId}/approve`, headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(409);
  });

  it("serves the rolled-back version, and keeps later edits pending", async () => {
    const { tenantId, agentId, token, staffToken } = await createLiveAgent();
    const auth = { authorization: `Bearer ${token}` };
    const staff = { authorization: `Bearer ${staffToken}` };
    const base = `/v1/tenants/${tenantId}/agents/${agentId}`;
    await app.inject({ method: "PATCH", url: base, headers: staff, payload: { personality: { greeting: "Second version" } } });
    await app.inject({ method: "POST", url: `${base}/approve`, headers: auth });
    await app.inject({ method: "POST", url: `${base}/publish`, headers: auth });

    const rolled = await app.inject({ method: "POST", url: `${base}/rollback`, headers: staff, payload: { toVersion: "v1.0" } });
    expect(rolled.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/widget-config/${agentId}` })).json().greeting).toBe("Hello from the approved version");

    await app.inject({ method: "PATCH", url: base, headers: staff, payload: { personality: { greeting: "Edit after rollback" } } });
    expect((await app.inject({ method: "GET", url: `/v1/widget-config/${agentId}` })).json().greeting).toBe("Hello from the approved version");
    expect((await app.inject({ method: "GET", url: base, headers: auth })).json().hasUnpublishedChanges).toBe(true);
  });
});
