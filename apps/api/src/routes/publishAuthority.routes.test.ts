import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * POST /v1/platform/tenants/:tenantId/publish-authority — the one place a
 * client's approval gate comes off. Against the real RLS-enforced
 * connection: only a platform admin may use it, granting needs a written
 * basis, both directions leave an audit entry, and the generic tenant
 * PATCH can no longer flip the flag around all of that.
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let app: FastifyInstance;
const createdTenantIds: string[] = [];

beforeAll(async () => {
  if (!process.env.CHAT_APP_DATABASE_URL) return;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const db = await import("@chat-agent/db");
  ({ withPlatformContext } = db);
  prisma = db.createPrismaClient(process.env.CHAT_APP_DATABASE_URL);
  await prisma.$queryRaw`SELECT 1`;

  const { default: authPlugin } = await import("../plugins/auth.js");
  const { registerTenantRoutes } = await import("./tenants.routes.js");
  app = Fastify({ logger: false });
  app.setErrorHandler((err, _request, reply) => {
    reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ error: err.name });
  });
  await app.register(authPlugin, { prisma });
  await registerTenantRoutes(app, { prisma, objectStore: {} } as never);
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

const token = (role: string) => app.jwt.sign({ sub: randomUUID(), role } as never);

async function newTenant() {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name: "Authority Test Co", slug: `authority-${randomUUID()}` } }),
  );
  createdTenantIds.push(tenant.id);
  return tenant.id;
}

const call = (tenantId: string, role: string, body: object) =>
  app.inject({
    method: "POST",
    url: `/v1/platform/tenants/${tenantId}/publish-authority`,
    headers: { authorization: `Bearer ${token(role)}` },
    payload: body,
  });

const flag = (tenantId: string) =>
  withPlatformContext(prisma, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { delegatesAutoPublish: true } })).then(
    (t) => t.delegatesAutoPublish,
  );

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("POST /v1/platform/tenants/:id/publish-authority", () => {
  it("lets a platform admin grant it with a basis, and records who and why", async () => {
    const tenantId = await newTenant();
    const res = await call(tenantId, "platform_admin", { enabled: true, basis: "Owner approved in writing on WhatsApp, 24 Sep" });
    expect(res.statusCode).toBe(200);
    expect(await flag(tenantId)).toBe(true);

    const audit = await withPlatformContext(prisma, (tx) =>
      tx.auditLogEntry.findFirst({ where: { tenantId, action: "auto_publish_delegation_updated" } }),
    );
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit?.metadata)).toContain("Owner approved in writing");
  });

  it("refuses to grant without a real basis", async () => {
    const tenantId = await newTenant();
    for (const body of [{ enabled: true }, { enabled: true, basis: "" }, { enabled: true, basis: "ok" }]) {
      expect((await call(tenantId, "platform_admin", body)).statusCode).toBe(400);
    }
    expect(await flag(tenantId)).toBe(false);
  });

  it("is admin-only — a setup specialist cannot remove the client's approval gate", async () => {
    const tenantId = await newTenant();
    const res = await call(tenantId, "setup_specialist", { enabled: true, basis: "Owner approved in writing on WhatsApp" });
    expect(res.statusCode).toBe(403);
    expect(await flag(tenantId)).toBe(false);
  });

  it("can be revoked without a basis, and that is audited too", async () => {
    const tenantId = await newTenant();
    await call(tenantId, "platform_admin", { enabled: true, basis: "Owner approved in writing on WhatsApp" });
    const res = await call(tenantId, "platform_admin", { enabled: false });
    expect(res.statusCode).toBe(200);
    expect(await flag(tenantId)).toBe(false);
    const entries = await withPlatformContext(prisma, (tx) =>
      tx.auditLogEntry.count({ where: { tenantId, action: "auto_publish_delegation_updated" } }),
    );
    expect(entries).toBe(2);
  });

  it("can no longer be flipped through the generic tenant PATCH", async () => {
    const tenantId = await newTenant();
    await app.inject({
      method: "PATCH",
      url: `/v1/platform/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${token("platform_admin")}` },
      payload: { delegatesAutoPublish: true },
    });
    expect(await flag(tenantId)).toBe(false);
  });
});
