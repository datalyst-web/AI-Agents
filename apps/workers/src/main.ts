import "./instrument.js";
import * as Sentry from "@sentry/node";
import { QUEUE_NAMES } from "@chat-agent/queue";
import type { KnowledgeIngestJob, WorkflowRunJob } from "@chat-agent/shared-types";
import { buildWorkerContext } from "./context.js";
import { runKnowledgeIngestJob } from "./jobs/knowledgeIngest.js";
import { runWorkflowJob } from "./jobs/workflowRun.js";
import { runRetentionSweep } from "./jobs/retentionSweep.js";
import { runConversationTimeoutSweep } from "./jobs/conversationTimeoutSweep.js";
import { runEscalationNotificationSweep } from "./jobs/escalationNotificationSweep.js";
import { runOverageBillingSweep } from "./jobs/overageBillingSweep.js";
import { runTrialExpirySweep } from "./jobs/trialExpirySweep.js";
import { withDistributedLock } from "./lib/lock.js";
import { env } from "./env.js";

const RETENTION_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h — production should instead trigger this via EventBridge Scheduler; the interval here is a self-contained fallback so retention still runs with zero extra infra.
const CONVERSATION_TIMEOUT_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5m — CONVERSATION_ABANDONED needs to fire close to its 30m threshold, not hours late.
const ESCALATION_NOTIFICATION_SWEEP_INTERVAL_MS = 2 * 60 * 1000; // 2m — a human should hear about a live handoff quickly, not on the same cadence as the 5m/6h sweeps above.
const TRIAL_EXPIRY_SWEEP_INTERVAL_MS = 60 * 60 * 1000; // 1h — a trial ending a few minutes late is fine; a day late is a free month.
const OVERAGE_BILLING_SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h — only ever bills a closed month, so running twice a day is plenty and self-heals if the worker was down at the month boundary.

/**
 * Async job runner for the `chat` product — knowledge ingestion and
 * workflow execution, per ARCHITECTURE.md's suggested build order steps
 * 5-6. Runs as its own ECS service (`chat-workers`) in the shared
 * `agents-platform` cluster, consuming from the shared SQS setup (or the
 * Redis-backed dev queue when no SQS URL is configured).
 */
async function main() {
  const ctx = buildWorkerContext();

  const knowledgeQueueTarget = env.SQS_KNOWLEDGE_INGEST_QUEUE_URL ?? QUEUE_NAMES.knowledgeIngest;
  const workflowQueueTarget = env.SQS_WORKFLOW_RUN_QUEUE_URL ?? QUEUE_NAMES.workflowRun;

  console.log(`[workers] starting, concurrency=${env.WORKERS_CONCURRENCY}`);

  // Locked so scaling chat-workers to N replicas (Terraform default: 2)
  // doesn't independently re-run the same sweep N times per interval —
  // see lib/lock.ts.
  setInterval(() => {
    void withDistributedLock(ctx.redis, "chat:lock:retention-sweep", RETENTION_SWEEP_INTERVAL_MS - 60_000, () =>
      runRetentionSweep(ctx),
    ).catch((err) => {
      console.error("[workers] retention sweep failed", err);
      Sentry.captureException(err);
    });
  }, RETENTION_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void withDistributedLock(
      ctx.redis,
      "chat:lock:conversation-timeout-sweep",
      CONVERSATION_TIMEOUT_SWEEP_INTERVAL_MS - 10_000,
      () => runConversationTimeoutSweep(ctx),
    ).catch((err) => {
      console.error("[workers] conversation timeout sweep failed", err);
      Sentry.captureException(err);
    });
  }, CONVERSATION_TIMEOUT_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void withDistributedLock(
      ctx.redis,
      "chat:lock:escalation-notification-sweep",
      ESCALATION_NOTIFICATION_SWEEP_INTERVAL_MS - 10_000,
      () => runEscalationNotificationSweep(ctx),
    ).catch((err) => {
      console.error("[workers] escalation notification sweep failed", err);
      Sentry.captureException(err);
    });
  }, ESCALATION_NOTIFICATION_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void withDistributedLock(ctx.redis, "chat:lock:trial-expiry-sweep", TRIAL_EXPIRY_SWEEP_INTERVAL_MS - 10_000, () =>
      runTrialExpirySweep(ctx),
    ).catch((err) => {
      console.error("[workers] trial expiry sweep failed", err);
      Sentry.captureException(err);
    });
  }, TRIAL_EXPIRY_SWEEP_INTERVAL_MS);

  setInterval(() => {
    void withDistributedLock(
      ctx.redis,
      "chat:lock:overage-billing-sweep",
      OVERAGE_BILLING_SWEEP_INTERVAL_MS - 10_000,
      () => runOverageBillingSweep(ctx),
    ).catch((err) => {
      console.error("[workers] overage billing sweep failed", err);
      Sentry.captureException(err);
    });
  }, OVERAGE_BILLING_SWEEP_INTERVAL_MS);

  await Promise.all([
    ctx.queue.consume<KnowledgeIngestJob>(knowledgeQueueTarget, async (msg) => {
      console.log(`[workers] knowledge-ingest job ${msg.id} for source ${msg.body.knowledgeSourceId}`);
      try {
        await runKnowledgeIngestJob(ctx, msg.body);
      } catch (err) {
        // Re-thrown, not swallowed — packages/queue's own retry/dead-letter
        // logic (see redis.ts/sqs.ts) still needs to see this failure;
        // Sentry just gets an extra copy of it.
        Sentry.captureException(err);
        throw err;
      }
    }),
    ctx.queue.consume<WorkflowRunJob>(workflowQueueTarget, async (msg) => {
      console.log(`[workers] workflow-run job ${msg.id} for workflow ${msg.body.workflowId}`);
      try {
        await runWorkflowJob(ctx, msg.body);
      } catch (err) {
        Sentry.captureException(err);
        throw err;
      }
    }),
  ]);
}

main().catch(async (err) => {
  console.error("[workers] fatal error", err);
  Sentry.captureException(err);
  // process.exit() would otherwise cut off Sentry's async transport
  // mid-send — this is the one crash a Railway restart-loop could hide
  // if it never actually reached Sentry.
  await Sentry.flush(2000).catch(() => undefined);
  process.exit(1);
});
