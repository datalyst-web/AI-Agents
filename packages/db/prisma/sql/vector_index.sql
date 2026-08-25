-- pgvector index for knowledge-base semantic search.
-- Run after the initial `prisma migrate deploy` (Prisma's `Unsupported`
-- vector column type is created by the migration, but the ANN index is
-- managed here since Prisma can't express index method/options).

CREATE EXTENSION IF NOT EXISTS vector SCHEMA chat;

-- vector_cosine_ops below is unqualified, so it must resolve via search_path
-- (the extension lives in `chat`, not `public`) regardless of the calling
-- role/session's default search_path — without this, CREATE INDEX fails
-- with "operator class vector_cosine_ops does not exist for access method
-- hnsw" on any role that doesn't already have `chat` on its search_path.
SET search_path = chat, public;

-- HNSW: better recall/latency trade-off than ivfflat for our per-agent
-- query volume, and doesn't need a training pass (ivfflat's `lists` tuning
-- is annoying with per-tenant/per-agent data skew — some agents have 50
-- chunks, some have 50,000).
CREATE INDEX IF NOT EXISTS chunks_embedding_hnsw_idx
  ON chat.chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Composite btree so the tenant/agent filter (always applied before the
-- ANN search, per CLAUDE.md's "every retrieval must enforce tenant + agent
-- authorization") uses an index rather than a sequential scan on large
-- multi-tenant tables.
CREATE INDEX IF NOT EXISTS chunks_tenant_agent_idx
  ON chat.chunks (tenant_id, agent_id);
