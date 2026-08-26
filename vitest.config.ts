import { defineConfig } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const rootDir = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal .env parser (no `dotenv` dependency) that loads test-only DB
 * connection strings from a gitignored .env.test at the repo root (see
 * .env.test's own header comment) into `test.env`, which vitest injects
 * into `process.env` for every test file/worker.
 *
 * Deliberately does not touch the real .env — apps/api/apps/workers read
 * that one via @chat-agent/config for actual server runs; this is test-only
 * wiring so `pnpm test` works out of the box against the live Neon
 * instance without every test file having to know the file path itself.
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    globals: false,
    reporters: "default",
    // A free Neon instance auto-suspends when idle — the first connection
    // after idle (or several test files racing to reconnect in parallel)
    // can take several seconds beyond a normal query's latency. 30s covers
    // that cold-start plus a real network round trip without masking a
    // genuinely hung test forever.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Every test file that touches the DB opens its own PrismaClient
    // connection pool. With the default threaded pool, vitest ran all
    // 11 files concurrently — against a free-tier Neon compute that's
    // enough simultaneous connections to intermittently exceed its
    // limit, surfacing as "Can't reach database server" on whichever
    // file's connection lost the race that run. Running files
    // sequentially keeps peak concurrent connections to one file's
    // worth at a time, which is what actually fixes it (switching the
    // connection string to the -pooler endpoint did not, since it
    // resolves to the same proxy IPs as the direct endpoint).
    fileParallelism: false,
    // Loaded values only fill in keys not already present in the real
    // process.env, so CI/shell-provided overrides always win.
    env: loadDotEnvFile(resolve(rootDir, ".env.test")),
  },
});
