import { z } from "zod";

const ProviderNameSchema = z.enum(["anthropic", "openai", "gemini"]);

/**
 * Single source of truth for environment shape, shared by apps/api,
 * apps/workers, and any script. Validated eagerly at process start so a
 * missing/malformed env var fails fast instead of surfacing as a runtime
 * 500 deep in a request.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_ID: z.string().default("claude-sonnet-5"),
  // Per-tier Claude model ids a tenant picks between in the dashboard
  // (Anthropic is the default provider, per CLAUDE.md model routing) — the
  // plain ANTHROPIC_MODEL_ID above stays as the ultimate fallback if a
  // tenant's chosen tier somehow has no id configured.
  ANTHROPIC_MODEL_HAIKU_ID: z.string().default("claude-haiku-4-5-20251001"),
  ANTHROPIC_MODEL_SONNET_ID: z.string().default("claude-sonnet-5"),
  ANTHROPIC_MODEL_OPUS_ID: z.string().default("claude-opus-5"),
  OPENAI_MODEL_ID: z.string().default("gpt-5"),
  // gemini-2.5-flash was retired for new API keys ("no longer available to
  // new users") — gemini-3.5-flash-lite is the current pinned replacement,
  // confirmed working against a live key; keep this in sync with .env.example.
  GEMINI_MODEL_ID: z.string().default("gemini-3.5-flash-lite"),
  // Embeddings are a genuinely separate model family per vendor — never
  // reuse a chat model id for these, and never let a caller's hardcoded
  // cross-vendor override (e.g. an OpenAI model name) reach a Gemini
  // request when the router falls back to Gemini (see ModelRouter.embed()).
  OPENAI_EMBEDDING_MODEL_ID: z.string().default("text-embedding-3-small"),
  GEMINI_EMBEDDING_MODEL_ID: z.string().default("gemini-embedding-001"),
  DEFAULT_AI_PROVIDER: ProviderNameSchema.default("gemini"),
  AI_FAILOVER_CHAIN: z
    .string()
    .default("anthropic,openai,gemini")
    .transform((s) => s.split(",").map((p) => p.trim()) as z.infer<typeof ProviderNameSchema>[]),

  DATABASE_URL: z.string().min(1),
  DATABASE_SHADOW_URL: z.string().optional(),

  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_KEY_PREFIX: z.string().default("chat:"),

  S3_BUCKET: z.string().default("agents-platform-storage"),
  S3_KEY_PREFIX: z.string().default("chat"),
  AWS_REGION: z.string().default("us-east-1"),
  // Set only when using an S3-compatible provider other than AWS itself
  // (e.g. Cloudflare R2's account-scoped endpoint,
  // https://<account_id>.r2.cloudflarestorage.com) — leave unset for
  // real AWS S3, which needs no endpoint override.
  S3_ENDPOINT: z.string().optional(),

  SQS_KNOWLEDGE_INGEST_QUEUE_URL: z.string().optional(),
  SQS_WORKFLOW_RUN_QUEUE_URL: z.string().optional(),
  SQS_FOLLOWUP_QUEUE_URL: z.string().optional(),

  SECRETS_PROVIDER: z.enum(["env", "aws"]).default("env"),
  SECRETS_PATH_PREFIX: z.string().default("chat/"),

  JWT_SECRET: z.string().min(8),
  JWT_ISSUER: z.string().default("ai-chat-agent-platform"),
  JWT_EXPIRY: z.string().default("15m"),
  JWT_REFRESH_EXPIRY: z.string().default("30d"),

  // Platform transactional email (password reset, etc.) — see
  // packages/email. Left unset in dev/test, where the Noop provider logs
  // instead of sending; production needs all four for real delivery.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_ADDRESS: z.string().optional(),
  DASHBOARD_BASE_URL: z.string().default("http://localhost:3000"),

  API_PORT: z.coerce.number().default(4000),
  API_CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((s) => s.split(",").map((o) => o.trim())),
  API_RATE_LIMIT_PER_MIN: z.coerce.number().default(120),

  WORKERS_CONCURRENCY: z.coerce.number().default(4),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  BILLING_PROVIDER_API_KEY: z.string().optional(),
  BILLING_WEBHOOK_SECRET: z.string().optional(),

  // Explicit, documented escape hatch for a lean launch on a platform
  // without AWS (Railway/Vercel/etc.) — CLAUDE.md's default expectation is
  // AWS Secrets Manager in production, and this must stay opt-in (never
  // silently allowed) so a careless deploy doesn't accidentally ship with
  // secrets sitting in plain env vars. Revisit once real AWS infra exists.
  ALLOW_ENV_SECRETS_IN_PRODUCTION: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | undefined;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  if (parsed.data.NODE_ENV === "production") {
    if (parsed.data.SECRETS_PROVIDER !== "aws" && !parsed.data.ALLOW_ENV_SECRETS_IN_PRODUCTION) {
      throw new Error(
        "SECRETS_PROVIDER must be 'aws' in production (CLAUDE.md Security Requirements), unless " +
          "ALLOW_ENV_SECRETS_IN_PRODUCTION=true is set as a deliberate, temporary choice for a lean " +
          "launch without AWS infra.",
      );
    }
    if (parsed.data.JWT_SECRET === "dev-only-change-me") {
      throw new Error("JWT_SECRET is still the dev default — set a real secret before running in production.");
    }
  }
  cachedEnv = parsed.data;
  return parsed.data;
}

/** Test-only: clears the memoized env so a suite can reload with different values. */
export function __resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
