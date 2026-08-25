export * from "./types.js";
export { SqsQueueClient } from "./sqs.js";
export { RedisQueueClient } from "./redis.js";

import type { QueueClient } from "./types.js";
import { SqsQueueClient } from "./sqs.js";
import { RedisQueueClient } from "./redis.js";

export function createQueueClient(config: { awsRegion: string; redisUrl: string; redisKeyPrefix: string; preferSqs: boolean }): QueueClient {
  return config.preferSqs ? new SqsQueueClient(config.awsRegion) : new RedisQueueClient(config.redisUrl, config.redisKeyPrefix);
}

/** Known queue identifiers — SQS queue URL in production, logical name in Redis dev mode. */
export const QUEUE_NAMES = {
  knowledgeIngest: "chat-knowledge-ingest",
  workflowRun: "chat-workflow-run",
  followup: "chat-followup",
} as const;
