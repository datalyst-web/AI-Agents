import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * The free-trial journey against the real RLS-enforced chat_app_user
 * connection: the welcome questionnaire (answers + logo + documents), staff
 * notification with attachments, the staff view, and the 14-day clock
 * starting only when the agent first goes live.
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let app: FastifyInstance;
const createdTenantIds: string[] = [];
const createdStaffIds: string[] = [];
const sentEmails: { to: string; subject: string; text: string; attachments?: { filename: string }[] }[] = [];
const storedKeys: string[] = [];

beforeAll(async () => {
  if (!process.env.CHAT_APP_DATABASE_URL) return;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const db = await import("@chat-agent/db");
  ({ withPlatformContext, withTenant } = db);
  prisma = db.createPrismaClient(process.env.CHAT_APP_DATABASE_URL);
  await prisma.$queryRaw`SELECT 1`;

  const { default: multipart } = await import("@fastify/multipart");
  const { default: authPlugin } = await import("../plugins/auth.js");
  const { registerOnboardingRoutes } = await import("./onboarding.routes.js");
  const { registerAgentRoutes } = await import("./agents.routes.js");
  const { registerAuthRoutes } = await import("./auth.routes.js");
  app = Fastify({ logger: false });
  app.setErrorHandler((err, _request, reply) => {
    reply.code(err.name === "ZodError" ? 400 : (err.statusCode ?? 500)).send({ error: err.name, message: err.message });
  });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(authPlugin, { prisma });
  const email = {
    send: async (m: { to: string; subject: string; text: string; attachments?: { filename: string }[] }) => {
      sentEmails.push(m);
      return { sent: true };
    },
  };
  const objectStore = {
    tenantKey: (tenantId: string, ...parts: string[]) => ["chat", tenantId, ...parts].join("/"),
    putObject: async (key: string) => {
      storedKeys.push(key);
    },
    presignedDownloadUrl: async (key: string) => `https://files.example/${encodeURIComponent(key)}`,
  };
  const ctx = { prisma, email, objectStore } as never;
  await registerOnboardingRoutes(app, ctx);
  await registerAgentRoutes(app, ctx);
  await registerAuthRoutes(app, ctx);
  await app.ready();
});

afterAll(async () => {
  if (!prisma) return;
  await withPlatformContext(prisma, async (tx) => {
    for (const id of createdTenantIds) await tx.tenant.delete({ where: { id } }).catch(() => undefined);
    for (const id of createdStaffIds) await tx.user.delete({ where: { id } }).catch(() => undefined);
  });
  await app?.close();
  await prisma.$disconnect();
});

const ANSWERS = {
  businessName: "Sunrise Dental",
  whatYouDo: "A family dental clinic offering check-ups, whitening and braces.",
  goals: ["answer_questions", "book_appointments"],
  channels: ["website", "whatsapp"],
  contactName: "Tendai Moyo",
  contactPhone: "+263 77 123 4567",
  productsAndPrices: "Check-up $30",
  faqs: [{ question: "Do you accept medical aid?", answer: "Yes — CIMAS and PSMAS." }],
  websitePlatform: "wordpress",
  websiteInstall: "do_it_for_me",
};

/** A multipart body by hand: the answers field plus any files. */
function multipartBody(answers: unknown, files: { field: string; name: string; type: string; content: string }[] = []) {
  const boundary = `----test${randomUUID()}`;
  const chunks: string[] = [`--${boundary}\r\nContent-Disposition: form-data; name="answers"\r\n\r\n${JSON.stringify(answers)}\r\n`];
  for (const f of files) {
    chunks.push(`--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n${f.content}\r\n`);
  }
  chunks.push(`--${boundary}--\r\n`);
  return { payload: chunks.join(""), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

async function createTrialTenant() {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name: "Trial Co", slug: `trial-${randomUUID()}`, subscriptionState: "TRIAL", trialEndsAt: null } }),
  );
  createdTenantIds.push(tenant.id);
  const ownerId = randomUUID();
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const viewerId = randomUUID();
  await withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
    await tx.user.create({ data: { id: ownerId, tenantId: tenant.id, email: ownerEmail, passwordHash: "x", role: "tenant_owner", displayName: "Tendai" } });
    await tx.user.create({ data: { id: viewerId, tenantId: tenant.id, email: `viewer-${randomUUID()}@example.com`, passwordHash: "x", role: "tenant_viewer", displayName: "Viewer" } });
  });
  const staffEmail = `staff-${randomUUID()}@example.com`;
  const staffId = randomUUID();
  await withPlatformContext(prisma, (tx) =>
    tx.user.create({ data: { id: staffId, tenantId: null, email: staffEmail, passwordHash: "x", role: "setup_specialist", displayName: "Staff" } }),
  );
  createdStaffIds.push(staffId);
  return {
    tenantId: tenant.id,
    ownerEmail,
    staffEmail,
    owner: { authorization: `Bearer ${app.jwt.sign({ sub: ownerId, tenantId: tenant.id, role: "tenant_owner" } as never)}` },
    viewer: { authorization: `Bearer ${app.jwt.sign({ sub: viewerId, tenantId: tenant.id, role: "tenant_viewer" } as never)}` },
    admin: { authorization: `Bearer ${app.jwt.sign({ sub: randomUUID(), role: "platform_admin" } as never)}` },
  };
}

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("free-trial onboarding (real chat_app_user connection)", () => {
  it("asks for the questionnaire first, stores answers and files, and emails staff and the client", async () => {
    const t = await createTrialTenant();
    const me = async () => (await app.inject({ method: "GET", url: "/v1/auth/me", headers: t.owner })).json();
    expect(await me()).toMatchObject({ onboardingIntakeRequired: true, trialStarted: false });

    const body = multipartBody(ANSWERS, [
      { field: "logo", name: "logo.png", type: "image/png", content: "PNGDATA" },
      { field: "documents", name: "price list.txt", type: "text/plain", content: "Check-up $30" },
    ]);
    const res = await app.inject({ method: "POST", url: `/v1/tenants/${t.tenantId}/intake`, headers: { ...t.owner, ...body.headers }, payload: body.payload });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, files: 2 });
    expect(storedKeys.filter((k) => k.startsWith(`chat/${t.tenantId}/intake/`))).toHaveLength(2);

    expect(await me()).toMatchObject({ onboardingIntakeRequired: false, trialStarted: false });

    const staffMail = sentEmails.find((m) => m.to === t.staffEmail);
    expect(staffMail?.subject).toBe("New free trial: Sunrise Dental");
    expect(staffMail?.text).toContain("Do you accept medical aid?");
    expect(staffMail?.text).toContain("WordPress — Install it for me");
    expect(staffMail?.attachments?.map((a) => a.filename)).toEqual(["logo.png", "price list.txt"]);
    expect(sentEmails.find((m) => m.to === t.ownerEmail)?.subject).toMatch(/building your AI assistant/);

    const view = await app.inject({ method: "GET", url: `/v1/platform/tenants/${t.tenantId}/intake`, headers: t.admin });
    expect(view.statusCode).toBe(200);
    expect(view.json().summary).toContain("Sunrise Dental");
    expect(view.json().files).toEqual([
      { index: 0, name: "logo.png", size: 7, kind: "logo" },
      { index: 1, name: "price list.txt", size: 12, kind: "document" },
    ]);
    expect(JSON.stringify(view.json())).not.toContain("chat/");
    const file = await app.inject({ method: "GET", url: `/v1/platform/tenants/${t.tenantId}/intake/files/1`, headers: t.admin });
    expect(file.json().url).toMatch(/^https:\/\/files\.example\//);

    // Clients can't read the staff view.
    expect((await app.inject({ method: "GET", url: `/v1/platform/tenants/${t.tenantId}/intake`, headers: t.owner })).statusCode).toBe(403);
  });

  it("requires the essentials and the right person", async () => {
    const t = await createTrialTenant();
    const missing = multipartBody({ ...ANSWERS, contactPhone: "" });
    const bad = await app.inject({ method: "POST", url: `/v1/tenants/${t.tenantId}/intake`, headers: { ...t.owner, ...missing.headers }, payload: missing.payload });
    expect(bad.statusCode).toBe(400);

    const wrongLogo = multipartBody(ANSWERS, [{ field: "logo", name: "logo.exe", type: "application/octet-stream", content: "x" }]);
    const bad2 = await app.inject({ method: "POST", url: `/v1/tenants/${t.tenantId}/intake`, headers: { ...t.owner, ...wrongLogo.headers }, payload: wrongLogo.payload });
    expect(bad2.statusCode).toBe(400);

    const ok = multipartBody(ANSWERS);
    const viewer = await app.inject({ method: "POST", url: `/v1/tenants/${t.tenantId}/intake`, headers: { ...t.viewer, ...ok.headers }, payload: ok.payload });
    expect(viewer.statusCode).toBe(403);
  });

  it("starts the 14-day trial the first time the agent goes live, not before", async () => {
    const t = await createTrialTenant();
    const agent = await withTenant(prisma, { tenantId: t.tenantId }, (tx) =>
      tx.agent.create({
        data: {
          tenantId: t.tenantId,
          name: "Agent",
          status: "APPROVED",
          version: "v0.1",
          personality: { tone: "friendly", name: "Ava", greeting: "Hi", languagePrimary: "en", languagesSupported: ["en"], systemInstructions: "x", guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING" },
          modelRouting: { failoverChain: ["openai"] },
          enabledToolIds: [],
          crossAgentMemoryPeerIds: [],
          createdBySource: "STAFF_MANAGED_SETUP",
          createdByUserId: randomUUID(),
          lastEditedBySource: "STAFF_MANAGED_SETUP",
          lastEditedByUserId: randomUUID(),
          approvedAt: new Date(),
        },
      }),
    );
    const before = Date.now();
    const pub = await app.inject({ method: "POST", url: `/v1/tenants/${t.tenantId}/agents/${agent.id}/publish`, headers: t.owner });
    expect(pub.statusCode).toBe(200);

    const tenant = await withPlatformContext(prisma, (tx) => tx.tenant.findUnique({ where: { id: t.tenantId } }));
    const days = (tenant!.trialEndsAt!.getTime() - before) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(sentEmails.find((m) => m.to === t.ownerEmail && /free trial starts today/.test(m.subject))).toBeTruthy();
    const started = await withTenant(prisma, { tenantId: t.tenantId }, (tx) => tx.auditLogEntry.count({ where: { tenantId: t.tenantId, action: "trial_started" } }));
    expect(started).toBe(1);
  });
});
