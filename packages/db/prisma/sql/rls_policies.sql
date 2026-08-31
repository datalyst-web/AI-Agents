-- Row-level security policies for the `chat` schema.
--
-- Defense in depth on top of packages/db/src/client.ts's application-layer
-- scoping (CLAUDE.md principle 1: "no code path should be able to read or
-- write another tenant's data" — treat a missing policy as a security bug).
--
-- Run after `prisma migrate deploy`. The app connects as `chat_app_user`,
-- which has RLS enforced against it (NOT a BYPASSRLS role); migrations run
-- as a separate superuser/owner role that does bypass RLS.
--
-- Every request sets the tenant for its DB session/transaction via:
--   SELECT set_config('app.current_tenant_id', $1, true);
-- (true = local to the transaction, auto-reset after COMMIT/ROLLBACK.)
-- See packages/db/src/client.ts `withTenant()`.

-- The chat_app_user role itself is created by infra/scripts/bootstrap-db.sh
-- (idempotently, with its password sourced from Secrets Manager) — this
-- script only grants table access and RLS policies against that role.
GRANT USAGE ON SCHEMA chat TO chat_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA chat TO chat_app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA chat TO chat_app_user;

-- Helper: current tenant for this session, NULL if unset (fails closed —
-- an unset tenant context matches zero rows, never all rows).
CREATE OR REPLACE FUNCTION chat.current_tenant_id() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('app.current_tenant_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

-- Platform-admin bypass: platform_admin / setup_specialist requests set
-- app.is_platform_context = 'true' only for the specific platform-scoped
-- endpoints that legitimately span tenants (e.g. the tenant list itself).
-- Managed Setup ("act as tenant") does NOT use this — it sets a normal
-- tenant_id like any client request, so staff are bound by the same RLS.
-- NULLIF(...,'') matters here exactly like it does in current_tenant_id()
-- above: a `SET LOCAL`/set_config(..., true) custom GUC reverts to '' (not
-- NULL) once its owning transaction commits, on a pooled connection reused
-- for a later, unrelated query. Without the NULLIF guard, a raw unscoped
-- query issued on such a reused connection (i.e. exactly the shape of the
-- original RLS entry-point bug in auth.routes.ts et al.) doesn't just fail
-- closed with zero rows, it throws ("invalid input syntax for type
-- boolean") from COALESCE(NULL_BUT_ACTUALLY_'', 'false')::boolean — found
-- by running client.test.ts's raw-unscoped-query regression test against
-- the live Neon instance, not assumed.
CREATE OR REPLACE FUNCTION chat.is_platform_context() RETURNS boolean AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_platform_context', true), ''), 'false')::boolean;
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users', 'staff_impersonation_sessions', 'agents', 'agent_version_snapshots',
      'knowledge_sources', 'documents', 'chunks', 'conversations', 'messages',
      'customer_identities', 'cross_conversation_memory_facts', 'cross_agent_memory_grants',
      'memory_forget_requests', 'tool_definitions', 'pending_human_approvals', 'workflow_definitions', 'workflow_runs',
      'usage_records', 'billing_line_items', 'usage_limits', 'audit_log_entries', 'channel_connections'
    ])
  LOOP
    EXECUTE format('ALTER TABLE chat.%I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE chat.%I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON chat.%I', tbl);
    EXECUTE format(
      -- WITH CHECK must carry the same is_platform_context() bypass as
      -- USING — without it, every write made through withPlatformContext()
      -- (signup creating the first user row, the widget-config lookup's
      -- future write paths, any platform_admin-driven insert/update) is
      -- rejected outright, since current_tenant_id() is NULL in that
      -- context and `tenant_id = NULL` can never be true. This was caught
      -- by actually running signup against a live RLS-enforced database —
      -- app-layer testing alone would not have surfaced it.
      'CREATE POLICY tenant_isolation ON chat.%I
         USING (tenant_id = chat.current_tenant_id() OR chat.is_platform_context())
         WITH CHECK (tenant_id = chat.current_tenant_id() OR chat.is_platform_context())',
      tbl
    );
  END LOOP;
END $$;

-- tenants itself has no tenant_id column — every user can only ever see
-- their own tenant row via the app layer's WHERE id = :tenantId, plus the
-- platform-admin context for cross-tenant listing (and, per the same
-- WITH CHECK reasoning above, for creating the tenant row itself at signup).
ALTER TABLE chat.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat.tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_self_or_platform ON chat.tenants;
CREATE POLICY tenant_self_or_platform ON chat.tenants
  USING (id = chat.current_tenant_id() OR chat.is_platform_context())
  WITH CHECK (id = chat.current_tenant_id() OR chat.is_platform_context());
