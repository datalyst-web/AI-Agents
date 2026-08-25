import { randomUUID } from "node:crypto";
import type { Prisma } from "@chat-agent/db";
import type { WorkflowAction, WorkflowConditionGroup } from "@chat-agent/shared-types";
import { evaluateConditionGroup } from "./conditions.js";
import type { ActionExecutorMap, ActionExecutionContext } from "./actions.js";

export interface NotifyFn {
  (params: {
    tenantId: string;
    target: "tenant_owner" | "tenant_admin" | "staff_fallback";
    channel: "email" | "dashboard" | "sms";
    message: string;
  }): Promise<void>;
}

export interface RunWorkflowParams {
  tenantId: string;
  workflowId: string;
  agentId?: string;
  triggerType: string;
  triggerFilter?: WorkflowConditionGroup;
  actions: WorkflowAction[];
  triggerPayload: Record<string, unknown>;
}

interface ActionLogEntry {
  actionId: string;
  status: "succeeded" | "failed" | "skipped";
  attempt: number;
  output?: unknown;
  errorMessage?: string;
  at: string;
}

/**
 * TRIGGER -> AI DECISION (upstream, in apps/api/apps/workers) -> ACTION ->
 * CONDITION -> ACTION -> NOTIFICATION -> FOLLOW-UP, per CLAUDE.md's
 * Workflow Engine diagram. A failed action never silently drops — it
 * retries per its own retry config, then calls `notify` on the
 * `onFailureNotify` target and records FAILED_NOTIFIED, never just FAILED
 * with nobody told.
 */
export class WorkflowExecutor {
  constructor(
    private tx: Prisma.TransactionClient,
    private executors: ActionExecutorMap,
    private notify: NotifyFn,
  ) {}

  async run(params: RunWorkflowParams): Promise<{ runId: string; status: string }> {
    const runId = randomUUID();
    await this.tx.workflowRun.create({
      data: {
        id: runId,
        tenantId: params.tenantId,
        workflowId: params.workflowId,
        status: "RUNNING",
        triggerPayload: params.triggerPayload as Prisma.InputJsonValue,
        actionLog: [],
      },
    });

    if (params.triggerFilter && !evaluateConditionGroup(params.triggerFilter, params.triggerPayload)) {
      await this.tx.workflowRun.update({
        where: { id: runId },
        data: { status: "SUCCEEDED", completedAt: new Date(), actionLog: [] },
      });
      return { runId, status: "SUCCEEDED" };
    }

    const actionsById = new Map(params.actions.map((a) => [a.id, a]));
    const log: ActionLogEntry[] = [];
    let currentId = params.actions[0]?.id;
    let overallStatus: "SUCCEEDED" | "FAILED" | "FAILED_NOTIFIED" = "SUCCEEDED";

    while (currentId) {
      const action: WorkflowAction | undefined = actionsById.get(currentId);
      if (!action) break;

      const result = await this.runActionWithRetry(action, {
        tenantId: params.tenantId,
        agentId: params.agentId,
        triggerPayload: params.triggerPayload,
      });
      log.push(...result.attempts);

      if (result.succeeded) {
        currentId = action.nextOnSuccess;
      } else {
        await this.notify({
          tenantId: params.tenantId,
          target: action.onFailureNotify.target,
          channel: action.onFailureNotify.channel,
          message: `Workflow action "${action.type}" (${action.id}) failed after ${action.retry.maxAttempts} attempt(s) in run ${runId}.`,
        });
        overallStatus = "FAILED_NOTIFIED";
        currentId = action.nextOnFailure;
        if (!currentId) break;
      }
    }

    await this.tx.workflowRun.update({
      where: { id: runId },
      data: { status: overallStatus, completedAt: new Date(), actionLog: log as unknown as object },
    });

    return { runId, status: overallStatus };
  }

  private async runActionWithRetry(
    action: WorkflowAction,
    ctx: ActionExecutionContext,
  ): Promise<{ succeeded: boolean; attempts: ActionLogEntry[] }> {
    const executor = this.executors[action.type];
    const attempts: ActionLogEntry[] = [];

    if (!executor) {
      attempts.push({
        actionId: action.id,
        status: "failed",
        attempt: 1,
        errorMessage: `No executor registered for action type "${action.type}".`,
        at: new Date().toISOString(),
      });
      return { succeeded: false, attempts };
    }

    for (let attempt = 1; attempt <= action.retry.maxAttempts; attempt++) {
      try {
        const result = await executor(action, ctx);
        attempts.push({
          actionId: action.id,
          status: result.succeeded ? "succeeded" : "failed",
          attempt,
          output: result.output,
          errorMessage: result.errorMessage,
          at: new Date().toISOString(),
        });
        if (result.succeeded) return { succeeded: true, attempts };
      } catch (err) {
        attempts.push({
          actionId: action.id,
          status: "failed",
          attempt,
          errorMessage: err instanceof Error ? err.message : String(err),
          at: new Date().toISOString(),
        });
      }
      if (attempt < action.retry.maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, action.retry.backoffSeconds * 1000));
      }
    }
    return { succeeded: false, attempts };
  }
}
