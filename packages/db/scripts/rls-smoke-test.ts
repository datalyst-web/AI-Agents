/**
 * One-off RLS validation against a live database, run as the actual
 * chat_app_user app role (not the owner) — proves tenant isolation is
 * enforced by Postgres itself, not just by application-layer WHERE
 * clauses. Not part of the build; run manually with tsx.
 */
import { randomUUID } from "node:crypto";
import { createPrismaClient, withTenant, withPlatformContext } from "../src/client.js";

const APP_DATABASE_URL = process.env.CHAT_APP_DATABASE_URL;
if (!APP_DATABASE_URL) {
  console.error("Set CHAT_APP_DATABASE_URL to a connection string authenticating as chat_app_user.");
  process.exit(1);
}

async function main() {
  const prisma = createPrismaClient(APP_DATABASE_URL!);

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  // Tenant creation is a platform-context operation (see auth.routes.ts
  // signup) — chat_app_user has no ambient tenant yet at this point.
  await withPlatformContext(prisma, (tx) =>
    tx.tenant.createMany({
      data: [
        { id: tenantA, name: "Tenant A", slug: `tenant-a-${tenantA.slice(0, 8)}` },
        { id: tenantB, name: "Tenant B", slug: `tenant-b-${tenantB.slice(0, 8)}` },
      ],
    }),
  );

  await withTenant(prisma, { tenantId: tenantA }, (tx) =>
    tx.user.create({ data: { tenantId: tenantA, email: `a-${randomUUID()}@example.com`, passwordHash: "x", role: "tenant_owner", displayName: "A" } }),
  );
  await withTenant(prisma, { tenantId: tenantB }, (tx) =>
    tx.user.create({ data: { tenantId: tenantB, email: `b-${randomUUID()}@example.com`, passwordHash: "x", role: "tenant_owner", displayName: "B" } }),
  );

  // The real test: query `users` with NO where clause at all while scoped to
  // tenant A — if RLS is enforced, only tenant A's row comes back even
  // though the Prisma query itself imposes no filter.
  const seenByA = await withTenant(prisma, { tenantId: tenantA }, (tx) => tx.user.findMany());
  const seenByB = await withTenant(prisma, { tenantId: tenantB }, (tx) => tx.user.findMany());
  const seenUnscoped = await prisma.user.findMany().catch((e) => `ERROR (expected if RLS fails closed with no session var set): ${e.message}`);

  const aOk = seenByA.length === 1 && seenByA[0]!.tenantId === tenantA;
  const bOk = seenByB.length === 1 && seenByB[0]!.tenantId === tenantB;
  const noCrossLeak = !seenByA.some((u) => u.tenantId === tenantB) && !seenByB.some((u) => u.tenantId === tenantA);

  console.log("Tenant A sees only its own row:", aOk, `(${seenByA.length} rows)`);
  console.log("Tenant B sees only its own row:", bOk, `(${seenByB.length} rows)`);
  console.log("No cross-tenant leakage:", noCrossLeak);
  console.log("Unscoped query (no withTenant at all) result:", Array.isArray(seenUnscoped) ? `${seenUnscoped.length} rows (fails closed = 0 expected)` : seenUnscoped);

  const platformView = await withPlatformContext(prisma, (tx) => tx.tenant.findMany({ where: { id: { in: [tenantA, tenantB] } } }));
  console.log("Platform context sees both tenants:", platformView.length === 2);

  // cleanup
  await withPlatformContext(prisma, async (tx) => {
    await tx.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
  });

  const allPassed = aOk && bOk && noCrossLeak && (Array.isArray(seenUnscoped) ? seenUnscoped.length === 0 : true) && platformView.length === 2;
  console.log(allPassed ? "\nRLS SMOKE TEST: PASS" : "\nRLS SMOKE TEST: FAIL");
  await prisma.$disconnect();
  process.exit(allPassed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
