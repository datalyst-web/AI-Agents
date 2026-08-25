import { z } from "zod";

export const WorkflowTriggerTypeSchema = z.enum([
  "NEW_LEAD",
  "CONVERSATION_ENDED",
  "CONVERSATION_ABANDONED",
  "TOOL_FAILURE",
  "CRM_FIELD_CHANGE",
  "FORM_SUBMITTED",
  "SENTIMENT_THRESHOLD_CROSSED",
  "NO_REPLY_TIMEOUT",
  /** Fires on every human handoff (explicit request, frustration, or tool failure) — see CLAUDE.md's Human Handoff section. */
  "HANDOFF_REQUESTED",
]);
export type WorkflowTriggerType = z.infer<typeof WorkflowTriggerTypeSchema>;

export const ConditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "greater_than",
  "less_than",
  "exists",
  "not_exists",
]);
export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export interface WorkflowCondition {
  field: string; // dot-path into the trigger payload
  operator: z.infer<typeof ConditionOperatorSchema>;
  value?: unknown;
}

export interface WorkflowConditionGroup {
  logic: "AND" | "OR";
  conditions: (WorkflowCondition | WorkflowConditionGroup)[];
}

export const WorkflowActionTypeSchema = z.enum([
  "CREATE_CRM_RECORD",
  "SEND_EMAIL",
  "SEND_NOTIFICATION",
  "CALL_WEBHOOK",
  "CREATE_TICKET",
  "SCORE_LEAD",
  "WAIT",
  "TRIGGER_TOOL",
]);
export type WorkflowActionType = z.infer<typeof WorkflowActionTypeSchema>;

export interface WorkflowAction {
  id: string;
  type: WorkflowActionType;
  config: Record<string, unknown>;
  retry: {
    maxAttempts: number;
    backoffSeconds: number;
  };
  /** Required — a failed action must never silently drop, per CLAUDE.md. */
  onFailureNotify: {
    target: "tenant_owner" | "tenant_admin" | "staff_fallback";
    channel: "email" | "dashboard" | "sms";
  };
  nextOnSuccess?: string; // action id
  nextOnFailure?: string; // action id
}

export interface WorkflowDefinition {
  id: string;
  tenantId: string;
  agentId?: string;
  name: string;
  version: number;
  enabled: boolean;
  trigger: {
    type: WorkflowTriggerType;
    filter?: WorkflowConditionGroup;
  };
  actions: WorkflowAction[]; // first action is the entry point
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export const WorkflowRunStatusSchema = z.enum([
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "FAILED_NOTIFIED",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export interface WorkflowRun {
  id: string;
  tenantId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  triggerPayload: Record<string, unknown>;
  actionLog: {
    actionId: string;
    status: "succeeded" | "failed" | "skipped";
    attempt: number;
    output?: unknown;
    errorMessage?: string;
    at: string;
  }[];
  startedAt: string;
  completedAt?: string;
}
