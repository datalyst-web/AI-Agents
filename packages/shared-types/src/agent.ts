import { z } from "zod";

export const AgentStatusSchema = z.enum([
  "DRAFT",
  "CONFIGURING",
  "KNOWLEDGE_PROCESSING",
  "TESTING",
  "APPROVED",
  "LIVE",
]);
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const ContentSourceSchema = z.enum([
  "CLIENT",
  "STAFF_MANAGED_SETUP",
]);
export type ContentSource = z.infer<typeof ContentSourceSchema>;

export const AgentPersonalitySchema = z.object({
  tone: z.enum(["friendly", "professional", "playful", "formal", "empathetic"]).default("friendly"),
  name: z.string().min(1).max(60),
  avatarUrl: z.string().url().optional(),
  greeting: z.string().min(1).max(2000),
  languagePrimary: z.string().default("en"),
  languagesSupported: z.array(z.string()).default(["en"]),
  systemInstructions: z.string().min(1),
  /** Anti-hallucination guardrail text, always appended, never removable by tenant config. */
  guardrailPolicy: z.literal(
    "PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING",
  ).default("PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING"),
});
export type AgentPersonality = z.infer<typeof AgentPersonalitySchema>;

export const ModelRoutingPreferenceSchema = z.object({
  preferredProvider: z.enum(["anthropic", "openai", "gemini"]).optional(),
  failoverChain: z.array(z.enum(["anthropic", "openai", "gemini"])).default([
    "anthropic",
    "openai",
    "gemini",
  ]),
  maxCostPerConversationUsd: z.number().positive().optional(),
  reasoningEffort: z.enum(["low", "medium", "high"]).default("medium"),
});
export type ModelRoutingPreference = z.infer<typeof ModelRoutingPreferenceSchema>;

export interface Agent {
  id: string;
  tenantId: string;
  name: string;
  status: AgentStatus;
  version: string; // e.g. "v1.2"
  personality: AgentPersonality;
  modelRouting: ModelRoutingPreference;
  enabledToolIds: string[];
  crossAgentMemoryPeerIds: string[]; // opt-in, per pair, off by default
  createdBySource: ContentSource;
  createdByUserId: string;
  lastEditedBySource: ContentSource;
  lastEditedByUserId: string;
  approvedByClientUserId?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentVersionSnapshot {
  id: string;
  agentId: string;
  tenantId: string;
  version: string;
  personality: AgentPersonality;
  modelRouting: ModelRoutingPreference;
  enabledToolIds: string[];
  knowledgeSnapshotId: string;
  status: AgentStatus;
  publishedAt?: string;
  rolledBackFromVersion?: string;
  createdAt: string;
}
