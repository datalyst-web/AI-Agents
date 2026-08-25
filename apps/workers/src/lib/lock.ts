import type { Redis } from "ioredis";

/**
 * A simple Redis SET-NX-PX lock so a periodic sweep (retention,
 * conversation-timeout) runs at most once per interval across however many
 * `chat-workers` replicas are running — the Terraform default is 2 (see
 * infra/terraform/ecs_workers.tf), so without this every replica's
 * `setInterval` would independently re-run the same sweep and, e.g., send
 * a tenant's abandoned-conversation follow-up email twice. Not a
 * correctness guarantee under clock skew/lock expiry races the way a
 * proper leader-election or SQS-scheduled-job setup would be — sufficient
 * for "don't double-send at 2 replicas," not a general distributed-systems
 * primitive.
 */
export async function withDistributedLock(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<void> {
  const acquired = await redis.set(key, "1", "PX", ttlMs, "NX");
  if (acquired !== "OK") return; // another replica already holds this window's lock
  try {
    await fn();
  } finally {
    // Deliberately not released early — held for the full ttlMs so a
    // second replica's timer firing moments later still can't double-run
    // within the same logical window.
  }
}
