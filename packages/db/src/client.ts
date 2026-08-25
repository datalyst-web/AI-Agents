import { PrismaClient, Prisma } from "@prisma/client";
import type { TenantContext } from "@chat-agent/shared-types";

/**
 * The ONLY supported way to run a tenant-scoped query in this codebase.
 *
 * Every call sets the Postgres session variables the RLS policies in
 * prisma/sql/rls_policies.sql check (`app.current_tenant_id`,
 * `app.is_platform_context`) inside the same transaction as the query, so
 * even a query that forgets an explicit `where: { tenantId }` clause still
 * cannot cross tenant boundaries — RLS is the backstop, this is the
 * primary enforcement.
 *
 * A handler that cannot produce a TenantContext (see shared-types
 * `assertTenantScoped`) must not be able to reach this function at all.
 */
// The agent loop calls out to an LLM provider (and sometimes tool
// webhooks) from inside this transaction so message persistence stays
// atomic with the reply — see processCustomerMessage's doc comment.
// Prisma's default interactive-transaction timeout (5s) is tuned for pure
// DB work and was observed to expire mid-conversation against a real
// database once real network latency to the LLM provider was in the mix
// (confirmed by actually running a chat turn, not assumed). 30s comfortably
// covers a multi-iteration tool-calling turn without masking a genuinely
// hung request forever.
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!ctx.tenantId) {
    throw new Error("withTenant() called without a tenantId — refusing to run an unscoped query.");
  }
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_context', 'false', true)`;
    return fn(tx);
  }, TRANSACTION_OPTIONS);
}

/**
 * Escape hatch for the two situations where no single tenant is known or
 * established yet, so withTenant() genuinely cannot be used:
 *
 * 1. platform_admin endpoints that legitimately span tenants (e.g. "list
 *    all tenants") — callers must independently verify the caller's role
 *    is platform_admin before calling this, see apps/api RBAC middleware.
 * 2. Pre-tenant-context identity resolution on public/unauthenticated
 *    entry points, where the whole point of the query is to *find* the
 *    tenant: signup/login by email, /auth/me for a platform_admin token
 *    (no tenantId claim to scope with), and the public widget-config
 *    lookup by agentId (see auth.routes.ts, widgetConfig.routes.ts). These
 *    must stay narrow — a single row by a unique/indexed key, never a
 *    tenant-spanning list — and any query downstream that already knows
 *    the resolved tenantId (e.g. a verified widget-token claim) must use
 *    withTenant() with it instead of continuing to use this.
 *
 * Never used for Managed Setup/staff impersonation, which always goes
 * through withTenant() with the target tenant's id, same as a client
 * request.
 */
export async function withPlatformContext<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '', true)`;
    await tx.$executeRaw`SELECT set_config('app.is_platform_context', 'true', true)`;
    return fn(tx);
  }, TRANSACTION_OPTIONS);
}

export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: databaseUrl } },
    log:
      process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export { PrismaClient, Prisma } from "@prisma/client";
export type * from "@prisma/client";
