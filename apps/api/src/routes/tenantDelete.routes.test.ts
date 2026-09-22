import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * DELETE /v1/platform/tenants/:tenantId against the real RLS-enforced
 * chat_app_user connection: proves the guard rails, and that one delete
 * really removes every row of a fully populated client (users, agent,
 * conversation + messages, knowledge source + document, audit log,
 * support ticket) while leaving a permanent deletion record behind.
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let app: FastifyInstance;
const deletePrefix = vi.fn(async (_prefix: string) => ({ deleted: 3, failed: 0 }));
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
  const { registerTenantRoutes } = await import("./tenants.routes.js");
  app = Fastify({ logger: false });
  // Same mapping as app.ts's handler: a failed Schema.parse is a 400.
  app.setErrorHandler((err, _request, reply) => {
    reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ error: err.name });
  });
  await app.register(authPlugin, { prisma });
  const objectStore = { tenantKey: (tenantId: string, ...parts: string[]) => ["chat", tenantId, ...parts].join("/"), deletePrefix };
  await registerTenantRoutes(app, { prisma, objectStore } as never);
  await app.ready();
});

afterAll(async () => {
  if (!prisma) return;
  await withPlatformContext(prisma, async (tx) => {
    for (const id of createdTenantIds) await tx.tenant.delete({ where: { id } }).catch(() => undefined);
    await tx.tenantDeletionRecord.deleteMany({ where: { deletedTenantId: { in: createdTenantIds } } });
  });
  await app?.close();
  await prisma.$disconnect();
});

const token = (role: string) => app.jwt.sign({ sub: randomUUID(), role } as never);

async function createPopulatedTenant(state: "ACTIVE" | "CANCELLED") {
  const name = `Delete Test Co ${randomUUID().slice(0, 8)}`;
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name, slug: `delete-${randomUUID()}`, subscriptionState: state } }),
  );
  createdTenantIds.push(tenant.id);
  const tenantId = tenant.id;
  await withTenant(prisma, { tenantId }, async (tx) => {
    const user = await tx.user.create({
      data: { id: randomUUID(), tenantId, email: `owner-${randomUUID()}@example.com`, passwordHash: "x", role: "tenant_owner", displayName: "Owner" },
    });
    const agent = await tx.agent.create({
      data: {
        tenantId,
        name: "Agent",
        status: "LIVE",
        personality: { tone: "friendly", name: "Ava", greeting: "Hi", languagePrimary: "en", languagesSupported: ["en"], systemInstructions: "x", guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING" },
        modelRouting: { failoverChain: ["openai"] },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        createdBySource: "CLIENT",
        createdByUserId: user.id,
        lastEditedBySource: "CLIENT",
        lastEditedByUserId: user.id,
      },
    });
    const conversation = await tx.conversation.create({ data: { tenantId, agentId: agent.id, channel: "WIDGET" } });
    await tx.message.create({ data: { tenantId, agentId: agent.id, conversationId: conversation.id, role: "customer", content: "hello" } });
    const source = await tx.knowledgeSource.create({
      data: { tenantId, agentId: agent.id, type: "MANUAL_FAQ", addedBySource: "CLIENT", addedByUserId: user.id },
    });
    await tx.document.create({ data: { tenantId, agentId: agent.id, knowledgeSourceId: source.id, title: "FAQ", rawText: "Opening hours" } });
    await tx.auditLogEntry.create({ data: { tenantId, actorUserId: user.id, actorIsStaff: false, action: "test_entry" } });
    await tx.supportTicket.create({ data: { tenantId, subject: "s", description: "d", createdByUserId: user.id } });
  });
  return { tenantId, name };
}

async function del(tenantId: string, role: string, body: object) {
  const res = await app.inject({
    method: "DELETE",
    url: `/v1/platform/tenants/${tenantId}`,
    headers: { authorization: `Bearer ${token(role)}` },
    payload: body,
  });
  return { status: res.statusCode, body: res.json() };
}

async function remainingRows(tenantId: string) {
  return withPlatformContext(prisma, async (tx) => ({
    tenant: await tx.tenant.count({ where: { id: tenantId } }),
    users: await tx.user.count({ where: { tenantId } }),
    agents: await tx.agent.count({ where: { tenantId } }),
    conversations: await tx.conversation.count({ where: { tenantId } }),
    messages: await tx.message.count({ where: { tenantId } }),
    sources: await tx.knowledgeSource.count({ where: { tenantId } }),
    documents: await tx.document.count({ where: { tenantId } }),
    auditEntries: await tx.auditLogEntry.count({ where: { tenantId } }),
    tickets: await tx.supportTicket.count({ where: { tenantId } }),
  }));
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("DELETE /v1/platform/tenants/:tenantId (real chat_app_user connection)", () => {
  it("refuses setup_specialist — platform_admin only", async () => {
    const { tenantId, name } = await createPopulatedTenant("CANCELLED");
    expect((await del(tenantId, "setup_specialist", { confirmName: name, reason: "test" })).status).toBe(403);
    expect((await remainingRows(tenantId)).tenant).toBe(1);
  });

  it("refuses a client that hasn't been removed (cancelled) first", async () => {
    const { tenantId, name } = await createPopulatedTenant("ACTIVE");
    const res = await del(tenantId, "platform_admin", { confirmName: name, reason: "test" });
    expect(res).toMatchObject({ status: 409, body: { error: "must_remove_first" } });
    expect((await remainingRows(tenantId)).tenant).toBe(1);
  });

  it("refuses when the typed name doesn't match, or no reason is given", async () => {
    const { tenantId, name } = await createPopulatedTenant("CANCELLED");
    expect((await del(tenantId, "platform_admin", { confirmName: `${name}x`, reason: "test" })).body.error).toBe("name_mismatch");
    expect((await del(tenantId, "platform_admin", { confirmName: name, reason: "" })).status).toBe(400);
    expect((await remainingRows(tenantId)).tenant).toBe(1);
  });

  it("deletes every row of a populated client, cleans its files, and keeps a deletion record", async () => {
    const { tenantId, name } = await createPopulatedTenant("CANCELLED");
    const res = await del(tenantId, "platform_admin", { confirmName: `  ${name} `, reason: "Client asked to close account" });

    expect(res).toMatchObject({ status: 200, body: { deleted: true, filesDeleted: 3, filesCleanupIncomplete: false } });
    expect(await remainingRows(tenantId)).toEqual({
      tenant: 0, users: 0, agents: 0, conversations: 0, messages: 0, sources: 0, documents: 0, auditEntries: 0, tickets: 0,
    });
    expect(deletePrefix).toHaveBeenCalledWith(`chat/${tenantId}/`);
    const record = await withPlatformContext(prisma, (tx) => tx.tenantDeletionRecord.findFirst({ where: { deletedTenantId: tenantId } }));
    expect(record).toMatchObject({ tenantName: name, reason: "Client asked to close account", filesDeleted: 3, filesFailed: 0 });
  });

  it("404s an unknown or malformed client id", async () => {
    expect((await del(randomUUID(), "platform_admin", { confirmName: "x", reason: "test" })).status).toBe(404);
    expect((await del("null", "platform_admin", { confirmName: "x", reason: "test" })).status).toBe(404);
  });
});
