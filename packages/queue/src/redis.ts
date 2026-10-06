import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import type { QueueClient, QueueMessage } from "./types.js";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_SECONDS = 30;
const MAX_BACKOFF_SECONDS = 30 * 60; // cap at 30 minutes between attempts

const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TTL_MS = 60_000;
const PROMOTE_INTERVAL_MS = 1_000;
const REAP_INTERVAL_MS = 30_000;
const PROMOTE_BATCH = 100;
/**
 * Before per-consumer processing lists existed, every worker shared one
 * `<queue>:processing` list with no owner. Entries left in it can only
 * belong to a pre-upgrade worker, which a deploy replaces within seconds;
 * waiting this long before requeueing them makes sure it's really gone.
 */
const LEGACY_PROCESSING_GRACE_MS = 10 * 60_000;

function backoffSeconds(attempt: number): number {
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** (attempt - 1), MAX_BACKOFF_SECONDS);
}

/** Moves every delayed message whose due time has passed onto the ready list, atomically. */
const PROMOTE_DUE_SCRIPT = `
local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))
for _, raw in ipairs(due) do
  redis.call('ZREM', KEYS[1], raw)
  redis.call('LPUSH', KEYS[2], raw)
end
return #due
`;

export interface RedisQueueTimings {
  heartbeatIntervalMs?: number;
  heartbeatTtlMs?: number;
  promoteIntervalMs?: number;
  reapIntervalMs?: number;
  legacyProcessingGraceMs?: number;
  /** Seconds to wait before retry N (1-indexed); defaults to 30s doubling, capped at 30 min. */
  backoffSeconds?: (attempt: number) => number;
}

/**
 * The queue that runs in production (Railway Redis — createQueueClient in
 * index.ts only picks SqsQueueClient when an SQS queue URL is configured,
 * which this deployment doesn't set).
 *
 * Nothing lives only in process memory, so a worker restart (every deploy)
 * loses nothing:
 *
 * - Delayed messages and retry backoffs wait in a `<queue>:delayed` sorted
 *   set scored by due time, and a promoter moves due ones onto the ready
 *   list. They used to sit in `setTimeout`s, already removed from Redis.
 * - Each client takes messages into its own `<queue>:processing:<id>` list
 *   and keeps a heartbeat key alive. When a heartbeat expires (the worker
 *   crashed or was killed mid-job), any other consumer's reaper puts that
 *   worker's in-flight messages back on the queue as a new attempt.
 *
 * Delivery is at-least-once: a job interrupted by a crash runs again, the
 * same as one that threw. A message that keeps failing (or keeps killing
 * its worker) gets MAX_ATTEMPTS tries with exponential backoff (30s, 60s,
 * 120s, ... capped at 30 min), then moves to `<queue>:dead` instead of
 * retrying forever — found live: a permanently failing job was burning
 * through Gemini's free embedding quota in a tight loop.
 */
export class RedisQueueClient implements QueueClient {
  private redis: Redis;
  private blockingConnections: Redis[] = [];
  private stopped = false;
  private keyPrefix: string;
  private consumerId = randomUUID();
  private startedAt = Date.now();
  private timers: NodeJS.Timeout[] = [];
  private consumeLoops: Promise<void>[] = [];
  private queuesConsumed = new Set<string>();
  private timings: Required<RedisQueueTimings>;

  constructor(url: string, keyPrefix = "chat:", timings: RedisQueueTimings = {}) {
    this.redis = new Redis(url);
    this.keyPrefix = keyPrefix;
    this.timings = {
      heartbeatIntervalMs: timings.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS,
      heartbeatTtlMs: timings.heartbeatTtlMs ?? HEARTBEAT_TTL_MS,
      promoteIntervalMs: timings.promoteIntervalMs ?? PROMOTE_INTERVAL_MS,
      reapIntervalMs: timings.reapIntervalMs ?? REAP_INTERVAL_MS,
      legacyProcessingGraceMs: timings.legacyProcessingGraceMs ?? LEGACY_PROCESSING_GRACE_MS,
      backoffSeconds: timings.backoffSeconds ?? backoffSeconds,
    };
  }

  private key(queueName: string): string {
    return `${this.keyPrefix}queue:${queueName}`;
  }

  private delayedKey(queueName: string): string {
    return `${this.key(queueName)}:delayed`;
  }

  private deadLetterKey(queueName: string): string {
    return `${this.key(queueName)}:dead`;
  }

  private processingKey(queueName: string, consumerId: string): string {
    return `${this.key(queueName)}:processing:${consumerId}`;
  }

  private consumersKey(queueName: string): string {
    return `${this.key(queueName)}:consumers`;
  }

  private heartbeatKey(consumerId: string): string {
    return `${this.keyPrefix}queue-consumer:${consumerId}`;
  }

  async enqueue<T>(queueName: string, payload: T, opts?: { delaySeconds?: number }): Promise<void> {
    const message: QueueMessage<T> = { id: randomUUID(), body: payload, attempt: 1 };
    const serialized = JSON.stringify(message);
    if (opts?.delaySeconds && opts.delaySeconds > 0) {
      await this.redis.zadd(this.delayedKey(queueName), Date.now() + opts.delaySeconds * 1000, serialized);
      return;
    }
    await this.redis.lpush(this.key(queueName), serialized);
  }

  async consume<T>(queueName: string, handler: (msg: QueueMessage<T>) => Promise<void>): Promise<void> {
    await this.startBackgroundWork(queueName);
    const loop = this.consumeLoop(queueName, handler);
    this.consumeLoops.push(loop);
    return loop;
  }

  private async consumeLoop<T>(queueName: string, handler: (msg: QueueMessage<T>) => Promise<void>): Promise<void> {
    // One blocking connection per consumer — a shared one serialises every
    // queue's BRPOPLPUSH behind the others' 5s waits.
    const blocking = this.redis.duplicate();
    this.blockingConnections.push(blocking);
    const processingKey = this.processingKey(queueName, this.consumerId);

    while (!this.stopped) {
      let raw: string | null;
      try {
        raw = await blocking.brpoplpush(this.key(queueName), processingKey, 5);
      } catch (err) {
        if (this.stopped) break;
        throw err;
      }
      if (!raw) continue;

      let message: QueueMessage<T>;
      try {
        message = JSON.parse(raw) as QueueMessage<T>;
      } catch (err) {
        // Unparseable, so it can never succeed — straight to dead letter.
        await this.redis.multi().lrem(processingKey, 1, raw).lpush(this.deadLetterKey(queueName), raw).exec();
        console.error(`[queue] "${queueName}" received an unparseable message, moved to dead letter:`, err);
        continue;
      }

      try {
        await handler(message);
        await this.redis.lrem(processingKey, 1, raw);
      } catch (err) {
        await this.failMessage(queueName, processingKey, raw, message, err);
      }
    }
  }

  /** Retries with backoff, or dead-letters after MAX_ATTEMPTS — atomically with removing it from `fromKey`. */
  private async failMessage(queueName: string, fromKey: string, raw: string, message: QueueMessage, err: unknown): Promise<void> {
    const attempt = message.attempt ?? 1;
    if (attempt >= MAX_ATTEMPTS) {
      await this.redis.multi().lrem(fromKey, 1, raw).lpush(this.deadLetterKey(queueName), raw).exec();
      console.error(
        `[queue] "${queueName}" message ${message.id} failed ${attempt} time(s), moving to dead letter (not retrying again):`,
        err,
      );
      return;
    }
    const delay = this.timings.backoffSeconds(attempt);
    const requeued = JSON.stringify({ ...message, attempt: attempt + 1 });
    await this.redis
      .multi()
      .lrem(fromKey, 1, raw)
      .zadd(this.delayedKey(queueName), Date.now() + delay * 1000, requeued)
      .exec();
    console.error(`[queue] "${queueName}" message ${message.id} failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${delay}s:`, err);
  }

  private async startBackgroundWork(queueName: string): Promise<void> {
    if (this.queuesConsumed.has(queueName)) return;
    this.queuesConsumed.add(queueName);

    if (this.queuesConsumed.size === 1) {
      await this.beat();
      this.every(this.timings.heartbeatIntervalMs, () => this.beat());
    }
    await this.redis.sadd(this.consumersKey(queueName), this.consumerId);

    await this.promoteDue(queueName);
    this.every(this.timings.promoteIntervalMs, () => this.promoteDue(queueName));
    this.every(this.timings.reapIntervalMs, () => this.reapOrphans(queueName));
  }

  private every(intervalMs: number, fn: () => Promise<unknown>): void {
    const timer = setInterval(() => {
      if (this.stopped) return;
      fn().catch((err) => console.error("[queue] background task failed:", err));
    }, intervalMs);
    timer.unref();
    this.timers.push(timer);
  }

  private async beat(): Promise<void> {
    await this.redis.set(this.heartbeatKey(this.consumerId), "1", "PX", this.timings.heartbeatTtlMs);
  }

  private async promoteDue(queueName: string): Promise<void> {
    await this.redis.eval(PROMOTE_DUE_SCRIPT, 2, this.delayedKey(queueName), this.key(queueName), Date.now(), PROMOTE_BATCH);
  }

  /** Requeues in-flight messages owned by consumers whose heartbeat has expired. */
  async reapOrphans(queueName: string): Promise<number> {
    let recovered = 0;
    const consumers = await this.redis.smembers(this.consumersKey(queueName));
    for (const consumerId of consumers) {
      if (consumerId === this.consumerId) continue;
      if (await this.redis.exists(this.heartbeatKey(consumerId))) continue;
      recovered += await this.recoverList(queueName, this.processingKey(queueName, consumerId));
      if ((await this.redis.llen(this.processingKey(queueName, consumerId))) === 0) {
        await this.redis.srem(this.consumersKey(queueName), consumerId);
      }
    }
    if (Date.now() - this.startedAt >= this.timings.legacyProcessingGraceMs) {
      recovered += await this.recoverList(queueName, `${this.key(queueName)}:processing`);
    }
    return recovered;
  }

  private async recoverList(queueName: string, listKey: string): Promise<number> {
    // Only one reaper may drain a given list at a time.
    const lockKey = `${listKey}:reaping`;
    if ((await this.redis.set(lockKey, this.consumerId, "PX", 60_000, "NX")) !== "OK") return 0;
    let recovered = 0;
    try {
      const entries = await this.redis.lrange(listKey, 0, -1);
      for (const raw of entries) {
        let message: QueueMessage;
        try {
          message = JSON.parse(raw) as QueueMessage;
        } catch {
          await this.redis.multi().lrem(listKey, 1, raw).lpush(this.deadLetterKey(queueName), raw).exec();
          continue;
        }
        console.error(`[queue] "${queueName}" message ${message.id} was in flight on a worker that stopped; requeueing.`);
        await this.failMessage(queueName, listKey, raw, message, new Error("worker stopped while processing"));
        recovered++;
      }
    } finally {
      await this.redis.del(lockKey);
    }
    return recovered;
  }

  /** For an ops/health check — how many messages have permanently failed for a queue. */
  async deadLetterCount(queueName: string): Promise<number> {
    return this.redis.llen(this.deadLetterKey(queueName));
  }

  /** For an ops/health check — how many messages are scheduled for later (delays and retry backoffs). */
  async delayedCount(queueName: string): Promise<number> {
    return this.redis.zcard(this.delayedKey(queueName));
  }

  /**
   * Stops taking new messages, waits up to `drainTimeoutMs` for in-flight
   * handlers to finish, then disconnects. Anything still in flight after
   * that stays in this consumer's processing list, and another worker's
   * reaper requeues it once this heartbeat expires.
   */
  async stop(drainTimeoutMs = 25_000): Promise<void> {
    this.stopped = true;
    for (const timer of this.timers) clearInterval(timer);
    const drained = await Promise.race([
      Promise.allSettled(this.consumeLoops).then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), drainTimeoutMs).unref()),
    ]);
    for (const connection of this.blockingConnections) connection.disconnect();
    if (drained) {
      await this.redis.del(this.heartbeatKey(this.consumerId));
      for (const queueName of this.queuesConsumed) {
        if ((await this.redis.llen(this.processingKey(queueName, this.consumerId))) === 0) {
          await this.redis.srem(this.consumersKey(queueName), this.consumerId);
        }
      }
    }
    await this.redis.quit();
  }
}
