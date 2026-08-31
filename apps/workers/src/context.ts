import { Redis } from "ioredis";
import { createPrismaClient, type PrismaClient } from "@chat-agent/db";
import { createModelRouterFromConfig, type ModelRouter } from "@chat-agent/ai-provider";
import { createSecretsProvider, DbSecretsProvider, type SecretsProvider } from "@chat-agent/secrets";
import { createQueueClient, type QueueClient } from "@chat-agent/queue";
import { ObjectStore } from "@chat-agent/storage";
import { createEmailProviderFromEnv, type EmailProvider } from "@chat-agent/email";
import { env } from "./env.js";

/** Mirrors apps/api/src/lib/context.ts — same construction logic, separate process. */
export interface WorkerContext {
  prisma: PrismaClient;
  router: ModelRouter;
  secrets: SecretsProvider;
  queue: QueueClient;
  objectStore: ObjectStore;
  email: EmailProvider;
  /** Raw client for lib/lock.ts's cross-replica sweep lock — separate from the queue's internal Redis usage. */
  redis: Redis;
}

export function buildWorkerContext(): WorkerContext {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const router = createModelRouterFromConfig({
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
    geminiApiKey: env.GEMINI_API_KEY,
    anthropicModelId: env.ANTHROPIC_MODEL_ID,
    openaiModelId: env.OPENAI_MODEL_ID,
    geminiModelId: env.GEMINI_MODEL_ID,
    openaiEmbeddingModelId: env.OPENAI_EMBEDDING_MODEL_ID,
    geminiEmbeddingModelId: env.GEMINI_EMBEDDING_MODEL_ID,
    anthropicHaikuModelId: env.ANTHROPIC_MODEL_HAIKU_ID,
    anthropicSonnetModelId: env.ANTHROPIC_MODEL_SONNET_ID,
    anthropicOpusModelId: env.ANTHROPIC_MODEL_OPUS_ID,
    defaultChain: env.AI_FAILOVER_CHAIN,
  });
  // Mirrors apps/api/src/lib/context.ts's same fix — must read/write the
  // exact same store the API writes tool/integration credentials into,
  // or a workflow action running here would never find a credential a
  // tenant connected via the dashboard.
  if (env.SECRETS_PROVIDER === "env" && env.NODE_ENV === "production" && !env.ALLOW_ENV_SECRETS_IN_PRODUCTION) {
    throw new Error(
      "SECRETS_PROVIDER must be 'aws' in production, unless ALLOW_ENV_SECRETS_IN_PRODUCTION=true is set as a deliberate, temporary choice for a lean launch without AWS infra.",
    );
  }
  const secrets: SecretsProvider =
    env.SECRETS_PROVIDER === "aws"
      ? createSecretsProvider({
          mode: "aws",
          region: env.AWS_REGION,
          pathPrefix: env.SECRETS_PATH_PREFIX,
          allowEnvInProduction: env.ALLOW_ENV_SECRETS_IN_PRODUCTION,
        })
      : new DbSecretsProvider(prisma, env.CHANNEL_CREDENTIALS_ENCRYPTION_KEY ?? "");
  const queue = createQueueClient({
    awsRegion: env.AWS_REGION,
    redisUrl: env.REDIS_URL,
    redisKeyPrefix: env.REDIS_KEY_PREFIX,
    preferSqs: Boolean(env.SQS_KNOWLEDGE_INGEST_QUEUE_URL),
  });
  const objectStore = new ObjectStore(env.S3_BUCKET, env.S3_KEY_PREFIX, env.AWS_REGION, env.S3_ENDPOINT);
  const redis = new Redis(env.REDIS_URL);
  const email = createEmailProviderFromEnv({
    SMTP_HOST: env.SMTP_HOST,
    SMTP_PORT: env.SMTP_PORT,
    SMTP_SECURE: env.SMTP_SECURE,
    SMTP_USER: env.SMTP_USER,
    SMTP_PASSWORD: env.SMTP_PASSWORD,
    SMTP_FROM_ADDRESS: env.SMTP_FROM_ADDRESS,
  });

  return { prisma, router, secrets, queue, objectStore, email, redis };
}
