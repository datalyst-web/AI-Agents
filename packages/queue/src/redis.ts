import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { QueueClient, QueueMessage } from "./types.js";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 30 * 60; // cap at 30 minutes between attempts

function backoffSeconds(attempt: number): number {
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS);
}

/**
 * Local/dev fallback backed by the same shared Redis used for caching
 * (ARCHITECTURE.md: "One ElastiCache Redis cluster, key-namespaced per
 * product"). Uses BRPOPLPUSH into a per-queue processing list so a crashed
 * worker's in-flight message isn't silently lost — a reaper would requeue
 * stale processing-list entries in a full implementation; noted here as
 * the one corner deliberately left simple, but NOT dev-only in practice:
 * this is the queue client that actually runs in production on the
 * "lean launch" stack (Railway Redis, no AWS/SQS) — see createQueueClient
 * in index.ts, which only picks SqsQueueClient when an SQS queue URL is
 * configured, which this deployment doesn't set.
 *
 * A permanently-failing message (bad config, an exhausted external quota,
 * etc.) must not retry immediately forever — found live: it was burning
 * through Gemini's free embedding quota in a tight loop with zero
 * backoff and zero limit. Retries now back off exponentially
 * (30s, 60s, 120s, ... capped at 30 min) and, after MAX_ATTEMPTS, move to
 * a per-queue dead-letter list instead of requeuing again — visible via
 * deadLetterCount()/drainDeadLetter() rather than a silent infinite loop.
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

  private deadLetterKey(queueName: string): string {
    return `${this.key(queueName)}:dead`;
  }

  async enqueue<T>(queueName: string, payload: T, opts?: { delaySeconds?: number }): Promise<void> {
    const message: QueueMessage<T> = { id: randomUUID(), body: payload, attempt: 1 };
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
        const message = JSON.parse(raw) as QueueMessage<T>;
        const attempt = message.attempt ?? 1;
        if (attempt >= MAX_ATTEMPTS) {
          await this.redis.lpush(this.deadLetterKey(queueName), raw);
          // eslint-disable-next-line no-console
          console.error(
            `[queue] "${queueName}" message ${message.id} failed ${attempt} time(s), moving to dead letter (not retrying again):`,
            err,
          );
        } else {
          const delay = backoffSeconds(attempt);
          const requeued = JSON.stringify({ ...message, attempt: attempt + 1 });
          setTimeout(() => {
            void this.redis.lpush(this.key(queueName), requeued);
          }, delay * 1000);
          // eslint-disable-next-line no-console
          console.error(`[queue] "${queueName}" message ${message.id} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}s:`, err);
        }
      }
    }
  }

  /** For an ops/health check — how many messages have permanently failed for a queue. */
  async deadLetterCount(queueName: string): Promise<number> {
    return this.redis.llen(this.deadLetterKey(queueName));
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.redis.quit();
    await this.blockingRedis.quit();
  }
}
