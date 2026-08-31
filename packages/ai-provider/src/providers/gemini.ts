import { GoogleGenerativeAI, type Content, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
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

/**
 * Default dev/test provider per CLAUDE.md principle 7 — local development
 * and CI run against Gemini so routine dev work never needs live
 * Anthropic/OpenAI credentials. Also participates in the production
 * failover chain as the third hop.
 */
// Exported (only from this file, not re-exported via index.ts's public
// package surface) so gemini.test.ts can exercise these pure request-shape
// transforms directly without spinning up the real @google/generative-ai
// SDK/network calls.
export function toGeminiContents(messages: ChatMessage[]): { systemInstruction?: string; contents: Content[] } {
  const systemInstruction = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const contents: Content[] = messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "tool") {
        // Gemini has no "function" role and no call-id-based correlation —
        // a tool result is a `user` turn carrying a functionResponse part,
        // correlated to the preceding functionCall by name (confirmed
        // against the live API: role: "function" is rejected outright with
        // "Role 'function' is not supported"). toolName falls back to
        // toolCallId only for messages built before that field existed.
        return {
          role: "user",
          parts: [{ functionResponse: { name: m.toolName ?? m.toolCallId ?? "unknown", response: { content: m.content } } }],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "model",
          // thoughtSignature must be replayed verbatim on any functionCall
          // part being resent, or Gemini rejects the turn outright ("missing
          // a thought_signature") — see GeminiProvider.generate(), which is
          // the only place providerMetadata.thoughtSignature is ever set.
          parts: m.toolCalls.map((tc) => {
            const thoughtSignature = tc.providerMetadata?.thoughtSignature as string | undefined;
            return {
              functionCall: { name: tc.name, args: tc.arguments },
              ...(thoughtSignature ? { thoughtSignature } : {}),
            };
          }),
        };
      }
      return { role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] };
    });
  return { systemInstruction: systemInstruction || undefined, contents };
}

// Gemini's function-calling schema is an OpenAPI 3.0 Schema subset, not
// arbitrary JSON Schema — it rejects unknown keys outright (400, not just
// ignoring them). Every tool's inputJsonSchema comes from zod-to-json-schema
// (packages/tool-sdk/src/registry.ts), which always emits `$schema` and
// commonly `additionalProperties`/`$ref`/`definitions` — sent as-is, this
// breaks every tool call against Gemini, confirmed by actually running a
// chat turn with a tool registered rather than assuming the schema formats
// were compatible.
const GEMINI_UNSUPPORTED_SCHEMA_KEYS = new Set(["$schema", "additionalProperties", "$ref", "$id", "definitions", "const"]);

export function sanitizeSchemaForGemini(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchemaForGemini);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (GEMINI_UNSUPPORTED_SCHEMA_KEYS.has(key)) continue;
      out[key] = sanitizeSchemaForGemini(val);
    }
    return out;
  }
  return value;
}

export function toGeminiTools(tools?: GenerateOptions["tools"]): FunctionDeclaration[] | undefined {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: sanitizeSchemaForGemini(t.inputJsonSchema) as unknown as FunctionDeclaration["parameters"],
  }));
}

export class GeminiProvider implements AIProvider {
  readonly name = "gemini" as const;
  private client: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenerativeAI(apiKey);
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const started = Date.now();
    try {
      const { systemInstruction, contents } = toGeminiContents(options.messages);
      const geminiTools = toGeminiTools(options.tools);
      const model = this.client.getGenerativeModel({
        model: options.model,
        systemInstruction,
        tools: geminiTools ? [{ functionDeclarations: geminiTools }] : undefined,
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
        },
      });

      const result = await model.generateContent({ contents });
      const response = result.response;
      const text = response.text();
      const calls = response.functionCalls();
      // thoughtSignature lives as a sibling of `functionCall` on the raw
      // response Part, not on the SDK's functionCalls() convenience view —
      // pull it from the raw parts, matched in order (functionCalls()
      // extracts function-call parts in the same order they appear).
      const rawFunctionCallParts = ((response.candidates?.[0]?.content?.parts ?? []) as { functionCall?: unknown; thoughtSignature?: string }[]).filter(
        (p) => p.functionCall,
      );
      const toolCalls: ToolCallRequest[] | undefined = calls?.length
        ? calls.map((c, i) => {
            const thoughtSignature = rawFunctionCallParts[i]?.thoughtSignature;
            return {
              id: `${c.name}-${i}-${Date.now()}`,
              name: c.name,
              arguments: c.args as Record<string, unknown>,
              providerMetadata: thoughtSignature ? { thoughtSignature } : undefined,
            };
          })
        : undefined;

      return {
        content: text,
        toolCalls,
        finishReason: toolCalls ? "tool_call" : "stop",
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        },
        provider: this.name,
        model: options.model,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      throw mapGeminiError(err);
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    try {
      const { systemInstruction, contents } = toGeminiContents(options.messages);
      const model = this.client.getGenerativeModel({
        model: options.model,
        systemInstruction,
        generationConfig: {
          maxOutputTokens: options.maxOutputTokens,
          temperature: options.temperature,
        },
      });
      const result = await model.generateContentStream({ contents });
      for await (const chunk of result.stream) {
        yield { delta: chunk.text(), done: false };
      }
      const final = await result.response;
      yield {
        delta: "",
        done: true,
        finishReason: "stop",
        usage: {
          inputTokens: final.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: final.usageMetadata?.candidatesTokenCount ?? 0,
        },
      };
    } catch (err) {
      throw mapGeminiError(err);
    }
  }

  async toolCall(options: GenerateOptions & { tools: NonNullable<GenerateOptions["tools"]> }) {
    return this.generate(options);
  }

  async embed(options: EmbedOptions): Promise<EmbedResult> {
    try {
      const model = this.client.getGenerativeModel({ model: options.model });
      const vectors: number[][] = [];
      for (const text of options.input) {
        const result = await model.embedContent(text);
        vectors.push(result.embedding.values);
      }
      return {
        vectors,
        model: options.model,
        provider: this.name,
        usage: { inputTokens: options.input.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0) },
      };
    } catch (err) {
      throw mapGeminiError(err);
    }
  }

  async countTokens(text: string, model: string): Promise<number> {
    const m = this.client.getGenerativeModel({ model });
    const result = await m.countTokens(text);
    return result.totalTokens;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const started = Date.now();
    try {
      // Keep in sync with packages/config's GEMINI_MODEL_ID default — this
      // package doesn't depend on @chat-agent/config (providers stay
      // model-id-agnostic per CLAUDE.md's AIProvider abstraction), so
      // there's no single source of truth to read from here. Gemini
      // retires model ids for new callers without much notice (this was
      // last found broken when "gemini-2.5-flash" got retired), so if this
      // health check starts failing, verify the id is still live before
      // assuming the API key or provider itself is the problem.
      const model = this.client.getGenerativeModel({ model: "gemini-3.5-flash-lite" });
      await model.countTokens("healthcheck");
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

// Re-exported so downstream adapters/tests can build JSON-schema tool specs
// consistently without importing @google/generative-ai directly.
export { SchemaType };

function mapGeminiError(err: unknown): AIProviderError {
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { status?: number })?.status;
  return new AIProviderError({
    provider: "gemini",
    code:
      status === 429
        ? "rate_limited"
        : status === 401 || status === 403
          ? "auth_failed"
          : status && status >= 500
            ? "provider_down"
            : "unknown",
    message,
    retryable: status === 429 || (status !== undefined && status >= 500),
  });
}
