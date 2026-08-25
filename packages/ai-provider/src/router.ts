import type {
  AIProvider,
  EmbedOptions,
  EmbedResult,
  GenerateOptions,
  GenerateResult,
  HealthCheckResult,
  ProviderName,
  StreamChunk,
} from "./types.js";
import { AIProviderError } from "./types.js";

export interface ModelRouteRequest extends Omit<GenerateOptions, "model"> {
  /** Per-agent override, e.g. Agent.modelRouting.failoverChain from shared-types. */
  failoverChain?: ProviderName[];
  preferredProvider?: ProviderName;
  /** Optional explicit model id override — normally left unset so each provider's pinned model id is used. */
  model?: string;
}

export interface RouterUsageEvent {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  succeeded: boolean;
  failoverFrom?: ProviderName[];
}

export type UsageListener = (event: RouterUsageEvent) => void;

interface ProviderModelMap {
  anthropic?: string;
  openai?: string;
  gemini?: string;
}

/** Chat and embedding models are different families per vendor — never share one map. */
interface EmbeddingModelMap {
  openai?: string;
  gemini?: string;
}

/**
 * Thin internal service implementing AIProvider-consuming failover across
 * vendor adapters — not a third-party gateway, so tenant scoping, cost
 * tracking, and failover stay under our control (CLAUDE.md tech-stack note).
 *
 * Default chain: Anthropic -> OpenAI -> Gemini. Repeated failures on one
 * provider mark it unhealthy for a cooldown window so subsequent requests
 * skip straight past it instead of paying the timeout cost per-request.
 */
export class ModelRouter {
  private providers: Partial<Record<ProviderName, AIProvider>>;
  private modelIds: ProviderModelMap;
  private embeddingModelIds: EmbeddingModelMap;
  private defaultChain: ProviderName[];
  private usageListeners: UsageListener[] = [];
  // Keyed "kind:provider" (e.g. "embed:gemini"), not just provider — an
  // embed() failure must never cool down generate() for the same provider
  // (or vice versa). They're different vendor endpoints/quotas, and a RAG
  // embedding failure (which already has its own graceful fallback to "no
  // grounding" in the agent loop) previously poisoned chat generation
  // entirely for the next 60s once a provider's-only-registered case hit
  // this shared state — found by running a real chat turn end-to-end.
  private unhealthyUntil: Partial<Record<string, number>> = {};
  private readonly cooldownMs = 60_000;

  constructor(opts: {
    providers: Partial<Record<ProviderName, AIProvider>>;
    modelIds: ProviderModelMap;
    embeddingModelIds?: EmbeddingModelMap;
    defaultChain?: ProviderName[];
  }) {
    this.providers = opts.providers;
    this.modelIds = opts.modelIds;
    this.embeddingModelIds = opts.embeddingModelIds ?? {};
    this.defaultChain = opts.defaultChain ?? ["anthropic", "openai", "gemini"];
  }

  onUsage(listener: UsageListener): void {
    this.usageListeners.push(listener);
  }

  private emitUsage(event: RouterUsageEvent): void {
    for (const l of this.usageListeners) l(event);
  }

  private resolveChain(req: ModelRouteRequest): ProviderName[] {
    const chain = req.failoverChain ?? this.defaultChain;
    const ordered = req.preferredProvider
      ? [req.preferredProvider, ...chain.filter((p) => p !== req.preferredProvider)]
      : chain;
    return ordered.filter((p) => this.providers[p] !== undefined);
  }

  private isCoolingDown(kind: "generate" | "embed", name: ProviderName): boolean {
    const until = this.unhealthyUntil[`${kind}:${name}`];
    return until !== undefined && until > Date.now();
  }

  private markUnhealthy(kind: "generate" | "embed", name: ProviderName): void {
    this.unhealthyUntil[`${kind}:${name}`] = Date.now() + this.cooldownMs;
  }

  private modelFor(name: ProviderName, override?: string): string {
    const id = override ?? this.modelIds[name];
    if (!id) throw new Error(`No pinned model id configured for provider "${name}"`);
    return id;
  }

  /**
   * Unlike modelFor() above, the router's own configured embedding model
   * id always wins over a caller-supplied override — a caller can't know
   * in advance which provider will end up serving an embed() call, so a
   * hardcoded override (e.g. an OpenAI model name) must never reach a
   * different vendor's API just because that's who was actually selected.
   */
  private embeddingModelFor(name: "openai" | "gemini", override?: string): string {
    const id = this.embeddingModelIds[name] ?? override;
    if (!id) throw new Error(`No pinned embedding model id configured for provider "${name}"`);
    return id;
  }

  async generate(req: ModelRouteRequest): Promise<GenerateResult> {
    const chain = this.resolveChain(req);
    if (chain.length === 0) {
      throw new Error("No AIProvider configured — check ANTHROPIC_API_KEY/OPENAI_API_KEY/GEMINI_API_KEY.");
    }
    const attempted: ProviderName[] = [];
    let lastError: unknown;

    for (const name of chain) {
      if (this.isCoolingDown("generate", name)) continue;
      const provider = this.providers[name];
      if (!provider) continue;
      attempted.push(name);
      try {
        const result = await provider.generate({ ...req, model: this.modelFor(name, req.model) });
        this.emitUsage({
          provider: name,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
          succeeded: true,
          failoverFrom: attempted.length > 1 ? attempted.slice(0, -1) : undefined,
        });
        return result;
      } catch (err) {
        lastError = err;
        const retryable = err instanceof AIProviderError ? err.info.retryable : true;
        this.emitUsage({
          provider: name,
          model: this.modelIds[name] ?? req.model ?? "unknown",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          succeeded: false,
        });
        if (!retryable) throw err;
        this.markUnhealthy("generate", name);
        // fall through to next provider in the chain — failures must be
        // invisible to the end user wherever possible.
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("All providers in the failover chain failed.");
  }

  async *stream(req: ModelRouteRequest): AsyncIterable<StreamChunk> {
    const chain = this.resolveChain(req);
    let lastError: unknown;
    for (const name of chain) {
      if (this.isCoolingDown("generate", name)) continue;
      const provider = this.providers[name];
      if (!provider) continue;
      try {
        yield* provider.stream({ ...req, model: this.modelFor(name, req.model) });
        return;
      } catch (err) {
        lastError = err;
        this.markUnhealthy("generate", name);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("All providers failed to stream.");
  }

  async toolCall(req: ModelRouteRequest & { tools: NonNullable<GenerateOptions["tools"]> }) {
    return this.generate(req);
  }

  /** Embeddings default to OpenAI/Gemini since Anthropic has no first-party embed API. */
  async embed(req: EmbedOptions & { preferredProvider?: "openai" | "gemini" }): Promise<EmbedResult> {
    const order: ("openai" | "gemini")[] = req.preferredProvider
      ? [req.preferredProvider, "openai", "gemini"]
      : ["openai", "gemini"];
    let lastError: unknown;
    for (const name of order) {
      const provider = this.providers[name];
      if (!provider || this.isCoolingDown("embed", name)) continue;
      try {
        return await provider.embed({ ...req, model: this.embeddingModelFor(name, req.model) });
      } catch (err) {
        lastError = err;
        this.markUnhealthy("embed", name);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No embedding provider available.");
  }

  async healthCheckAll(): Promise<Record<ProviderName, HealthCheckResult>> {
    const entries = await Promise.all(
      (Object.entries(this.providers) as [ProviderName, AIProvider][]).map(
        async ([name, provider]) => [name, await provider.healthCheck()] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<ProviderName, HealthCheckResult>;
  }
}
