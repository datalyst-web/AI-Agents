#!/usr/bin/env bash
# Bootstraps the `chat` schema + chat_app_user role on the shared Aurora
# Postgres cluster. Run once per environment, before the first
# `prisma migrate deploy`. Requires psql and admin credentials for the
# shared cluster (never the app's own DATABASE_URL, which has no schema-
# creation rights by design).
set -euo pipefail

: "${PLATFORM_DB_ADMIN_URL:?Set PLATFORM_DB_ADMIN_URL to an admin connection string for the shared Aurora cluster}"
: "${CHAT_APP_USER_PASSWORD:?Set CHAT_APP_USER_PASSWORD (pull it from Secrets Manager: chat/db-app-user-password)}"

echo "Creating chat schema + role on the shared platform database..."
psql "$PLATFORM_DB_ADMIN_URL" -v pw="$CHAT_APP_USER_PASSWORD" <<'SQL'
CREATE SCHEMA IF NOT EXISTS chat;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chat_app_user') THEN
    EXECUTE format('CREATE ROLE chat_app_user WITH LOGIN PASSWORD %L NOBYPASSRLS', :'pw');
  END IF;
END $$;

GRANT USAGE ON SCHEMA chat TO chat_app_user;

-- pgvector lives in `chat` (see vector_index.sql), not `public` — without
-- this, every unqualified use of the vector type/operators (`<=>` cosine
-- distance, etc.) in packages/db/src/vector.ts fails to resolve for any
-- session that didn't explicitly set search_path itself, which is every
-- real application connection. Found by running a live chat turn end to
-- end against a real database, not by inspection.
ALTER ROLE chat_app_user SET search_path = chat, public;
SQL

echo "Applying pgvector extension + RLS policies..."
psql "$PLATFORM_DB_ADMIN_URL" -f ../../packages/db/prisma/sql/vector_index.sql || true # index creation runs post-migrate too; safe to retry
psql "$PLATFORM_DB_ADMIN_URL" -f ../../packages/db/prisma/sql/rls_policies.sql

echo "Done. Next: pnpm --filter @chat-agent/db run migrate:deploy"
