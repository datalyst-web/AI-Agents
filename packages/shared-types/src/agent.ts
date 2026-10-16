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

/** Messaging channels a reply delay can apply to. The website widget always answers straight away. */
export const PACEABLE_CHANNELS = ["WHATSAPP", "TELEGRAM", "FACEBOOK_MESSENGER", "INSTAGRAM"] as const;

/**
 * How quickly the agent answers on messaging channels.
 *
 * - instant: as soon as the reply is ready.
 * - fixed: waits `delaySeconds` after the customer's message.
 * - humanlike: a reading-and-typing pause that grows with how much the
 *   customer wrote, between `minSeconds` and `maxSeconds`, with a little
 *   natural variation.
 *
 * With `mergeBurst`, the wait restarts on each new message, so a customer
 * who sends three quick messages gets one considered reply to all three
 * (and one model call instead of three). Capped at 15 minutes — the
 * longest a queued message can be held back (packages/queue).
 */
export const ReplyPacingSchema = z.object({
  mode: z.enum(["instant", "fixed", "humanlike"]).default("instant"),
  delaySeconds: z.number().int().min(1).max(900).default(60),
  minSeconds: z.number().int().min(0).max(900).default(3),
  maxSeconds: z.number().int().min(1).max(900).default(40),
  mergeBurst: z.boolean().default(true),
  /** "Typing…" (and WhatsApp's blue ticks) just before the reply lands. */
  typingIndicator: z.boolean().default(true),
  /** Answer at once when the customer says it's urgent or an emergency. */
  urgentBypass: z.boolean().default(true),
  channels: z.array(z.enum(PACEABLE_CHANNELS)).min(1).default([...PACEABLE_CHANNELS]),
});
export type ReplyPacing = z.infer<typeof ReplyPacingSchema>;

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
  /** Absent means instant — every agent created before this existed. */
  replyPacing: ReplyPacingSchema.optional(),
});
export type AgentPersonality = z.infer<typeof AgentPersonalitySchema>;

/** Anthropic-specific tier — which the tenant may pick per their plan, per CLAUDE.md model routing. */
export const AnthropicModelTierSchema = z.enum(["haiku", "sonnet", "opus"]);
export type AnthropicModelTier = z.infer<typeof AnthropicModelTierSchema>;

export const ModelRoutingPreferenceSchema = z.object({
  /** The provider a client explicitly chose in the dashboard — Anthropic by default. */
  preferredProvider: z.enum(["anthropic", "openai", "gemini"]).default("anthropic"),
  /** Only meaningful when preferredProvider is "anthropic" — which Claude tier to use. */
  anthropicModelTier: AnthropicModelTierSchema.default("sonnet"),
  failoverChain: z.array(z.enum(["anthropic", "openai", "gemini"])).default([
    "anthropic",
    "openai",
    "gemini",
  ]),
  maxCostPerConversationUsd: z.number().positive().optional(),
  /**
   * How much the model thinks before replying. "low" by default: measured on
   * production (2026-09-22) it answered knowledge-base questions ~3x faster
   * than "medium" (1.7-2.3s vs 4.7-6.6s) with the same answers, including
   * refusing to invent a fact. Staff can raise it per agent.
   */
  reasoningEffort: z.enum(["low", "medium", "high"]).default("low"),
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
