import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * Releasing the questionnaire-drafted assistant against the real
 * RLS-enforced chat_app_user connection: nothing before its release time,
 * then TESTING plus exactly one "ready" email; held while knowledge is
 * still loading; and silent when staff already released it.
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let runIntakeAgentReleaseSweep: typeof import("./intakeAgentReleaseSweep.js").runIntakeAgentReleaseSweep;
const sent: { to: string; subject: string; html?: string }[] = [];
const createdTenantIds: string[] = [];
const MIN = 60 * 1000;

beforeAll(async () => {
  if (!process.env.CHAT_APP_DATABASE_URL) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? process.env.CHAT_APP_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const db = await import("@chat-agent/db");
  ({ withPlatformContext, withTenant } = db);
  prisma = db.createPrismaClient(process.env.CHAT_APP_DATABASE_URL);
  ({ runIntakeAgentReleaseSweep } = await import("./intakeAgentReleaseSweep.js"));
});

afterAll(async () => {
  if (!prisma) return;
  await withPlatformContext(prisma, async (tx) => {
    for (const id of createdTenantIds) await tx.tenant.delete({ where: { id } }).catch(() => undefined);
  });
  await prisma.$disconnect();
});

const ctx = () =>
  ({
    prisma,
    email: {
      send: async (m: { to: string; subject: string; html?: string }) => {
        sent.push(m);
        return { sent: true };
      },
    },
  }) as never;

async function draftedTenant(opts: { submittedMinutesAgo: number; agentStatus?: "CONFIGURING" | "TESTING"; knowledgeStatus?: "READY" | "PENDING" }) {
  const submittedAt = new Date(Date.now() - opts.submittedMinutesAgo * MIN);
  const agentId = randomUUID();
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({
      data: {
        name: "Sunrise Dental",
        slug: `release-${randomUUID()}`,
        subscriptionState: "TRIAL",
        onboardingIntakeAt: submittedAt,
        onboardingIntake: {
          answers: { businessName: "Sunrise Dental", goals: ["answer_questions"], channels: ["website"], contactName: "Tendai Moyo" },
          files: [],
          autoBuild: { agentId, builtAt: submittedAt.toISOString(), releaseAt: new Date(submittedAt.getTime() + 30 * MIN).toISOString() },
        },
      },
    }),
  );
  createdTenantIds.push(tenant.id);
  const ownerEmail = `owner-${randomUUID()}@example.com`;
  const ownerId = randomUUID();
  await withTenant(prisma, { tenantId: tenant.id }, async (tx) => {
    await tx.user.create({ data: { id: ownerId, tenantId: tenant.id, email: ownerEmail, passwordHash: "x", role: "tenant_owner", displayName: "Tendai Moyo" } });
    await tx.agent.create({
      data: {
        id: agentId,
        tenantId: tenant.id,
        name: "Ava",
        status: opts.agentStatus ?? "CONFIGURING",
        personality: { tone: "friendly", name: "Ava", greeting: "Hi! I'm Ava.", languagePrimary: "en", languagesSupported: ["en"], systemInstructions: "x", guardrailPolicy: "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING" },
        modelRouting: { failoverChain: ["openai"] },
        enabledToolIds: [],
        crossAgentMemoryPeerIds: [],
        createdBySource: "STAFF_MANAGED_SETUP",
        createdByUserId: ownerId,
        lastEditedBySource: "STAFF_MANAGED_SETUP",
        lastEditedByUserId: ownerId,
      },
    });
    await tx.knowledgeSource.create({
      data: { tenantId: tenant.id, agentId, type: "MANUAL_FAQ", status: opts.knowledgeStatus ?? "READY", addedBySource: "STAFF_MANAGED_SETUP", addedByUserId: ownerId },
    });
  });
  const agentStatus = () =>
    withTenant(prisma, { tenantId: tenant.id }, (tx) => tx.agent.findUniqueOrThrow({ where: { id: agentId }, select: { status: true } })).then((a) => a.status);
  return { tenantId: tenant.id, ownerEmail, agentStatus };
}

const mailTo = (email: string) => sent.filter((m) => m.to === email);

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("releasing the questionnaire-drafted assistant", () => {
  it("waits for the 30 minutes, then moves it to Testing and emails the client once", async () => {
    const early = await draftedTenant({ submittedMinutesAgo: 29 });
    await runIntakeAgentReleaseSweep(ctx());
    expect(await early.agentStatus()).toBe("CONFIGURING");
    expect(mailTo(early.ownerEmail)).toHaveLength(0);

    const due = await draftedTenant({ submittedMinutesAgo: 31 });
    await runIntakeAgentReleaseSweep(ctx());
    await runIntakeAgentReleaseSweep(ctx());
    expect(await due.agentStatus()).toBe("TESTING");
    expect(mailTo(due.ownerEmail)).toHaveLength(1);
    expect(mailTo(due.ownerEmail)[0]!.subject).toBe("Ava is ready — your AI assistant for Sunrise Dental is set up");
    expect(mailTo(due.ownerEmail)[0]!.html).toContain("Hi Tendai,");
  });

  it("holds the release while its knowledge is still loading", async () => {
    const t = await draftedTenant({ submittedMinutesAgo: 35, knowledgeStatus: "PENDING" });
    await runIntakeAgentReleaseSweep(ctx());
    expect(await t.agentStatus()).toBe("CONFIGURING");
    expect(mailTo(t.ownerEmail)).toHaveLength(0);
  });

  it("stays quiet when staff already released it", async () => {
    const t = await draftedTenant({ submittedMinutesAgo: 40, agentStatus: "TESTING" });
    await runIntakeAgentReleaseSweep(ctx());
    expect(mailTo(t.ownerEmail)).toHaveLength(0);
    const intake = await withPlatformContext(prisma, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: t.tenantId }, select: { onboardingIntake: true } }));
    expect((intake.onboardingIntake as { autoBuild: { releasedAt?: string } }).autoBuild.releasedAt).toBeTruthy();
  });
});
