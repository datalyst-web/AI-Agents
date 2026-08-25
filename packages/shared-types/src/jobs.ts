/**
 * Cross-app job payload contracts — apps/api enqueues these, apps/workers
 * consumes them (see packages/queue). Kept here rather than duplicated in
 * each app so a payload-shape change is a single-package edit, not a
 * silent producer/consumer mismatch.
 */
export interface KnowledgeIngestJob {
  tenantId: string;
  agentId: string;
  knowledgeSourceId: string;
  kind: "FILE" | "WEBSITE_CRAWL" | "MANUAL_FAQ";
  s3Key?: string;
  originalFilename?: string;
  fileType?: "PDF" | "DOCX" | "TXT" | "CSV";
  startUrls?: string[];
  faqEntries?: { question: string; answer: string }[];
}

export interface WorkflowRunJob {
  tenantId: string;
  workflowId: string;
  triggerPayload: Record<string, unknown>;
}

export interface FollowupJob {
  tenantId: string;
  agentId: string;
  conversationId: string;
  kind: "abandoned_conversation" | "appointment_reminder" | "no_reply_timeout";
  scheduledFor: string;
}
