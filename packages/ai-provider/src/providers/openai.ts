import OpenAI from "openai";
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

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId ?? "" };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

function mapFinishReason(reason: string | null | undefined): GenerateResult["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "tool_calls":
      return "tool_call";
    case "length":
      return "length";
    default:
      return "stop";
  }
}

export class OpenAIProvider implements AIProvider {
  readonly name = "openai" as const;
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  private toTools(tools?: GenerateOptions["tools"]): OpenAI.Chat.ChatCompletionTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputJsonSchema,
      },
    }));
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const started = Date.now();
    try {
      const resp = await this.client.chat.completions.create(
        {
          model: options.model,
          messages: toOpenAIMessages(options.messages),
          tools: this.toTools(options.tools),
          max_completion_tokens: options.maxOutputTokens,
          temperature: options.temperature,
        },
        { timeout: options.timeoutMs },
      );

      const choice = resp.choices[0];
      const toolCalls: ToolCallRequest[] | undefined = choice?.message.tool_calls?.length
        ? choice.message.tool_calls.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || "{}"),
          }))
        : undefined;

      return {
        content: choice?.message.content ?? "",
        toolCalls,
        finishReason: mapFinishReason(choice?.finish_reason),
        usage: {
          inputTokens: resp.usage?.prompt_tokens ?? 0,
          outputTokens: resp.usage?.completion_tokens ?? 0,
        },
        provider: this.name,
        model: options.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      const stream = await this.client.chat.completions.create({
        model: options.model,
        messages: toOpenAIMessages(options.messages),
        tools: this.toTools(options.tools),
        max_completion_tokens: options.maxOutputTokens,
        temperature: options.temperature,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        const delta = choice?.delta?.content ?? "";
        if (delta) {
          yield { delta, done: false };
        }
        if (chunk.usage) {
          yield {
            delta: "",
            done: true,
            finishReason: mapFinishReason(choice?.finish_reason),
            usage: {
              inputTokens: chunk.usage.prompt_tokens,
              outputTokens: chunk.usage.completion_tokens,
            },
          };
        }
      }
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }

  async toolCall(options: GenerateOptions & { tools: NonNullable<GenerateOptions["tools"]> }) {
    return this.generate(options);
  }

  async embed(options: EmbedOptions): Promise<EmbedResult> {
    try {
      const resp = await this.client.embeddings.create({
        model: options.model,
        input: options.input,
      });
      return {
        vectors: resp.data.map((d) => d.embedding),
        model: options.model,
        provider: this.name,
        usage: { inputTokens: resp.usage.prompt_tokens },
      };
    } catch (err) {
      throw mapOpenAIError(err);
    }
  }

  async countTokens(text: string): Promise<number> {
    // Approximate — OpenAI has no server-side count endpoint; tiktoken can be
    // wired in here if exact pre-flight counts become necessary.
    return Math.ceil(text.length / 4);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();
    try {
      await this.client.models.list();
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

function mapOpenAIError(err: unknown): AIProviderError {
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    return new AIProviderError({
      provider: "openai",
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
    provider: "openai",
    code: "unknown",
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  });
}
