import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

/**
 * Notifies every team member who's opted into escalation notifications
 * (User.notifyEscalationEmail/-Sms/-Push) whenever one of their tenant's
 * conversations gets handed off to a human. A periodic sweep rather than
 * sending inline from engine/agentLoop.ts on purpose: that function has no
 * notification dependency threaded through it today, and adding one just
 * for this would touch every one of its call sites for a notification
 * that's fine arriving a few minutes late.
 *
 * Each channel degrades independently and silently to a logging no-op if
 * its provider isn't configured on this deployment (see
 * createSmsProviderFromEnv/createPushProviderFromEnv) — a tenant opting
 * into SMS on a deployment with no Twilio credentials just gets logged,
 * never a thrown error that would take the whole sweep down.
 */
export async function runEscalationNotificationSweep(ctx: WorkerContext): Promise<void> {
  const pending = await withPlatformContext(ctx.prisma, (tx) =>
    tx.conversation.findMany({
      where: { handoffRequested: true, handoffNotifiedAt: null },
      select: { id: true, tenantId: true, agentId: true, handoffSummary: true, startedAt: true },
      take: 100,
    }),
  );
  if (pending.length === 0) return;

  for (const conversation of pending) {
    await withTenant(ctx.prisma, { tenantId: conversation.tenantId, agentId: conversation.agentId }, async (tx) => {
      const [recipients, tenant, agent] = await Promise.all([
        tx.user.findMany({
          where: {
            tenantId: conversation.tenantId,
            isActive: true,
            OR: [{ notifyEscalationEmail: true }, { notifyEscalationSms: true }, { notifyEscalationPush: true }],
          },
          select: { id: true, email: true, phoneNumber: true, notifyEscalationEmail: true, notifyEscalationSms: true, notifyEscalationPush: true },
        }),
        tx.tenant.findUniqueOrThrow({ where: { id: conversation.tenantId }, select: { name: true } }),
        tx.agent.findUniqueOrThrow({ where: { id: conversation.agentId }, select: { name: true } }),
      ]);

      if (recipients.length > 0) {
        const dashboardUrl = `${env.DASHBOARD_BASE_URL}/agents/${conversation.agentId}?tab=Conversations`;
        const summary =
          conversation.handoffSummary && typeof conversation.handoffSummary === "object"
            ? (conversation.handoffSummary as { problem?: string; recommendedNextStep?: string })
            : null;
        const shortText = `${agent.name} needs a human — ${tenant.name}.${summary?.problem ? ` Problem: ${summary.problem}.` : ""} ${dashboardUrl}`;

        await Promise.all(
          recipients.map(async (r) => {
            const tasks: Promise<unknown>[] = [];
            if (r.notifyEscalationEmail) {
              tasks.push(
                ctx.email.send({
                  to: r.email,
                  subject: `${agent.name} needs a human — ${tenant.name}`,
                  text: `A conversation with ${agent.name} was escalated and needs your attention.${
                    summary?.problem ? `\n\nProblem: ${summary.problem}` : ""
                  }${summary?.recommendedNextStep ? `\nRecommended next step: ${summary.recommendedNextStep}` : ""}\n\nOpen it here: ${dashboardUrl}`,
                  html: `<p>A conversation with <strong>${agent.name}</strong> was escalated and needs your attention.</p>${
                    summary?.problem ? `<p><strong>Problem:</strong> ${summary.problem}</p>` : ""
                  }${
                    summary?.recommendedNextStep ? `<p><strong>Recommended next step:</strong> ${summary.recommendedNextStep}</p>` : ""
                  }<p><a href="${dashboardUrl}">Open the conversation</a></p>`,
                }),
              );
            }
            if (r.notifyEscalationSms && r.phoneNumber) {
              tasks.push(ctx.sms.send({ to: r.phoneNumber, body: shortText }));
            }
            if (r.notifyEscalationPush) {
              const subscriptions = await tx.pushSubscription.findMany({ where: { userId: r.id } });
              for (const sub of subscriptions) {
                tasks.push(
                  ctx.push.send(sub, { title: `${agent.name} needs a human`, body: `${tenant.name} — ${summary?.problem ?? "A conversation was escalated."}`, url: dashboardUrl }).then(
                    async (result) => {
                      // The browser unsubscribed or the subscription expired — stop retrying it forever.
                      if (result.gone) await tx.pushSubscription.deleteMany({ where: { id: sub.id } });
                    },
                  ),
                );
              }
            }
            await Promise.all(tasks);
          }),
        );
      }

      await tx.conversation.update({ where: { id: conversation.id }, data: { handoffNotifiedAt: new Date() } });
    });
  }
}
