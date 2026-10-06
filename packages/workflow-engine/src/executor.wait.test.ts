import { describe, expect, it } from "vitest";
import type { WorkflowAction } from "@chat-agent/shared-types";
import { WorkflowExecutor, type NotifyFn } from "./executor.js";
import type { ActionExecutorMap } from "./actions.js";

/** Just the workflowRun calls the executor makes, kept in memory. */
function fakeTx() {
  const runs = new Map<string, { id: string; tenantId: string; status: string; actionLog: unknown }>();
  const tx = {
    workflowRun: {
      create: async ({ data }: { data: { id: string; tenantId: string; status: string; actionLog: unknown } }) => {
        runs.set(data.id, { ...data });
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(runs.get(where.id)!, data);
      },
      findFirst: async ({ where }: { where: { id: string; tenantId: string } }) => {
        const run = runs.get(where.id);
        return run && run.tenantId === where.tenantId ? run : null;
      },
    },
  };
  return { tx: tx as never, runs };
}

function action(id: string, type: WorkflowAction["type"], config: Record<string, unknown>, nextOnSuccess?: string): WorkflowAction {
  return {
    id,
    type,
    config,
    retry: { maxAttempts: 1, backoffSeconds: 0 },
    onFailureNotify: { target: "tenant_owner", channel: "dashboard" },
    nextOnSuccess,
  };
}

const TENANT = "00000000-0000-0000-0000-000000000001";
const notify: NotifyFn = async () => undefined;

describe("WorkflowExecutor WAIT", () => {
  const actions = [
    action("score", "SCORE_LEAD", {}, "wait"),
    action("wait", "WAIT", { seconds: 3600 }, "email"),
    action("email", "SEND_EMAIL", {}),
  ];

  it("pauses at a WAIT instead of running the next action straight away, then resumes after it", async () => {
    const { tx, runs } = fakeTx();
    const ran: string[] = [];
    const executors: ActionExecutorMap = {
      SCORE_LEAD: async (a) => (ran.push(a.id), { succeeded: true }),
      SEND_EMAIL: async (a) => (ran.push(a.id), { succeeded: true }),
    };
    const executor = new WorkflowExecutor(tx, executors, notify);
    const base = { tenantId: TENANT, workflowId: "wf", triggerType: "NEW_LEAD", actions, triggerPayload: {} };

    const first = await executor.run(base);
    expect(ran).toEqual(["score"]);
    expect(first.status).toBe("RUNNING");
    expect(first.wait).toEqual({ seconds: 3600, resume: { runId: first.runId, actionId: "email" } });
    expect(runs.get(first.runId)!.status).toBe("RUNNING");

    const second = await executor.run({ ...base, resume: first.wait!.resume });
    expect(ran).toEqual(["score", "email"]);
    expect(second).toEqual({ runId: first.runId, status: "SUCCEEDED" });
    const log = runs.get(first.runId)!.actionLog as { actionId: string }[];
    expect(log.map((entry) => entry.actionId)).toEqual(["score", "wait", "email"]);
  });

  it("never re-runs actions when a resume is delivered twice", async () => {
    const { tx } = fakeTx();
    const ran: string[] = [];
    const executors: ActionExecutorMap = {
      SCORE_LEAD: async () => ({ succeeded: true }),
      SEND_EMAIL: async (a) => (ran.push(a.id), { succeeded: true }),
    };
    const executor = new WorkflowExecutor(tx, executors, notify);
    const base = { tenantId: TENANT, workflowId: "wf", triggerType: "NEW_LEAD", actions, triggerPayload: {} };
    const first = await executor.run(base);
    await executor.run({ ...base, resume: first.wait!.resume });
    await executor.run({ ...base, resume: first.wait!.resume });
    expect(ran).toEqual(["email"]);
  });

  it("keeps a failure from before the wait in the run's final status", async () => {
    const { tx } = fakeTx();
    const failThenWait = [
      { ...action("score", "SCORE_LEAD", {}), nextOnFailure: "wait" },
      action("wait", "WAIT", { seconds: 60 }, "email"),
      action("email", "SEND_EMAIL", {}),
    ];
    const executors: ActionExecutorMap = {
      SCORE_LEAD: async () => ({ succeeded: false, errorMessage: "no lead" }),
      SEND_EMAIL: async () => ({ succeeded: true }),
    };
    const executor = new WorkflowExecutor(tx, executors, notify);
    const base = { tenantId: TENANT, workflowId: "wf", triggerType: "NEW_LEAD", actions: failThenWait, triggerPayload: {} };
    const first = await executor.run(base);
    const second = await executor.run({ ...base, resume: first.wait!.resume });
    expect(second.status).toBe("FAILED_NOTIFIED");
  });

  it("treats a WAIT with no following action as the end of the run", async () => {
    const { tx } = fakeTx();
    const executor = new WorkflowExecutor(tx, {}, notify);
    const result = await executor.run({
      tenantId: TENANT,
      workflowId: "wf",
      triggerType: "NEW_LEAD",
      actions: [action("wait", "WAIT", { seconds: 60 })],
      triggerPayload: {},
    });
    expect(result).toMatchObject({ status: "SUCCEEDED" });
    expect(result.wait).toBeUndefined();
  });
});
