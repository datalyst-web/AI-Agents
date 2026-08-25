import { describe, it, expect, vi } from "vitest";
import { ModelRouter } from "./router.js";
import { AIProviderError } from "./types.js";
import type { AIProvider, GenerateResult, EmbedResult, HealthCheckResult, StreamChunk } from "./types.js";

/**
 * Regression coverage for two real bugs found by actually running a chat
 * turn end-to-end against a live database and real providers (see
 * router.ts's own doc comments on `unhealthyUntil` and `embeddingModelFor`):
 *
 * 1. A single failed embed() call used to mark a provider unhealthy in a
 *    way that then made the NEXT unrelated generate() call skip that
 *    provider too (shared cooldown keyed only by provider name) — a failed
 *    RAG embedding call silently broke chat generation for 60s. Fixed by
 *    namespacing unhealthyUntil by "generate:<provider>" vs
 *    "embed:<provider>" separately.
 *
 * 2. router.embed()'s caller-supplied `model` override always won, even
 *    when the router fell back to a DIFFERENT provider than the caller
 *    assumed — an OpenAI embedding model name reaching Gemini's API when
 *    OpenAI wasn't configured, which Gemini rejects. Fixed by having the
 *    router's own configured embeddingModelIds win over the caller's
 *    override (opposite precedence from the chat-generation modelFor()).
 */

function fakeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    name: "gemini",
    generate: vi.fn(async (): Promise<GenerateResult> => ({
      content: "ok",
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1 },
      provider: "gemini",
      model: "unset",
      latencyMs: 1,
    })),
    stream: vi.fn(async function* (): AsyncIterable<StreamChunk> {
      yield { delta: "ok", done: true, finishReason: "stop", usage: { inputTokens: 1, outputTokens: 1 } };
    }),
    toolCall: vi.fn(),
    embed: vi.fn(async (): Promise<EmbedResult> => ({
      vectors: [[0.1, 0.2]],
      model: "unset",
      provider: "gemini",
      usage: { inputTokens: 1 },
    })),
    countTokens: vi.fn(async () => 1),
    healthCheck: vi.fn(async (): Promise<HealthCheckResult> => ({ healthy: true, checkedAt: new Date().toISOString() })),
    ...overrides,
  };
}

describe("ModelRouter — generate()/embed() health-tracking isolation", () => {
  it("a failed embed() call does NOT cool down a subsequent generate() call on the same provider", async () => {
    let embedCalls = 0;
    const gemini = fakeProvider({
      embed: vi.fn(async () => {
        embedCalls++;
        throw new AIProviderError({
          provider: "gemini",
          code: "provider_down",
          message: "embedding endpoint down",
          retryable: true,
        });
      }),
    });
    const router = new ModelRouter({
      providers: { gemini },
      modelIds: { gemini: "gemini-chat-model" },
      embeddingModelIds: { gemini: "gemini-embedding-001" },
      defaultChain: ["gemini"],
    });

    await expect(router.embed({ model: "gemini-embedding-001", input: ["hello"] })).rejects.toThrow();
    expect(embedCalls).toBe(1);

    // generate() on the very same provider must NOT be skipped just
    // because embed() failed moments ago.
    const result = await router.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.content).toBe("ok");
    expect(gemini.generate).toHaveBeenCalledTimes(1);
  });

  it("a failed generate() call does NOT cool down a subsequent embed() call on the same provider", async () => {
    const gemini = fakeProvider({
      generate: vi.fn(async () => {
        throw new AIProviderError({
          provider: "gemini",
          code: "provider_down",
          message: "chat endpoint down",
          retryable: true,
        });
      }),
    });
    const router = new ModelRouter({
      providers: { gemini },
      modelIds: { gemini: "gemini-chat-model" },
      embeddingModelIds: { gemini: "gemini-embedding-001" },
      defaultChain: ["gemini"],
    });

    await expect(router.generate({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow();

    const result = await router.embed({ model: "gemini-embedding-001", input: ["hello"] });
    expect(result.vectors).toEqual([[0.1, 0.2]]);
    expect(gemini.embed).toHaveBeenCalledTimes(1);
  });
});

describe("ModelRouter.embed() — embeddingModelIds precedence over caller override", () => {
  it("uses the router's configured embedding model id even when the caller passes a different (cross-vendor) model override", async () => {
    const gemini = fakeProvider();
    const router = new ModelRouter({
      providers: { gemini },
      modelIds: { gemini: "gemini-chat-model" },
      embeddingModelIds: { gemini: "gemini-embedding-001" },
      defaultChain: ["gemini"],
    });

    // Caller passes an OpenAI-shaped model id, e.g. because it doesn't know
    // in advance the router will end up falling back to gemini.
    await router.embed({ model: "text-embedding-3-small", input: ["hello"] });

    expect(gemini.embed).toHaveBeenCalledTimes(1);
    const callArg = (gemini.embed as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArg.model).toBe("gemini-embedding-001");
    expect(callArg.model).not.toBe("text-embedding-3-small");
  });

  it("falls back to the caller's override only when the router has no configured id for that provider", async () => {
    const gemini = fakeProvider();
    const router = new ModelRouter({
      providers: { gemini },
      modelIds: { gemini: "gemini-chat-model" },
      embeddingModelIds: {}, // no gemini embedding id configured
      defaultChain: ["gemini"],
    });

    await router.embed({ model: "caller-supplied-model", input: ["hello"] });

    const callArg = (gemini.embed as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(callArg.model).toBe("caller-supplied-model");
  });

  it("throws when neither the router nor the caller has an embedding model id for the provider", async () => {
    const gemini = fakeProvider();
    const router = new ModelRouter({
      providers: { gemini },
      modelIds: { gemini: "gemini-chat-model" },
      embeddingModelIds: {},
      defaultChain: ["gemini"],
    });

    await expect(router.embed({ model: "", input: ["hello"] })).rejects.toThrow(
      /No pinned embedding model id/,
    );
  });
});
