import { withTenant } from "@chat-agent/db";
import { WorkflowExecutor, waitActionExecutor, type NotifyFn } from "@chat-agent/workflow-engine";
import type { WorkflowRunJob } from "@chat-agent/shared-types";
import type { WorkerContext } from "../context.js";
import { buildWorkflowActionExecutors } from "./workflowActions.js";
import { resolveNotifyRecipientEmail } from "../lib/notifyRecipient.js";

/**
 * A failed workflow action must never silently drop (CLAUDE.md Workflow
 * Engine). Every notification is durably recorded via the audit log
 * regardless of channel, so nothing is ever lost even if delivery itself
 * fails or a channel isn't wired up yet. "email" additionally delivers
 * for real via the platform EmailProvider (packages/email) — "dashboard"
 * is genuinely visible today via the Audit Log page, just not yet a
 * dedicated notification inbox; "sms" has no provider wired and stays
 * audit-log-only until one is.
 */
function buildNotify(ctx: WorkerContext): NotifyFn {
  return async ({ tenantId, target, channel, message }) => {
    let emailedTo: string | undefined;
    if (channel === "email") {
      const to = await resolveNotifyRecipientEmail(ctx.prisma, tenantId, target);
      if (to) {
        const result = await ctx.email.send({ to, subject: "Workflow notification", text: message });
        if (result.sent) emailedTo = to;
      }
    }

    await withTenant(ctx.prisma, { tenantId }, (tx) =>
      tx.auditLogEntry.create({
        data: {
          tenantId,
          actorUserId: "system:workflow-engine",
          actorIsStaff: false,
          action: "workflow_edited",
          metadata: { notification: true, target, channel, message, emailedTo: emailedTo ?? null },
        },
      }),
    );
  };
}

export async function runWorkflowJob(ctx: WorkerContext, job: WorkflowRunJob): Promise<void> {
  const executors = { ...buildWorkflowActionExecutors(ctx), WAIT: waitActionExecutor };
  const notify = buildNotify(ctx);

  await withTenant(ctx.prisma, { tenantId: job.tenantId }, async (tx) => {
    const workflow = await tx.workflowDefinition.findFirstOrThrow({
      where: { id: job.workflowId, tenantId: job.tenantId },
    });
    if (!workflow.enabled) return;

    const executor = new WorkflowExecutor(tx, executors, notify);
    await executor.run({
      tenantId: job.tenantId,
      workflowId: workflow.id,
      agentId: workflow.agentId ?? undefined,
      triggerType: workflow.triggerType,
      triggerFilter: workflow.triggerFilter as never,
      actions: workflow.actions as never,
      triggerPayload: job.triggerPayload,
    });
  });
}
