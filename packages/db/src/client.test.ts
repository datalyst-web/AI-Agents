import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createPrismaClient, withTenant, withPlatformContext, type PrismaClient } from "./client.js";

/**
 * Integration coverage for tenant isolation (CLAUDE.md principle 1: "no
 * code path should be able to read or write another tenant's data") —
 * exercises the actual RLS policies in prisma/sql/rls_policies.sql against
 * a real, live Postgres (a free Neon instance), not just the
 * application-layer where clauses, since RLS is meant to be the backstop
 * even when app code forgets a tenantId filter.
 *
 * Deliberately connects as CHAT_APP_DATABASE_URL (the `chat_app_user` role,
 * RLS-enforced) for every assertion below — this is the same role
 * production actually connects as. Connecting as the neondb_owner/admin
 * role instead would silently bypass RLS entirely (BYPASSRLS-equivalent
 * superuser semantics) and make every test below pass regardless of
 * whether the policies are even applied, which is exactly the trap that
 * hid the two real bugs this file now regression-tests: (1) route handlers
 * making raw unscoped Prisma calls with no session context set at all, and
 * (2) rls_policies.sql's WITH CHECK clauses missing the
 * is_platform_context() bypass that USING already had, which rejected
 * every write made through withPlatformContext() — including the
 * tenant/user rows created at signup.
 */
describe.skipIf(!process.env.CHAT_APP_DATABASE_URL)("withTenant / withPlatformContext — RLS tenant isolation", () => {
  let prisma: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    prisma = createPrismaClient(process.env.CHAT_APP_DATABASE_URL as string);
    tenantAId = (
      await withPlatformContext(prisma, (tx) =>
        tx.tenant.create({ data: { name: "RLS Test Tenant A", slug: `rls-test-a-${randomUUID()}` } }),
      )
    ).id;
    tenantBId = (
      await withPlatformContext(prisma, (tx) =>
        tx.tenant.create({ data: { name: "RLS Test Tenant B", slug: `rls-test-b-${randomUUID()}` } }),
      )
    ).id;
  });

  afterAll(async () => {
    await withPlatformContext(prisma, async (tx) => {
      await tx.tenant.delete({ where: { id: tenantAId } }).catch(() => undefined);
      await tx.tenant.delete({ where: { id: tenantBId } }).catch(() => undefined);
    });
    await prisma.$disconnect();
  });

  it("a tool definition created under tenant A is invisible to tenant B, even with an unscoped findMany()", async () => {
    await withTenant(prisma, { tenantId: tenantAId }, (tx) =>
      tx.toolDefinition.create({
        data: {
          tenantId: tenantAId,
          name: "tenant_a_only_tool",
          description: "should never be visible to tenant B",
          category: "webhook",
          inputSchema: {},
          outputSchema: {},
          executionTier: "automatic",
        },
      }),
    );

    // Deliberately NOT filtering by tenantId in the query — RLS must still
    // enforce isolation even when application code forgets to.
    const rowsVisibleToB = await withTenant(prisma, { tenantId: tenantBId }, (tx) =>
      tx.toolDefinition.findMany({ where: { name: "tenant_a_only_tool" } }),
    );

    expect(rowsVisibleToB).toHaveLength(0);
  });

  it("the same row IS visible back under tenant A's own context", async () => {
    const rowsVisibleToA = await withTenant(prisma, { tenantId: tenantAId }, (tx) =>
      tx.toolDefinition.findMany({ where: { name: "tenant_a_only_tool" } }),
    );

    expect(rowsVisibleToA.length).toBeGreaterThanOrEqual(1);
    expect(rowsVisibleToA.every((r) => r.tenantId === tenantAId)).toBe(true);
  });

  it("withTenant refuses to run without a tenantId", async () => {
    await expect(
      // @ts-expect-error deliberately omitting tenantId to test the guard
      withTenant(prisma, {}, (tx) => tx.toolDefinition.findMany()),
    ).rejects.toThrow(/tenantId/);
  });

  it("withPlatformContext can see rows across both tenants (the sanctioned cross-tenant escape hatch)", async () => {
    const rows = await withPlatformContext(prisma, (tx) =>
      tx.toolDefinition.findMany({ where: { name: "tenant_a_only_tool" } }),
    );
    expect(rows.some((r) => r.tenantId === tenantAId)).toBe(true);
  });

  /**
   * Regression test for the RLS entry-point bug: apps/api's auth.routes.ts,
   * widgetConfig.routes.ts, and chat.routes.ts used to call
   * `ctx.prisma.X.findUnique/create()` directly — no withTenant/
   * withPlatformContext wrapper, so no `app.current_tenant_id` /
   * `app.is_platform_context` session vars were ever set. Against a real
   * FORCE ROW LEVEL SECURITY table this doesn't error, it just silently
   * returns zero rows (reads) or gets rejected (writes) — exactly the kind
   * of failure that's invisible in mocked/unit-level testing and only
   * shows up against a real RLS-enforced database. This proves the
   * dangerous shape directly: a raw, unwrapped `prisma.X.findMany()` call
   * (no transaction, no session vars) against a known-populated table
   * returns nothing, and the same query wrapped in withTenant/
   * withPlatformContext correctly returns it.
   */
  it("a raw unscoped query (no withTenant/withPlatformContext) against a FORCE-RLS table never returns another tenant's row — fails closed as either zero rows or a rejected query", async () => {
    // Both a thrown query and an empty result count as "fails closed" here.
    // In practice this reliably throws against Neon's pooled connections:
    // a `SET LOCAL` custom GUC (app.is_platform_context) reverts to an
    // empty string, not NULL, once its transaction commits, and a raw
    // query reusing that connection hits
    // COALESCE(current_setting(...), 'false')::boolean with '' as the
    // input — an actual live-DB bug in chat.is_platform_context(), now
    // fixed in rls_policies.sql (NULLIF guard, matching current_tenant_id()
    // above) but not yet re-applied to this shared Neon instance. Either
    // way, the one outcome that must NEVER happen is tenant A's row coming
    // back on an unscoped call — which is exactly the shape of the RLS
    // entry-point bug in the pre-fix auth.routes.ts/widgetConfig.routes.ts/
    // chat.routes.ts.
    let raw: unknown[] = [];
    try {
      raw = await prisma.toolDefinition.findMany({ where: { name: "tenant_a_only_tool" } });
    } catch {
      raw = [];
    }
    expect(raw).toHaveLength(0);

    // Same query, same data, wrapped correctly — proves the empty/rejected
    // result above is RLS failing closed, not a fluke of the query itself.
    const scoped = await withTenant(prisma, { tenantId: tenantAId }, (tx) =>
      tx.toolDefinition.findMany({ where: { name: "tenant_a_only_tool" } }),
    );
    expect(scoped.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * Regression test for rls_policies.sql's WITH CHECK bug: WITH CHECK used
   * to lack the `OR chat.is_platform_context()` bypass that USING already
   * had, so it fell back to `tenant_id = chat.current_tenant_id()` alone —
   * which correctly rejects a write for a DIFFERENT tenant than the
   * session is scoped to (this is the isolation guarantee actually
   * working), but ALSO rejected every legitimate withPlatformContext()
   * write, since current_tenant_id() is NULL there and `tenant_id = NULL`
   * is never true in SQL. Two assertions: the isolation case (should stay
   * rejected — this was never broken) and the platform-context case
   * (was broken, now fixed).
   */
  it("withTenant rejects an insert whose tenantId doesn't match the session's scoped tenant", async () => {
    await expect(
      withTenant(prisma, { tenantId: tenantAId }, (tx) =>
        tx.toolDefinition.create({
          data: {
            tenantId: tenantBId, // mismatched — session is scoped to tenant A
            name: "cross_tenant_insert_attempt",
            description: "should be rejected by WITH CHECK",
            category: "webhook",
            inputSchema: {},
            outputSchema: {},
            executionTier: "automatic",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("withPlatformContext can insert a User row under a freshly created tenant (the exact signup code path)", async () => {
    const { tenant, user } = await withPlatformContext(prisma, async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: "RLS WITH CHECK Test Tenant", slug: `rls-with-check-${randomUUID()}` },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: `rls-with-check-${randomUUID()}@example.com`,
          passwordHash: "not-a-real-hash",
          role: "tenant_owner",
          displayName: "RLS Test User",
        },
      });
      return { tenant, user };
    });

    expect(tenant.id).toBeTruthy();
    expect(user.tenantId).toBe(tenant.id);

    // The row must be readable back under its own tenant's normal
    // withTenant context too, not just via platform context.
    const found = await withTenant(prisma, { tenantId: tenant.id }, (tx) =>
      tx.user.findUnique({ where: { id: user.id } }),
    );
    expect(found?.email).toBe(user.email);

    await withPlatformContext(prisma, (tx) => tx.tenant.delete({ where: { id: tenant.id } }));
  });
});
