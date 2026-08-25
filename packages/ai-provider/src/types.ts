import { z } from "zod";

export type ProviderName = "anthropic" | "openai" | "gemini";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Present when role === "tool": which tool call this message answers. */
  toolCallId?: string;
  /**
   * Present when role === "tool": the tool's name (matching the original
   * functionCall.name), not just its call id. Some vendor APIs (Gemini)
   * correlate a function response by name, not by an opaque call id — a
   * provider adapter that only had toolCallId sent an unrecognized
   * identifier as the response "name" and Gemini rejected the turn.
   */
  toolName?: string;
  /** Present when role === "assistant" and the model requested tool calls. */
  toolCalls?: ToolCallRequest[];
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Opaque, provider-specific continuation state that must be replayed
   * back verbatim when this tool call is echoed into a later turn's
   * history — e.g. Gemini's `thoughtSignature`, required on any
   * functionCall part being resent or the API rejects the turn outright
   * ("Function call is missing a thought_signature"). Round-tripped by
   * callers (agentLoop.ts) without needing to know what's in it; only the
   * provider that produced it interprets the contents. Never populated by
   * providers that don't need it.
   */
  providerMetadata?: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema, since that's the lowest common denominator across all three vendor SDKs. */
  inputJsonSchema: Record<string, unknown>;
}

export interface GenerateOptions {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  temperature?: number;
  /** Hard budget — providers must stop and return partial output rather than exceed this. */
  timeoutMs?: number;
}

export interface GenerateResult {
  content: string;
  toolCalls?: ToolCallRequest[];
  finishReason: "stop" | "tool_call" | "length" | "error";
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  provider: ProviderName;
  model: string;
  latencyMs: number;
}

export interface StreamChunk {
  delta: string;
  toolCallDelta?: Partial<ToolCallRequest>;
  done: boolean;
  finishReason?: GenerateResult["finishReason"];
  usage?: GenerateResult["usage"];
}

export interface EmbedOptions {
  model: string;
  input: string[];
}

export interface EmbedResult {
  vectors: number[][];
  model: string;
  provider: ProviderName;
  usage: { inputTokens: number };
}

export interface HealthCheckResult {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

/**
 * The single interface every model call in the codebase must go through.
 * No application/business logic may import a vendor SDK directly — see
 * CLAUDE.md principle 2.
 */
export interface AIProvider {
  readonly name: ProviderName;

  generate(options: GenerateOptions): Promise<GenerateResult>;

  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;

  /** Convenience wrapper — same as generate() but only valid when tools are provided and expected. */
  toolCall(options: GenerateOptions & { tools: ToolSpec[] }): Promise<GenerateResult>;

  embed(options: EmbedOptions): Promise<EmbedResult>;

  countTokens(text: string, model: string): Promise<number>;

  healthCheck(): Promise<HealthCheckResult>;
}

export const ProviderErrorSchema = z.object({
  provider: z.enum(["anthropic", "openai", "gemini"]),
  code: z.enum(["rate_limited", "auth_failed", "timeout", "invalid_request", "provider_down", "unknown"]),
  message: z.string(),
  retryable: z.boolean(),
});
export type ProviderErrorInfo = z.infer<typeof ProviderErrorSchema>;

export class AIProviderError extends Error {
  readonly info: ProviderErrorInfo;
  constructor(info: ProviderErrorInfo) {
    super(`[${info.provider}] ${info.code}: ${info.message}`);
    this.name = "AIProviderError";
    this.info = info;
  }
}
