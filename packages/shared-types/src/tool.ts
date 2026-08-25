import { z } from "zod";

export const ExecutionTierSchema = z.enum([
  "automatic",
  "confirmation_required",
  "human_approval",
]);
export type ExecutionTier = z.infer<typeof ExecutionTierSchema>;

export const ToolCategorySchema = z.enum([
  "search_knowledge",
  "search_database",
  "crm",
  "calendar",
  "email",
  "webhook",
  "api",
  "ticketing",
  "inventory",
  "orders",
  "custom",
]);
export type ToolCategory = z.infer<typeof ToolCategorySchema>;

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  tenantId: string;
  agentId?: string; // if unset, available platform-wide as a template
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  executionTier: ExecutionTier;
  /** Required auth/config, resolved via packages/secrets — never inlined. */
  credentialRef?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolExecutionContext {
  tenantId: string;
  agentId: string;
  conversationId: string;
  invokedByRole: "agent" | "workflow" | "staff";
}

export interface ToolExecutionResult<TOutput = unknown> {
  succeeded: boolean;
  output?: TOutput;
  errorMessage?: string;
  /** True only when the underlying system explicitly confirmed the action — never assumed. */
  confirmedByProvider: boolean;
  durationMs: number;
}
