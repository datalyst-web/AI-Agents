import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { RedisQueueClient } from "./redis.js";
import type { QueueMessage } from "./types.js";

/**
 * Restart safety for the production queue: nothing a worker restart can
 * lose may live only in process memory. Runs against a real Redis (CI's
 * service container, or REDIS_URL locally); skipped when none is reachable.
 */
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

async function redisAvailable(): Promise<boolean> {
  const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const available = await redisAvailable();

const FAST = {
  heartbeatIntervalMs: 50,
  heartbeatTtlMs: 300,
  promoteIntervalMs: 50,
  reapIntervalMs: 100,
  backoffSeconds: () => 0.2,
};

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("condition not met in time");
}

describe.skipIf(!available)("RedisQueueClient restart safety", () => {
  const clients: RedisQueueClient[] = [];
  const raw = available ? new Redis(REDIS_URL) : undefined;
  let prefix = "";

  function client(): RedisQueueClient {
    const c = new RedisQueueClient(REDIS_URL, prefix, FAST);
    clients.push(c);
    return c;
  }

  afterEach(async () => {
    await Promise.allSettled(clients.splice(0).map((c) => c.stop(500)));
    const keys = await raw!.keys(`${prefix}*`);
    if (keys.length) await raw!.del(...keys);
  });

  it("delivers a delayed message only after its delay, from Redis rather than a process timer", async () => {
    prefix = `test:${randomUUID()}:`;
    const producer = client();
    await producer.enqueue("q", { n: 1 }, { delaySeconds: 0.4 });
    // A different process (the consumer) must see it — proves it isn't held in the producer's memory.
    await producer.stop();
    clients.splice(clients.indexOf(producer), 1);

    const received: number[] = [];
    const startedAt = Date.now();
    const consumer = client();
    void consumer.consume<{ n: number }>("q", async (msg) => {
      received.push(Date.now() - startedAt);
      expect(msg.body.n).toBe(1);
    });
    await waitFor(() => received.length === 1);
    expect(received[0]).toBeGreaterThanOrEqual(250);
  });

  it("keeps a retry in Redis while it backs off, then redelivers it", async () => {
    prefix = `test:${randomUUID()}:`;
    const c = client();
    await c.enqueue("q", { n: 1 });
    const attempts: number[] = [];
    void c.consume("q", async (msg: QueueMessage) => {
      attempts.push(msg.attempt ?? 1);
      if (attempts.length === 1) throw new Error("transient");
    });
    await waitFor(() => attempts.length >= 1);
    await waitFor(async () => (await c.delayedCount("q")) === 1 || attempts.length === 2);
    await waitFor(() => attempts.length === 2);
    expect(attempts).toEqual([1, 2]);
  });

  it("dead-letters a message after five failed attempts", async () => {
    prefix = `test:${randomUUID()}:`;
    const c = client();
    await c.enqueue("q", { n: 1 });
    let attempts = 0;
    void c.consume("q", async () => {
      attempts++;
      throw new Error("permanent");
    });
    await waitFor(async () => (await c.deadLetterCount("q")) === 1, 8_000);
    expect(attempts).toBe(5);
  });

  it("requeues a crashed worker's in-flight message once its heartbeat expires", async () => {
    prefix = `test:${randomUUID()}:`;
    const crashed = client();
    await crashed.enqueue("q", { n: 1 });
    let started = false;
    void crashed.consume("q", async () => {
      started = true;
      await new Promise(() => undefined); // never finishes — the worker "dies" mid-job
    });
    await waitFor(() => started);
    // Simulate the process dying: timers stop, heartbeat is never renewed.
    await crashed.stop(0);
    clients.splice(clients.indexOf(crashed), 1);

    const survivor = client();
    const delivered: QueueMessage[] = [];
    void survivor.consume("q", async (msg: QueueMessage) => {
      delivered.push(msg);
    });
    await waitFor(() => delivered.length === 1);
    expect(delivered[0]!.attempt).toBe(2);
  });

  it("drains in-flight work on stop() and leaves nothing to reap", async () => {
    prefix = `test:${randomUUID()}:`;
    const c = client();
    await c.enqueue("q", { n: 1 });
    let finished = false;
    void c.consume("q", async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      finished = true;
    });
    await waitFor(async () => (await raw!.llen(`${prefix}queue:q`)) === 0);
    await c.stop(2_000);
    clients.splice(clients.indexOf(c), 1);
    expect(finished).toBe(true);
    const leftovers = await raw!.keys(`${prefix}queue:q:processing:*`);
    expect(leftovers).toEqual([]);
  });
});
