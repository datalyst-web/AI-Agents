import type { Prisma } from "@chat-agent/db";
import { searchChunks } from "@chat-agent/db";
import type { ModelRouter } from "@chat-agent/ai-provider";
import type { RetrievedKnowledgeChunk } from "@chat-agent/shared-types";

export interface RetrieveOptions {
  tenantId: string;
  agentId: string;
  query: string;
  embeddingModel: string;
  limit?: number;
  knowledgeSourceIds?: string[];
}

/**
 * Semantic Search -> Relevant Context step. Must be called inside an
 * existing withTenant() transaction (see packages/db/src/client.ts) so RLS
 * applies, and additionally scopes by tenantId + agentId at the query
 * level — an agent must never retrieve another client's chunks (CLAUDE.md
 * RAG section), and never another agent's chunks within the same tenant
 * either unless explicitly retrieving for that agent.
 */
export async function retrieveKnowledge(
  tx: Prisma.TransactionClient,
  router: ModelRouter,
  options: RetrieveOptions,
): Promise<RetrievedKnowledgeChunk[]> {
  const embedResult = await router.embed({ model: options.embeddingModel, input: [options.query] });
  const queryEmbedding = embedResult.vectors[0];
  if (!queryEmbedding) return [];

  const results = await searchChunks(tx, {
    tenantId: options.tenantId,
    agentId: options.agentId,
    queryEmbedding,
    limit: options.limit ?? 8,
    knowledgeSourceIds: options.knowledgeSourceIds,
  });

  // pgvector cosine distance -> similarity score (1 - distance), clamped.
  return results.map((r) => ({
    chunkId: r.id,
    documentId: r.documentId,
    knowledgeSourceId: r.knowledgeSourceId,
    score: Math.max(0, Math.min(1, 1 - r.distance)),
    textSnippet: r.text,
  }));
}
