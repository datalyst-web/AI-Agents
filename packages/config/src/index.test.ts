import { afterEach, describe, expect, it } from "vitest";
import { EnvSchema, loadEnv, __resetEnvCacheForTests } from "./index.js";

const base = { DATABASE_URL: "postgresql://localhost/test", JWT_SECRET: "test-only-secret" };
afterEach(__resetEnvCacheForTests);

describe("environment boolean settings", () => {
  it("keeps secure defaults when omitted", () => {
    const env = EnvSchema.parse(base);
    expect(env.REQUIRE_TWO_FACTOR).toBe(true);
    expect(env.ALLOW_ENV_SECRETS_IN_PRODUCTION).toBe(false);
  });

  it.each([true, false, "true", "false"])("parses %j without JavaScript truthiness", (value) => {
    const env = EnvSchema.parse({ ...base, REQUIRE_TWO_FACTOR: value, ALLOW_ENV_SECRETS_IN_PRODUCTION: value });
    expect(env.REQUIRE_TWO_FACTOR).toBe(value === true || value === "true");
    expect(env.ALLOW_ENV_SECRETS_IN_PRODUCTION).toBe(value === true || value === "true");
  });

  it.each(["", "yes", "0", "FALSE", 0, 1])("rejects ambiguous value %j", (value) => {
    expect(EnvSchema.safeParse({ ...base, REQUIRE_TWO_FACTOR: value }).success).toBe(false);
    expect(EnvSchema.safeParse({ ...base, ALLOW_ENV_SECRETS_IN_PRODUCTION: value }).success).toBe(false);
  });

  it("does not allow the string false to bypass the production secrets requirement", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production", SECRETS_PROVIDER: "env", ALLOW_ENV_SECRETS_IN_PRODUCTION: "false" }))
      .toThrow("SECRETS_PROVIDER must be 'aws'");
  });

  it("allows an explicit production opt-out and honors the two-factor setting", () => {
    const env = loadEnv({ ...base, NODE_ENV: "production", SECRETS_PROVIDER: "env", ALLOW_ENV_SECRETS_IN_PRODUCTION: "true", REQUIRE_TWO_FACTOR: "false" });
    expect(env.REQUIRE_TWO_FACTOR).toBe(false);
  });
});
