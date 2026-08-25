export * from "./types.js";
export * from "./router.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export { OpenAIProvider } from "./providers/openai.js";
export { GeminiProvider } from "./providers/gemini.js";

import type { ProviderName, AIProvider } from "./types.js";
import { ModelRouter } from "./router.js";
import { AnthropicProvider } from "./providers/anthropic.js";
import { OpenAIProvider } from "./providers/openai.js";
import { GeminiProvider } from "./providers/gemini.js";

export interface RouterFromEnvConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  anthropicModelId?: string;
  openaiModelId?: string;
  geminiModelId?: string;
  openaiEmbeddingModelId?: string;
  geminiEmbeddingModelId?: string;
  defaultChain?: ProviderName[];
}

/**
 * Builds a ModelRouter wired only with the providers that have credentials.
 * In dev/CI (per CLAUDE.md principle 7) this typically means Gemini only —
 * the router degrades gracefully rather than requiring all three.
 */
export function createModelRouterFromConfig(config: RouterFromEnvConfig): ModelRouter {
  const providers: Partial<Record<ProviderName, AIProvider>> = {};
  if (config.anthropicApiKey) providers.anthropic = new AnthropicProvider(config.anthropicApiKey);
  if (config.openaiApiKey) providers.openai = new OpenAIProvider(config.openaiApiKey);
  if (config.geminiApiKey) providers.gemini = new GeminiProvider(config.geminiApiKey);

  return new ModelRouter({
    providers,
    modelIds: {
      anthropic: config.anthropicModelId,
      openai: config.openaiModelId,
      gemini: config.geminiModelId,
    },
    embeddingModelIds: {
      openai: config.openaiEmbeddingModelId,
      gemini: config.geminiEmbeddingModelId,
    },
    defaultChain: config.defaultChain,
  });
}
