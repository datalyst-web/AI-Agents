import { defineConfig } from "vitest/config";

// Pure configuration checks must never load .env.test or contact a database.
export default defineConfig({
  test: {
    include: ["packages/config/src/**/*.test.ts", "packages/email/src/**/*.test.ts", "apps/api/src/lib/rbac.test.ts", "apps/api/src/plugins/auth.lapsed.test.ts", "apps/api/src/lib/logRedaction.test.ts"],
    environment: "node",
  },
});
