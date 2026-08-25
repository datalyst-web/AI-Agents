import type { WorkflowAction, WorkflowActionType } from "@chat-agent/shared-types";

export interface ActionExecutionContext {
  tenantId: string;
  agentId?: string;
  triggerPayload: Record<string, unknown>;
}

export interface ActionExecutionResult {
  succeeded: boolean;
  output?: unknown;
  errorMessage?: string;
}

export type ActionExecutor = (
  action: WorkflowAction,
  ctx: ActionExecutionContext,
) => Promise<ActionExecutionResult>;

/**
 * apps/workers registers one executor per action type at startup (backed
 * by packages/tool-sdk for CRM/email/webhook, or direct DB writes for
 * SCORE_LEAD). Kept as an injected map rather than importing tool-sdk here
 * to avoid a circular workspace dependency and to let apps/workers choose
 * concrete integrations without this package needing to know about them.
 */
export type ActionExecutorMap = Partial<Record<WorkflowActionType, ActionExecutor>>;

export const waitActionExecutor: ActionExecutor = async (action) => {
  const seconds = typeof action.config.seconds === "number" ? action.config.seconds : 0;
  // Real waits are handled by the caller scheduling a delayed job (SQS
  // delay seconds / EventBridge scheduler) rather than blocking a worker
  // thread — this executor exists so WAIT still appears in the action log.
  return { succeeded: true, output: { waitedSeconds: seconds } };
};
