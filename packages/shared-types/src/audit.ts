/**
 * Every staff action on a client's behalf must produce one of these — see
 * CLAUDE.md "Required audit trail". Also used for security-relevant
 * platform events (impersonation start/end, permission denials).
 */
export const AUDIT_ACTIONS = [
  "document_uploaded",
  "document_deleted",
  "website_crawled",
  "faq_added",
  "agent_instructions_edited",
  "agent_personality_edited",
  "agent_moved_to_testing",
  "agent_deleted",
  "knowledge_base_published",
  "agent_published_to_live",
  "agent_rolled_back",
  "tool_configured",
  "workflow_created",
  "workflow_edited",
  "impersonation_session_started",
  "impersonation_session_ended",
  "memory_forget_fulfilled",
  "billing_plan_changed",
  "team_member_invited",
  "team_member_removed",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  agentId?: string;
  actorUserId: string;
  actorIsStaff: boolean;
  action: AuditAction;
  /** e.g. "client-provided PDF", "transcribed from onboarding call", "client dashboard" */
  contentSource?: string;
  metadata: Record<string, unknown>;
  impersonationSessionId?: string;
  timestamp: string;
}
