import type { z } from "zod";
import type {
  ExecutionTier,
  ToolCategory,
  ToolExecutionContext,
  ToolExecutionResult,
} from "@chat-agent/shared-types";
import type { SecretsProvider } from "@chat-agent/secrets";

/**
 * A ToolHandler is the *implementation* behind a category (e.g. "webhook",
 * "email"). A tenant's ToolDefinition row (packages/db) points at one of
 * these by category/name and supplies tenant-specific config
 * (credentialRef, input constraints). The AI only ever sees the JSON
 * schema + description generated from `inputSchema` — never the handler
 * code or credentials directly (CLAUDE.md principle 2 applied to tools).
 */
export interface ToolHandler<TInput = unknown, TOutput = unknown> {
  category: ToolCategory;
  name: string;
  description: string;
  // Input is deliberately left as `any`: schemas using `.default()`
  // (e.g. an optional "method" field) have a wider parse-input type than
  // their inferred *output* type TInput, since defaults fill the gap.
  // Pinning only the output keeps `z.infer<typeof Schema>` usable as
  // TInput without every handler having to hand-widen its input type.
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  outputSchema: z.ZodType<TOutput, z.ZodTypeDef, any>;
  defaultExecutionTier: ExecutionTier;
  execute(
    input: TInput,
    ctx: ToolExecutionContext,
    deps: { secrets: SecretsProvider; credentialRef?: string },
  ): Promise<ToolExecutionResult<TOutput>>;
}

export interface PendingConfirmation {
  toolCallId: string;
  toolId: string;
  toolName: string;
  input: unknown;
  /** Human-readable summary read/shown back to the customer before executing — CLAUDE.md principle 4. */
  confirmationPrompt: string;
  requestedAt: string;
}

export interface PendingHumanApproval {
  id: string;
  tenantId: string;
  agentId: string;
  conversationId: string;
  toolId: string;
  toolName: string;
  input: unknown;
  requestedAt: string;
  resolvedAt?: string;
  resolvedByUserId?: string;
  decision?: "approved" | "denied";
}

export class ToolExecutionDenied extends Error {
  /**
   * Which execution tier caused the denial — lets callers (apps/api's
   * agent loop) branch confirmation_required (customer yes/no) apart from
   * human_approval (staff-only, never resolvable by the customer) instead
   * of treating every denial identically. Undefined for denials that
   * aren't tier-related (e.g. an unauthorized/unknown tool).
   */
  readonly tier?: ExecutionTier;

  constructor(reason: string, tier?: ExecutionTier) {
    super(reason);
    this.name = "ToolExecutionDenied";
    this.tier = tier;
  }
}
