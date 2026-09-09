import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

/**
 * Emails every team member who's opted into escalation notifications
 * (User.notifyEscalationEmail) whenever one of their tenant's
 * conversations gets handed off to a human — SMS/push aren't sent here,
 * this platform has no Twilio/FCM credentials (see
 * User.notifyEscalationSms/-Push's own schema comment). A periodic sweep
 * rather than sending inline from engine/agentLoop.ts on purpose: that
 * function has no email dependency threaded through it today, and adding
 * one just for this would touch every one of its call sites for a
 * notification that's fine arriving a few minutes late.
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
          where: { tenantId: conversation.tenantId, isActive: true, notifyEscalationEmail: true },
          select: { email: true },
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
        await Promise.all(
          recipients.map((r) =>
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
          ),
        );
      }

      await tx.conversation.update({ where: { id: conversation.id }, data: { handoffNotifiedAt: new Date() } });
    });
  }
}
