import { randomUUID } from "node:crypto";
import type { Prisma } from "@chat-agent/db";
import { insertChunkEmbedding } from "@chat-agent/db";
import type { ModelRouter } from "@chat-agent/ai-provider";
import { chunkText, type ChunkOptions } from "./chunk.js";
import { embedTexts } from "./embed.js";
import type { ExtractedDocument } from "./extract.js";

export interface IngestParams {
  tenantId: string;
  agentId: string;
  knowledgeSourceId: string;
  document: ExtractedDocument;
  embeddingModel: string;
  chunkOptions?: ChunkOptions;
}

export interface IngestResult {
  documentId: string;
  chunkCount: number;
}

/**
 * Full Document Processing -> ... -> Vector Database pipeline for one
 * document, run inside a withTenant() transaction supplied by the caller
 * (apps/workers' knowledge-ingest job) so it's atomic and RLS-scoped.
 * Every chunk row it writes carries tenant_id/agent_id/knowledge_source_id/
 * document_id per CLAUDE.md's Knowledge Base spec.
 */
export async function ingestDocument(
  tx: Prisma.TransactionClient,
  router: ModelRouter,
  params: IngestParams,
): Promise<IngestResult> {
  const documentId = randomUUID();

  await tx.document.create({
    data: {
      id: documentId,
      tenantId: params.tenantId,
      agentId: params.agentId,
      knowledgeSourceId: params.knowledgeSourceId,
      title: params.document.title,
      rawText: params.document.text,
    },
  });

  const chunks = chunkText(params.document.text, params.chunkOptions);
  if (chunks.length === 0) {
    return { documentId, chunkCount: 0 };
  }

  const vectors = await embedTexts(
    router,
    chunks.map((c) => c.text),
    { model: params.embeddingModel },
  );

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = vectors[i];
    if (!chunk || !vector) continue;
    await insertChunkEmbedding(tx, {
      id: randomUUID(),
      tenantId: params.tenantId,
      agentId: params.agentId,
      knowledgeSourceId: params.knowledgeSourceId,
      documentId,
      text: chunk.text,
      metadata: { chunkIndex: chunk.index },
      embedding: vector,
    });
  }

  return { documentId, chunkCount: chunks.length };
}
