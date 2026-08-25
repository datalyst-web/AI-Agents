import { z } from "zod";

/**
 * Three scopes per CLAUDE.md's Memory Engine section. Knowledge is what the
 * business knows; memory is what the agent knows about *this customer*.
 */
export const MemoryScopeSchema = z.enum([
  "SESSION",
  "CROSS_CONVERSATION",
  "CROSS_AGENT",
]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export interface SessionMemoryEntry {
  conversationId: string;
  key: string;
  value: string;
  createdAt: string;
}

/** Keyed by a durable customer identifier: authenticated account, email, or persistent widget cookie. */
export interface CustomerIdentity {
  id: string;
  tenantId: string;
  agentId: string;
  identifierType: "authenticated_account" | "email" | "widget_session_cookie";
  identifierValue: string; // hashed at rest
  createdAt: string;
}

export interface CrossConversationMemoryFact {
  id: string;
  tenantId: string;
  agentId: string;
  customerIdentityId: string;
  /** A durable fact the customer actually stated — never an inference presented as fact. */
  fact: string;
  sourceConversationId: string;
  sourceMessageId: string;
  confidence: number;
  /** Follows the tenant's data retention policy — no exemption for being "memory". */
  expiresAt?: string;
  createdAt: string;
}

/** Off by default; a tenant must explicitly opt in per agent pair. Never cross-tenant. */
export interface CrossAgentMemoryGrant {
  id: string;
  tenantId: string;
  sourceAgentId: string;
  targetAgentId: string;
  enabledByUserId: string;
  enabledAt: string;
}

export interface MemoryForgetRequest {
  id: string;
  tenantId: string;
  agentId: string;
  customerIdentityId: string;
  requestedAt: string;
  fulfilledAt?: string;
  fulfilledByUserId?: string; // system-initiated if unset (e.g. retention expiry)
}
