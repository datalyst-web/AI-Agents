import { withTenant } from "@chat-agent/db";
import { WorkflowExecutor, waitActionExecutor, type NotifyFn } from "@chat-agent/workflow-engine";
import type { WorkflowRunJob } from "@chat-agent/shared-types";
import type { WorkerContext } from "../context.js";
import { buildWorkflowActionExecutors } from "./workflowActions.js";

/**
 * A failed workflow action must never silently drop (CLAUDE.md Workflow
 * Engine). Real channel delivery (SES for email, a dashboard notification
 * row, SNS for SMS) is a follow-up integration point per channel; today
 * every notification is durably recorded via the audit log so nothing is
 * lost even before those channels are wired in.
 */
function buildNotify(ctx: WorkerContext): NotifyFn {
  return async ({ tenantId, target, channel, message }) => {
    await withTenant(ctx.prisma, { tenantId }, (tx) =>
      tx.auditLogEntry.create({
        data: {
          tenantId,
          actorUserId: "system:workflow-engine",
          actorIsStaff: false,
          action: "workflow_edited",
          metadata: { notification: true, target, channel, message },
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
