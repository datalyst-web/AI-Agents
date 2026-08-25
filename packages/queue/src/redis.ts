import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { QueueClient, QueueMessage } from "./types.js";

/**
 * Local/dev fallback backed by the same shared Redis used for caching
 * (ARCHITECTURE.md: "One ElastiCache Redis cluster, key-namespaced per
 * product"). Uses BRPOPLPUSH into a per-queue processing list so a crashed
 * worker's in-flight message isn't silently lost — a reaper would requeue
 * stale processing-list entries in a full implementation; noted here as
 * the one corner deliberately left simple for dev use, never wired into
 * the production path (SqsQueueClient is used whenever a queue URL is
 * configured — see createQueueClient in index.ts).
 */
export class RedisQueueClient implements QueueClient {
  private redis: Redis;
  private blockingRedis: Redis;
  private stopped = false;
  private keyPrefix: string;

  constructor(url: string, keyPrefix = "chat:") {
    this.redis = new Redis(url);
    this.blockingRedis = new Redis(url);
    this.keyPrefix = keyPrefix;
  }

  private key(queueName: string): string {
    return `${this.keyPrefix}queue:${queueName}`;
  }

  async enqueue<T>(queueName: string, payload: T, opts?: { delaySeconds?: number }): Promise<void> {
    const message: QueueMessage<T> = { id: randomUUID(), body: payload };
    const serialized = JSON.stringify(message);
    if (opts?.delaySeconds) {
      setTimeout(() => {
        void this.redis.lpush(this.key(queueName), serialized);
      }, opts.delaySeconds * 1000);
      return;
    }
    await this.redis.lpush(this.key(queueName), serialized);
  }

  async consume<T>(queueName: string, handler: (msg: QueueMessage<T>) => Promise<void>): Promise<void> {
    const processingKey = `${this.key(queueName)}:processing`;
    while (!this.stopped) {
      const raw = await this.blockingRedis.brpoplpush(this.key(queueName), processingKey, 5);
      if (!raw) continue;
      try {
        const message = JSON.parse(raw) as QueueMessage<T>;
        await handler(message);
        await this.redis.lrem(processingKey, 1, raw);
      } catch (err) {
        await this.redis.lrem(processingKey, 1, raw);
        await this.redis.lpush(this.key(queueName), raw); // simple immediate requeue for dev use
        // eslint-disable-next-line no-console
        console.error(`[queue] handler failed for message on "${queueName}":`, err);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.redis.quit();
    await this.blockingRedis.quit();
  }
}
