import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

/**
 * The paid 30-day lifecycle against the real RLS-enforced chat_app_user
 * connection: reminder before the end (once per period), PAST_DUE grace at
 * the end, SUSPENDED after the grace period, and never touching a client
 * with no paidUntil (billed another way).
 */

let prisma: import("@chat-agent/db").PrismaClient;
let withPlatformContext: typeof import("@chat-agent/db").withPlatformContext;
let withTenant: typeof import("@chat-agent/db").withTenant;
let runSubscriptionRenewalSweep: typeof import("./subscriptionRenewalSweep.js").runSubscriptionRenewalSweep;
const sent: { to: string; subject: string }[] = [];
const createdTenantIds: string[] = [];
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  if (!process.env.CHAT_APP_DATABASE_URL) return;
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? process.env.CHAT_APP_DATABASE_URL;
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-not-real-0123456789";
  process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
  const db = await import("@chat-agent/db");
  ({ withPlatformContext, withTenant } = db);
  prisma = db.createPrismaClient(process.env.CHAT_APP_DATABASE_URL);
  ({ runSubscriptionRenewalSweep } = await import("./subscriptionRenewalSweep.js"));
});

afterAll(async () => {
  if (!prisma) return;
  await withPlatformContext(prisma, async (tx) => {
    for (const id of createdTenantIds) await tx.tenant.delete({ where: { id } }).catch(() => undefined);
  });
  await prisma.$disconnect();
});

function ctx() {
  return {
    prisma,
    email: {
      send: async (m: { to: string; subject: string }) => {
        sent.push({ to: m.to, subject: m.subject });
        return { sent: true };
      },
    },
  } as never;
}

async function tenantWith(state: "ACTIVE" | "PAST_DUE", paidUntil: Date | null) {
  const tenant = await withPlatformContext(prisma, (tx) =>
    tx.tenant.create({ data: { name: `Renewal Co ${randomUUID().slice(0, 8)}`, slug: `renew-${randomUUID()}`, subscriptionState: state, paidUntil } }),
  );
  createdTenantIds.push(tenant.id);
  const email = `owner-${randomUUID()}@example.com`;
  await withTenant(prisma, { tenantId: tenant.id }, (tx) =>
    tx.user.create({ data: { id: randomUUID(), tenantId: tenant.id, email, passwordHash: "x", role: "tenant_owner", displayName: "Owner" } }),
  );
  return { id: tenant.id, email };
}

const stateOf = (id: string) =>
  withPlatformContext(prisma, (tx) => tx.tenant.findUniqueOrThrow({ where: { id }, select: { subscriptionState: true } })).then((t) => t.subscriptionState);
const mailTo = (email: string) => sent.filter((m) => m.to === email);

describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("subscription renewal sweep", () => {
  it("reminds once, two days out, and leaves the client ACTIVE", async () => {
    const t = await tenantWith("ACTIVE", new Date(Date.now() + 2 * DAY + 60_000));
    await runSubscriptionRenewalSweep(ctx());
    await runSubscriptionRenewalSweep(ctx());
    expect(await stateOf(t.id)).toBe("ACTIVE");
    expect(mailTo(t.email)).toHaveLength(1);
    expect(mailTo(t.email)[0]!.subject).toMatch(/ends in 3 days|ends in 2 days/);
  });

  it("moves an ended period to PAST_DUE (grace), telling the owner once", async () => {
    const t = await tenantWith("ACTIVE", new Date(Date.now() - 60_000));
    await runSubscriptionRenewalSweep(ctx());
    await runSubscriptionRenewalSweep(ctx());
    expect(await stateOf(t.id)).toBe("PAST_DUE");
    expect(mailTo(t.email).filter((m) => /has ended/.test(m.subject))).toHaveLength(1);
  });

  it("suspends once the grace period is over", async () => {
    const t = await tenantWith("PAST_DUE", new Date(Date.now() - 4 * DAY));
    await runSubscriptionRenewalSweep(ctx());
    expect(await stateOf(t.id)).toBe("SUSPENDED");
    expect(mailTo(t.email).some((m) => /paused/.test(m.subject))).toBe(true);
  });

  it("never touches a client with no paid-until date", async () => {
    const t = await tenantWith("ACTIVE", null);
    await runSubscriptionRenewalSweep(ctx());
    expect(await stateOf(t.id)).toBe("ACTIVE");
    expect(mailTo(t.email)).toHaveLength(0);
  });
});
