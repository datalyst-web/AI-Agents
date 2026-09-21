import { defineConfig } from "vitest/config";

// Pure configuration checks must never load .env.test or contact a database.
export default defineConfig({
  test: {
    include: ["packages/config/src/**/*.test.ts"],
    environment: "node",
  },
});
