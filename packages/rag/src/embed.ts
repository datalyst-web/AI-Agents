import pLimit from "p-limit";
import type { ModelRouter } from "@chat-agent/ai-provider";

export interface EmbedBatchOptions {
  model: string;
  batchSize?: number;
  concurrency?: number;
}

/**
 * Embeddings -> Vector Database step. Batches to stay under provider
 * per-request input limits and bounds concurrency so a large document
 * ingestion doesn't starve other tenants' requests through the shared
 * ModelRouter.
 */
export async function embedTexts(
  router: ModelRouter,
  texts: string[],
  options: EmbedBatchOptions,
): Promise<number[][]> {
  const batchSize = options.batchSize ?? 32;
  const limit = pLimit(options.concurrency ?? 3);

  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push(texts.slice(i, i + batchSize));
  }

  const results = await Promise.all(
    batches.map((batch) => limit(() => router.embed({ model: options.model, input: batch }))),
  );

  return results.flatMap((r) => r.vectors);
}
