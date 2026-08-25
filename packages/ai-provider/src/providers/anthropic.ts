import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  ChatMessage,
  EmbedOptions,
  EmbedResult,
  GenerateOptions,
  GenerateResult,
  HealthCheckResult,
  StreamChunk,
  ToolCallRequest,
} from "../types.js";
import { AIProviderError } from "../types.js";

function toAnthropicMessages(messages: ChatMessage[]): {
  system?: string;
  messages: Anthropic.MessageParam[];
} {
  const systemParts = messages.filter((m) => m.role === "system").map((m) => m.content);
  const rest = messages.filter((m) => m.role !== "system");
  const converted: Anthropic.MessageParam[] = rest.map((m) => {
    if (m.role === "tool") {
      return {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.toolCallId ?? "",
            content: m.content,
          },
        ],
      };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          })),
        ],
      };
    }
    return { role: m.role === "assistant" ? "assistant" : "user", content: m.content };
  });
  return { system: systemParts.join("\n\n") || undefined, messages: converted };
}

function mapFinishReason(reason: string | null): GenerateResult["finishReason"] {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "tool_use":
      return "tool_call";
    case "max_tokens":
      return "length";
    default:
      return "stop";
  }
}

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  private toTools(tools?: GenerateOptions["tools"]): Anthropic.Tool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputJsonSchema as Anthropic.Tool.InputSchema,
    }));
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const started = Date.now();
    const { system, messages } = toAnthropicMessages(options.messages);
    try {
      const resp = await this.client.messages.create(
        {
          model: options.model,
          system,
          messages,
          tools: this.toTools(options.tools),
          max_tokens: options.maxOutputTokens ?? 1024,
          temperature: options.temperature,
        },
        { timeout: options.timeoutMs },
      );

      const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      const toolUseBlocks = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      const toolCalls: ToolCallRequest[] | undefined = toolUseBlocks.length
        ? toolUseBlocks.map((b) => ({
            id: b.id,
            name: b.name,
            arguments: b.input as Record<string, unknown>,
          }))
        : undefined;

      return {
        content: textBlocks.map((b) => b.text).join(""),
        toolCalls,
        finishReason: mapFinishReason(resp.stop_reason),
        usage: {
          inputTokens: resp.usage.input_tokens,
          outputTokens: resp.usage.output_tokens,
        },
        provider: this.name,
        model: options.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const { system, messages } = toAnthropicMessages(options.messages);
    try {
      const stream = this.client.messages.stream({
        model: options.model,
        system,
        messages,
        tools: this.toTools(options.tools),
        max_tokens: options.maxOutputTokens ?? 1024,
        temperature: options.temperature,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield { delta: event.delta.text, done: false };
        }
      }
      const final = await stream.finalMessage();
      yield {
        delta: "",
        done: true,
        finishReason: mapFinishReason(final.stop_reason),
        usage: {
          inputTokens: final.usage.input_tokens,
          outputTokens: final.usage.output_tokens,
        },
      };
    } catch (err) {
      throw mapAnthropicError(err);
    }
  }

  async toolCall(options: GenerateOptions & { tools: NonNullable<GenerateOptions["tools"]> }) {
    return this.generate(options);
  }

  async embed(_options: EmbedOptions): Promise<EmbedResult> {
    throw new AIProviderError({
      provider: this.name,
      code: "invalid_request",
      message: "Anthropic has no first-party embeddings API — route embed() through OpenAI or Gemini.",
      retryable: false,
    });
  }

  async countTokens(text: string): Promise<number> {
    // The SDK's exact token-count endpoint lives under the beta namespace
    // and shifts across SDK versions — a stable, dependency-free estimate
    // (same approximation used by OpenAIProvider) is safer for a pre-flight
    // budget check than pinning to a beta API surface. Swap for the real
    // endpoint if/when it's promoted out of beta.
    return Math.ceil(text.length / 4);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();
    try {
      // No lightweight "ping" endpoint on this SDK version — the cheapest
      // real signal that the API key/network path works is a minimal
      // completion request.
      await this.client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
      return { healthy: true, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() };
    } catch (err) {
      return {
        healthy: false,
        error: err instanceof Error ? err.message : String(err),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

function mapAnthropicError(err: unknown): AIProviderError {
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    return new AIProviderError({
      provider: "anthropic",
      code:
        status === 429
          ? "rate_limited"
          : status === 401 || status === 403
            ? "auth_failed"
            : status && status >= 500
              ? "provider_down"
              : "invalid_request",
      message: err.message,
      retryable: status === 429 || (status !== undefined && status >= 500),
    });
  }
  return new AIProviderError({
    provider: "anthropic",
    code: "unknown",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  });
}
