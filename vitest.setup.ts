import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Refuses to run the DB-backed tests against a database that already holds
 * real tenants.
 *
 * These tests create and delete tenants, users, agents and conversations.
 * That is harmless against an empty database — which is what the repo's
 * .env.test is supposed to point at — but the moment this platform has a
 * paying client in it, a stray `pnpm test` would be writing to, and
 * deleting from, the same database serving them.
 *
 * The check is on *content*, not on the hostname, because that's what
 * actually makes it dangerous: an empty production database is safe to test
 * against, and a populated staging one is not. Set
 * ALLOW_TESTS_ON_POPULATED_DB=true to override deliberately.
 *
 * Two things this has to get right, both found the hard way by testing
 * this guard against this repo's own real production database rather than
 * trusting it on inspection alone:
 *
 * 1. MUST go through the same set_config('app.is_platform_context', 'true')
 *    bypass withPlatformContext() uses (see packages/db/src/client.ts and
 *    rls_policies.sql's `USING (... OR chat.is_platform_context())`) — a
 *    plain `select count(*) from chat.tenants` over the app's own
 *    NOBYPASSRLS role sees ZERO rows regardless of how much real data
 *    exists, since FORCE ROW LEVEL SECURITY applies to every session that
 *    hasn't set that flag. A version of this guard using a plain query
 *    always read 0 against a database that actually had 19 real tenants.
 *
 * 2. MUST parse .env.test itself rather than trust process.env —
 *    vitest.config.ts's `test.env` option only injects into the worker
 *    processes that run test files; globalSetup runs earlier, in the main
 *    orchestrator process, and never sees those values. A version of this
 *    guard that just read process.env.CHAT_APP_DATABASE_URL always found
 *    it undefined and silently skipped the whole check.
 *
 * Fails open on any problem other than "this database has tenants in it" —
 * an unreachable database, a missing table, or no configured URL at all is
 * not this guard's business, and the tests themselves report those far
 * more usefully.
 */
function loadDotEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function setup() {
  const rootDir = dirname(fileURLToPath(import.meta.url));
  const fileEnv = loadDotEnvFile(resolve(rootDir, ".env.test"));
  const url = process.env.CHAT_APP_DATABASE_URL ?? fileEnv.CHAT_APP_DATABASE_URL ?? process.env.DATABASE_URL ?? fileEnv.DATABASE_URL;
  if (!url) return; // DB tests skip themselves when no URL is configured.
  if ((process.env.ALLOW_TESTS_ON_POPULATED_DB ?? fileEnv.ALLOW_TESTS_ON_POPULATED_DB) === "true") return;

  // @prisma/client isn't resolvable from the workspace root — resolve it
  // from packages/db, the workspace package that actually depends on it.
  const dbPkg = resolve(rootDir, "packages/db/package.json");
  if (!existsSync(dbPkg)) return;

  let PrismaClient: new (opts: unknown) => {
    $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
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
    tenantCount = await prisma.$transaction(async (tx: any) => {
      // Same two set_config calls as withPlatformContext() — deliberately
      // not importing it from @chat-agent/db, since that package may not
      // be built yet when this global setup runs.
      await tx.$executeRawUnsafe("SELECT set_config('app.current_tenant_id', '', true)");
      await tx.$executeRawUnsafe("SELECT set_config('app.is_platform_context', 'true', true)");
      const rows: { n: number }[] = await tx.$queryRawUnsafe("select count(*)::int as n from chat.tenants");
      return rows[0]?.n ?? null;
    });
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
