import { randomUUID } from "node:crypto";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

/**
 * Ends free trials that have run their course. Without this a tenant set
 * to TRIAL at signup stays on a free plan permanently.
 *
 * Suspends rather than deletes or cancels (CLAUDE.md Client Lifecycle: "On
 * expiry, suspend the agent — never delete client data") so everything the
 * client built during the trial is still there the moment they pay. The
 * agent stops answering because chat.routes.ts already refuses SUSPENDED
 * tenants — no separate enforcement needed here.
 *
 * Also sends a heads-up email three days out, so the first thing a client
 * hears about their trial ending isn't their agent going quiet.
 */
const REMINDER_DAYS_BEFORE = 3;

export async function runTrialExpirySweep(ctx: WorkerContext): Promise<void> {
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + REMINDER_DAYS_BEFORE * 24 * 60 * 60 * 1000);

  const trialing = await withPlatformContext(ctx.prisma, (tx) =>
    tx.tenant.findMany({
      where: { subscriptionState: "TRIAL", trialEndsAt: { not: null } },
      select: { id: true, name: true, trialEndsAt: true },
    }),
  );

  for (const tenant of trialing) {
    const endsAt = tenant.trialEndsAt!;

    if (endsAt <= now) {
      await withPlatformContext(ctx.prisma, async (tx) => {
        await tx.tenant.update({ where: { id: tenant.id }, data: { subscriptionState: "SUSPENDED" } });
        await tx.subscriptionStateChange.create({
          data: { id: randomUUID(), tenantId: tenant.id, fromState: "TRIAL", toState: "SUSPENDED" },
        });
      });
      await notifyOwners(ctx, tenant.id, {
        subject: `Your ${tenant.name} trial has ended`,
        text:
          `Your free trial has ended and your agent has been paused.\n\n` +
          `Nothing has been deleted — your knowledge base, agent configuration and conversation history are all still here. ` +
          `Choose a plan and your agent starts answering again immediately.\n\n${env.DASHBOARD_BASE_URL}/billing`,
      });
      continue;
    }

    // One reminder, in the window between three days out and expiry. The
    // sweep runs hourly, so this would re-send on every pass — the
    // TRIAL_REMINDER audit entry below is what makes it fire only once.
    if (endsAt <= reminderCutoff) {
      const alreadyReminded = await withTenant(ctx.prisma, { tenantId: tenant.id }, (tx) =>
        tx.auditLogEntry.findFirst({ where: { tenantId: tenant.id, action: "trial_ending_reminder_sent" } }),
      );
      if (alreadyReminded) continue;

      const daysLeft = Math.max(1, Math.ceil((endsAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));
      await notifyOwners(ctx, tenant.id, {
        subject: `Your ${tenant.name} trial ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}`,
        text:
          `Your free trial ends in ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.\n\n` +
          `To keep your agent answering without interruption, choose a plan here:\n${env.DASHBOARD_BASE_URL}/billing`,
      });
      await withTenant(ctx.prisma, { tenantId: tenant.id }, (tx) =>
        tx.auditLogEntry.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            actorUserId: SYSTEM_ACTOR_ID,
            actorIsStaff: false,
            action: "trial_ending_reminder_sent",
            metadata: { daysLeft },
          },
        }),
      );
    }
  }
}

/** Same all-zero sentinel the agent loop and Paynow webhook use for "no human did this." */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

async function notifyOwners(ctx: WorkerContext, tenantId: string, message: { subject: string; text: string }) {
  const owners = await withTenant(ctx.prisma, { tenantId }, (tx) =>
    tx.user.findMany({ where: { tenantId, isActive: true, role: { in: ["tenant_owner", "tenant_admin"] } }, select: { email: true } }),
  );
  await Promise.all(owners.map((o) => ctx.email.send({ to: o.email, subject: message.subject, text: message.text })));
}
