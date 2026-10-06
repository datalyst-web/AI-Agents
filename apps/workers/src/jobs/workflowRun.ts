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

export async function runWorkflowJob(ctx: WorkerContext, job: WorkflowRunJob, queueTarget: string): Promise<void> {
  // Woken before the wait ended (SQS caps a delay at 15 minutes) — go back to sleep.
  if (job.resume) {
    const remainingSeconds = Math.ceil((Date.parse(job.resume.notBefore) - Date.now()) / 1000);
    if (remainingSeconds > 0) {
      await ctx.queue.enqueue(queueTarget, job, { delaySeconds: remainingSeconds });
      return;
    }
  }

  const executors = { ...buildWorkflowActionExecutors(ctx), WAIT: waitActionExecutor };
  const notify = buildNotify(ctx);

  const result = await withTenant(ctx.prisma, { tenantId: job.tenantId }, async (tx) => {
    const workflow = await tx.workflowDefinition.findFirstOrThrow({
      where: { id: job.workflowId, tenantId: job.tenantId },
    });
    if (!workflow.enabled) {
      // Disabled during a wait: close the paused run rather than leave it RUNNING forever.
      if (job.resume) {
        await tx.workflowRun.updateMany({
          where: { id: job.resume.runId, tenantId: job.tenantId, status: "RUNNING" },
          data: { status: "SUCCEEDED", completedAt: new Date() },
        });
      }
      return undefined;
    }

    const executor = new WorkflowExecutor(tx, executors, notify);
    return executor.run({
      tenantId: job.tenantId,
      workflowId: workflow.id,
      agentId: workflow.agentId ?? undefined,
      triggerType: workflow.triggerType,
      triggerFilter: workflow.triggerFilter as never,
      actions: workflow.actions as never,
      triggerPayload: job.triggerPayload,
      resume: job.resume ? { runId: job.resume.runId, actionId: job.resume.actionId } : undefined,
    });
  });

  // Scheduled only after the transaction committed the paused run, so the
  // resume job can never find it missing.
  if (result?.wait) {
    const resumeJob: WorkflowRunJob = {
      tenantId: job.tenantId,
      workflowId: job.workflowId,
      triggerPayload: job.triggerPayload,
      resume: {
        ...result.wait.resume,
        notBefore: new Date(Date.now() + result.wait.seconds * 1000).toISOString(),
      },
    };
    await ctx.queue.enqueue(queueTarget, resumeJob, { delaySeconds: result.wait.seconds });
  }
}
