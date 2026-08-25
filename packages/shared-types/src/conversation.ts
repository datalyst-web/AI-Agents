import { z } from "zod";

export const ConversationChannelSchema = z.enum([
  "WIDGET",
  "STANDALONE_URL",
  "API",
]);
export type ConversationChannel = z.infer<typeof ConversationChannelSchema>;

export const ConversationOutcomeSchema = z.enum([
  "RESOLVED",
  "ESCALATED_TO_HUMAN",
  "ABANDONED",
  "IN_PROGRESS",
]);
export type ConversationOutcome = z.infer<typeof ConversationOutcomeSchema>;

export const DropOffPointSchema = z.enum([
  "GREETING",
  "KNOWLEDGE_LOOKUP",
  "TOOL_EXECUTION",
  "HANDOFF_WAIT",
  "NONE",
]);
export type DropOffPoint = z.infer<typeof DropOffPointSchema>;

export const MessageRoleSchema = z.enum(["customer", "agent", "system", "tool", "staff"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** One step of the agent loop, recorded for every assistant turn — see CLAUDE.md's loop. */
export const AgentLoopStageSchema = z.enum([
  "UNDERSTAND",
  "RETRIEVE",
  "REASON",
  "DECIDE",
  "ACT",
  "VERIFY",
  "RESPOND",
  "RECORD",
]);
export type AgentLoopStage = z.infer<typeof AgentLoopStageSchema>;

export interface ToolInvocationRecord {
  toolId: string;
  toolName: string;
  input: unknown;
  output: unknown;
  succeeded: boolean;
  errorMessage?: string;
  executionTier: "automatic" | "confirmation_required" | "human_approval";
  confirmedByCustomer: boolean;
  startedAt: string;
  completedAt: string;
}

export interface RetrievedKnowledgeChunk {
  chunkId: string;
  documentId: string;
  knowledgeSourceId: string;
  score: number;
  textSnippet: string;
}

export interface Message {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** Populated only for assistant turns — traceability into the agent loop. */
  loopTrace?: {
    stage: AgentLoopStage;
    retrievedKnowledge?: RetrievedKnowledgeChunk[];
    toolInvocations?: ToolInvocationRecord[];
    modelProvider?: "anthropic" | "openai" | "gemini";
    modelId?: string;
    inputTokens?: number;
    outputTokens?: number;
  }[];
  sentimentScore?: number; // -1..1
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  agentId: string;
  channel: ConversationChannel;
  customerIdentityId?: string; // links to CrossConversationMemory subject
  outcome: ConversationOutcome;
  businessResult?: string; // tenant-defined outcome type, e.g. "lead_qualified"
  dropOffPoint: DropOffPoint;
  sentimentTrend: number[]; // per-turn sentiment scores in order
  handoffRequested: boolean;
  handoffSummary?: HandoffSummary;
  startedAt: string;
  endedAt?: string;
}

export const HandoffSummarySchema = z.object({
  customer: z.string(),
  request: z.string(),
  problem: z.string(),
  informationCollected: z.record(z.string(), z.unknown()),
  actionsAttempted: z.array(z.string()),
  recommendedNextStep: z.string(),
});
export type HandoffSummary = z.infer<typeof HandoffSummarySchema>;
