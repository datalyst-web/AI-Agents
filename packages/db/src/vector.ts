import type { Prisma } from "@prisma/client";

export interface VectorSearchResult {
  id: string;
  documentId: string;
  knowledgeSourceId: string;
  text: string;
  metadata: Record<string, unknown>;
  distance: number;
}

/**
 * Raw pgvector cosine-distance search, run inside an existing
 * withTenant() transaction so RLS still applies — this function does NOT
 * set the tenant session var itself, and additionally filters by
 * tenantId/agentId explicitly (belt-and-braces per CLAUDE.md's "every
 * retrieval must enforce tenant + agent authorization").
 *
 * Prisma's query builder can't express `<=>` (cosine distance) or the
 * `Unsupported("vector")` column type in a typed query, hence raw SQL here
 * — this is the one place in the codebase allowed to hand-write SQL against
 * the chunks table.
 *
 * The `::chat.vector` casts below must stay schema-qualified: the vector
 * extension is installed into `chat`, not `public` (see
 * prisma/sql/vector_index.sql), so an unqualified `::vector` only resolves
 * on a session whose search_path happens to include `chat` — chat_app_user's
 * default search_path doesn't, so every real retrieval/ingestion call
 * failed with `type "vector" does not exist` until this was qualified.
 * Caught by actually running a chat turn against a live database, not by
 * inspection — this codebase has never had a passing test or manual run
 * that exercised RAG retrieval against real Postgres before now.
 */
export async function searchChunks(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    agentId: string;
    queryEmbedding: number[];
    limit?: number;
    knowledgeSourceIds?: string[];
  },
): Promise<VectorSearchResult[]> {
  const { tenantId, agentId, queryEmbedding, limit = 8, knowledgeSourceIds } = params;
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  const rows = await tx.$queryRaw<
    {
      id: string;
      document_id: string;
      knowledge_source_id: string;
      text: string;
      metadata: unknown;
      distance: number;
    }[]
  >`
    SELECT id, document_id, knowledge_source_id, text, metadata,
           embedding <=> ${vectorLiteral}::chat.vector AS distance
    FROM chat.chunks
    WHERE tenant_id = ${tenantId}::uuid
      AND agent_id = ${agentId}::uuid
      AND (${knowledgeSourceIds ?? null}::uuid[] IS NULL OR knowledge_source_id = ANY(${knowledgeSourceIds ?? null}::uuid[]))
    ORDER BY embedding <=> ${vectorLiteral}::chat.vector
    LIMIT ${limit}
  `;

  return rows.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    knowledgeSourceId: r.knowledge_source_id,
    text: r.text,
    metadata: (r.metadata ?? {}) as Record<string, unknown>,
    distance: r.distance,
  }));
}

/** Inserts a chunk's embedding via raw SQL since Prisma can't type a vector literal. */
export async function insertChunkEmbedding(
  tx: Prisma.TransactionClient,
  params: {
    id: string;
    tenantId: string;
    agentId: string;
    knowledgeSourceId: string;
    documentId: string;
    text: string;
    metadata: Record<string, unknown>;
    embedding: number[];
  },
): Promise<void> {
  const vectorLiteral = `[${params.embedding.join(",")}]`;
  await tx.$executeRaw`
    INSERT INTO chat.chunks (id, tenant_id, agent_id, knowledge_source_id, document_id, text, metadata, embedding, created_at)
    VALUES (
      ${params.id}::uuid, ${params.tenantId}::uuid, ${params.agentId}::uuid,
      ${params.knowledgeSourceId}::uuid, ${params.documentId}::uuid, ${params.text},
      ${JSON.stringify(params.metadata)}::jsonb, ${vectorLiteral}::chat.vector, now()
    )
  `;
}
