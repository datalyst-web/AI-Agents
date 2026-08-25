import type { Prisma } from "@chat-agent/db";
import type { QueueClient } from "@chat-agent/queue";
import { QUEUE_NAMES } from "@chat-agent/queue";
import type { WorkflowRunJob, WorkflowTriggerType } from "@chat-agent/shared-types";

/**
 * Producer side of the Workflow Engine (CLAUDE.md's TRIGGER -> AI DECISION
 * -> ACTION -> ... diagram) — fires every enabled WorkflowDefinition
 * matching (tenant, trigger type, optionally one agent) by enqueueing a
 * WorkflowRunJob per match. Lives here rather than in apps/api or
 * apps/workers specifically because both call it: apps/api fires
 * per-turn triggers (SENTIMENT_THRESHOLD_CROSSED, TOOL_FAILURE) from
 * engine/agentLoop.ts, apps/workers fires time-based ones
 * (CONVERSATION_ABANDONED, NO_REPLY_TIMEOUT) from a periodic sweep. A
 * workflow created in the dashboard is inert until something calls this —
 * don't add a new trigger-worthy event without wiring a call here.
 */
export async function fireWorkflowTrigger(
  tx: Prisma.TransactionClient,
  queue: QueueClient,
  params: {
    tenantId: string;
    agentId?: string;
    triggerType: WorkflowTriggerType;
    payload: Record<string, unknown>;
    /** Overrides the default SQS-or-Redis queue target — see createQueueClient(). */
    queueTarget?: string;
  },
): Promise<void> {
  const matches = await tx.workflowDefinition.findMany({
    where: {
      tenantId: params.tenantId,
      triggerType: params.triggerType,
      enabled: true,
      OR: [{ agentId: null }, { agentId: params.agentId }],
    },
    select: { id: true },
  });

  const queueTarget = params.queueTarget ?? QUEUE_NAMES.workflowRun;
  for (const workflow of matches) {
    const job: WorkflowRunJob = {
      tenantId: params.tenantId,
      workflowId: workflow.id,
      triggerPayload: params.payload,
    };
    await queue.enqueue(queueTarget, job);
  }
}
