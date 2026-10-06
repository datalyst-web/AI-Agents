import { randomUUID } from "node:crypto";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

/**
 * Ends paid subscriptions that weren't renewed. A Paynow payment buys 30
 * days (Tenant.paidUntil); without this a client who paid once stayed
 * ACTIVE forever.
 *
 * - 3 days before, and again on the last day: a renewal reminder.
 * - At paidUntil: PAST_DUE — a grace period. The agent keeps answering
 *   (PAST_DUE is not lapsed, see subscriptionAccess.ts) and the owner is told.
 * - GRACE_DAYS later, still unpaid: SUSPENDED. The agent pauses and the
 *   dashboard locks to Billing until they pay. Nothing is deleted.
 *
 * Only tenants with a paidUntil are touched — clients billed another way
 * (no Paynow payment) never get one, so this never cuts them off.
 * Each email is sent once per paid period: the audit entry records the
 * paidUntil it was about, so a renewal starts the reminders afresh.
 */
const REMINDER_DAYS_BEFORE = 3;
export const GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Same all-zero sentinel the agent loop and Paynow webhook use for "no human did this." */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export async function runSubscriptionRenewalSweep(ctx: WorkerContext): Promise<void> {
  const now = new Date();
  const tenants = await withPlatformContext(ctx.prisma, (tx) =>
    tx.tenant.findMany({
      where: { subscriptionState: { in: ["ACTIVE", "PAST_DUE"] }, paidUntil: { not: null } },
      select: { id: true, name: true, subscriptionState: true, paidUntil: true },
    }),
  );

  for (const tenant of tenants) {
    const paidUntil = tenant.paidUntil!;
    const period = paidUntil.toISOString();
    const billingUrl = `${env.DASHBOARD_BASE_URL}/billing`;
    const graceEnds = new Date(paidUntil.getTime() + GRACE_DAYS * DAY_MS);

    if (tenant.subscriptionState === "PAST_DUE" && graceEnds <= now) {
      await changeState(ctx, tenant.id, "PAST_DUE", "SUSPENDED");
      await notifyOwnersOnce(ctx, tenant.id, "subscription_suspended_notice_sent", period, {
        subject: `Your ${tenant.name} assistant is paused`,
        text:
          `Your subscription wasn't renewed, so your AI assistant has stopped answering customers.\n\n` +
          `Nothing has been deleted — renew now and it starts answering again straight away:\n${billingUrl}`,
      });
      continue;
    }

    if (tenant.subscriptionState === "ACTIVE" && paidUntil <= now) {
      await changeState(ctx, tenant.id, "ACTIVE", "PAST_DUE");
      await notifyOwnersOnce(ctx, tenant.id, "subscription_ended_notice_sent", period, {
        subject: `Your ${tenant.name} subscription has ended — renew within ${GRACE_DAYS} days`,
        text:
          `Your 30-day subscription ended today. Your assistant is still answering customers for ${GRACE_DAYS} more days.\n\n` +
          `Renew before ${graceEnds.toDateString()} to keep it running without a break:\n${billingUrl}`,
      });
      continue;
    }

    if (tenant.subscriptionState === "PAST_DUE") {
      // Last day of grace: one final nudge before the assistant pauses.
      if (graceEnds.getTime() - now.getTime() <= DAY_MS) {
        await notifyOwnersOnce(ctx, tenant.id, "subscription_grace_last_day_sent", period, {
          subject: `Last day to renew ${tenant.name}`,
          text: `Your assistant pauses within 24 hours unless your subscription is renewed:\n${billingUrl}`,
        });
      }
      continue;
    }

    const msLeft = paidUntil.getTime() - now.getTime();
    if (msLeft <= DAY_MS) {
      await notifyOwnersOnce(ctx, tenant.id, "subscription_last_day_reminder_sent", period, {
        subject: `${tenant.name}: your subscription renews tomorrow`,
        text: `Your 30-day subscription ends within 24 hours. Renew now so your assistant never misses a customer:\n${billingUrl}`,
      });
    } else if (msLeft <= REMINDER_DAYS_BEFORE * DAY_MS) {
      const daysLeft = Math.ceil(msLeft / DAY_MS);
      await notifyOwnersOnce(ctx, tenant.id, "subscription_renewal_reminder_sent", period, {
        subject: `${tenant.name}: your subscription ends in ${daysLeft} days`,
        text:
          `Your 30-day subscription ends on ${paidUntil.toDateString()}.\n\n` +
          `Renew in a minute, in US dollars or ZiG, to keep your assistant answering without a break:\n${billingUrl}`,
      });
    }
  }
}

async function changeState(ctx: WorkerContext, tenantId: string, from: "ACTIVE" | "PAST_DUE", to: "PAST_DUE" | "SUSPENDED") {
  await withPlatformContext(ctx.prisma, async (tx) => {
    // Conditional, so a payment landing mid-sweep is never overwritten.
    const { count } = await tx.tenant.updateMany({ where: { id: tenantId, subscriptionState: from }, data: { subscriptionState: to } });
    if (count === 1) {
      await tx.subscriptionStateChange.create({ data: { id: randomUUID(), tenantId, fromState: from, toState: to } });
    }
  });
}

async function notifyOwnersOnce(
  ctx: WorkerContext,
  tenantId: string,
  action: string,
  period: string,
  message: { subject: string; text: string },
): Promise<void> {
  const alreadySent = await withTenant(ctx.prisma, { tenantId }, (tx) =>
    tx.auditLogEntry.findFirst({ where: { tenantId, action, metadata: { path: ["paidUntil"], equals: period } } }),
  );
  if (alreadySent) return;

  const owners = await withTenant(ctx.prisma, { tenantId }, (tx) =>
    tx.user.findMany({ where: { tenantId, isActive: true, role: { in: ["tenant_owner", "tenant_admin"] } }, select: { email: true } }),
  );
  await Promise.all(owners.map((o) => ctx.email.send({ to: o.email, subject: message.subject, text: message.text })));
  await withTenant(ctx.prisma, { tenantId }, (tx) =>
    tx.auditLogEntry.create({
      data: { id: randomUUID(), tenantId, actorUserId: SYSTEM_ACTOR_ID, actorIsStaff: false, action, metadata: { paidUntil: period } },
    }),
  );
}
