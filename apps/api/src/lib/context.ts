import { createPrismaClient, type PrismaClient } from "@chat-agent/db";
import { createModelRouterFromConfig, type ModelRouter } from "@chat-agent/ai-provider";
import { createSecretsProvider, type SecretsProvider } from "@chat-agent/secrets";
import { createQueueClient, type QueueClient } from "@chat-agent/queue";
import { ObjectStore } from "@chat-agent/storage";
import { env } from "../env.js";

/**
 * Process-wide singletons, built once at server start and threaded through
 * routes via Fastify's decorate/decorateRequest rather than module-level
 * globals scattered across files — keeps apps/workers able to reuse the
 * exact same construction logic.
 */
export interface AppContext {
  prisma: PrismaClient;
  router: ModelRouter;
  secrets: SecretsProvider;
  queue: QueueClient;
  objectStore: ObjectStore;
}

export function buildAppContext(): AppContext {
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
    defaultChain: env.AI_FAILOVER_CHAIN,
  });
  // Usage rows are written tenant-scoped inside engine/agentLoop.ts's RECORD
  // stage (via withTenant), not from a global router.onUsage listener here —
  // a listener at this layer has no tenant/agent/conversation to attach to.

  const secrets = createSecretsProvider({
    mode: env.SECRETS_PROVIDER,
    region: env.AWS_REGION,
    pathPrefix: env.SECRETS_PATH_PREFIX,
    allowEnvInProduction: env.ALLOW_ENV_SECRETS_IN_PRODUCTION,
  });

  const queue = createQueueClient({
    awsRegion: env.AWS_REGION,
    redisUrl: env.REDIS_URL,
    redisKeyPrefix: env.REDIS_KEY_PREFIX,
    preferSqs: Boolean(env.SQS_KNOWLEDGE_INGEST_QUEUE_URL),
  });

  const objectStore = new ObjectStore(env.S3_BUCKET, env.S3_KEY_PREFIX, env.AWS_REGION);

  return { prisma, router, secrets, queue, objectStore };
}
