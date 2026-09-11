import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Refuses to run the DB-backed tests against a database that already holds
 * real tenants.
 *
 * These tests create and delete tenants, users, agents and conversations.
 * That is harmless against an empty database — which is what the repo's
 * .env.test has always pointed at — but the moment this platform has a
 * paying client in it, a stray `pnpm test` would be writing to, and
 * deleting from, the same database serving them.
 *
 * The check is on *content*, not on the hostname, because that's what
 * actually makes it dangerous: an empty production database is safe to test
 * against, and a populated staging one is not. Set
 * ALLOW_TESTS_ON_POPULATED_DB=true to override deliberately.
 *
 * Fails open on any problem other than "this database has tenants in it" —
 * an unreachable database or a missing table is not this guard's business,
 * and the tests themselves report those far more usefully.
 */
export async function setup() {
  const url = process.env.CHAT_APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return; // DB tests skip themselves when no URL is configured.
  if (process.env.ALLOW_TESTS_ON_POPULATED_DB === "true") return;

  const rootDir = dirname(fileURLToPath(import.meta.url));
  // @prisma/client isn't resolvable from the workspace root — resolve it
  // from packages/db, the workspace package that actually depends on it.
  const dbPkg = resolve(rootDir, "packages/db/package.json");
  if (!existsSync(dbPkg)) return;

  let PrismaClient: new (opts: unknown) => {
    $queryRawUnsafe: (q: string) => Promise<{ n: number }[]>;
    $disconnect: () => Promise<void>;
  };
  try {
    ({ PrismaClient } = createRequire(dbPkg)("@prisma/client"));
  } catch {
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  let tenantCount: number | null = null;
  try {
    const rows = await prisma.$queryRawUnsafe("select count(*)::int as n from chat.tenants");
    tenantCount = rows[0]?.n ?? null;
  } catch {
    tenantCount = null;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  if (tenantCount && tenantCount > 0) {
    const host = url.replace(/^postgres(ql)?:\/\/[^@]*@/, "").split("/")[0];
    throw new Error(
      `\nRefusing to run tests: the target database (${host}) already contains ${tenantCount} tenant(s).\n` +
        `These tests create and delete tenant data.\n\n` +
        `Point CHAT_APP_DATABASE_URL in .env.test at an empty database — a Neon branch is ideal — or set\n` +
        `ALLOW_TESTS_ON_POPULATED_DB=true if you are certain this database is disposable.\n`,
    );
  }
}
