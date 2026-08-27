"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Workflow {
  id: string;
  name: string;
  triggerType: string;
  enabled: boolean;
  version: number;
}

const TRIGGERS = [
  "NEW_LEAD",
  "CONVERSATION_ENDED",
  "CONVERSATION_ABANDONED",
  "TOOL_FAILURE",
  "CRM_FIELD_CHANGE",
  "FORM_SUBMITTED",
  "SENTIMENT_THRESHOLD_CROSSED",
  "NO_REPLY_TIMEOUT",
  "HANDOFF_REQUESTED",
];
const ACTION_TYPES = ["SEND_NOTIFICATION", "CALL_WEBHOOK", "SCORE_LEAD", "WAIT", "SEND_EMAIL", "CREATE_CRM_RECORD", "CREATE_TICKET", "TRIGGER_TOOL"];
// These need infrastructure this form doesn't collect yet — SEND_EMAIL and
// CREATE_CRM_RECORD both call out to a tenant-owned endpoint (their own
// transactional-email API, their own CRM's API), not something the
// platform can send on their behalf (customer-facing mail should come
// from the tenant's own identity, not ours). CREATE_TICKET/TRIGGER_TOOL
// are documented as unsupported at the executor level. Shown, not
// hidden, so a tenant knows the option exists and what it needs — just
// disabled until that setup exists.
const ACTIONS_NEEDING_SETUP = new Set(["SEND_EMAIL", "CREATE_CRM_RECORD", "CREATE_TICKET", "TRIGGER_TOOL"]);

export default function WorkflowsPage() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState(TRIGGERS[0]);
  const [actionType, setActionType] = useState(ACTION_TYPES[0]!);
  const [notifyTarget, setNotifyTarget] = useState<"tenant_owner" | "tenant_admin" | "staff_fallback">("tenant_owner");
  const [notifyChannel, setNotifyChannel] = useState<"email" | "dashboard">("email");
  const [busyWorkflowId, setBusyWorkflowId] = useState<string | null>(null);

  // Per-action config — only the fields relevant to the selected action
  // type get sent (see buildActionConfig below).
  const [notificationTarget, setNotificationTarget] = useState<"tenant_owner" | "tenant_admin" | "staff_fallback">("tenant_owner");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [scoreField, setScoreField] = useState("");
  const [scoreWeight, setScoreWeight] = useState("10");
  const [waitSeconds, setWaitSeconds] = useState("3600");

  function refresh() {
    if (!user) return;
    api
      .listWorkflows(user.tenantId)
      .then((d) => setWorkflows(d as Workflow[]))
      .catch((err) => {
        setWorkflows([]);
        setError(err instanceof ApiError ? err.message : "Could not load workflows.");
      });
  }
  useEffect(refresh, [user]);

  function resetForm() {
    setName("");
    setTriggerType(TRIGGERS[0]);
    setActionType(ACTION_TYPES[0]!);
    setNotifyTarget("tenant_owner");
    setNotifyChannel("email");
    setNotificationTarget("tenant_owner");
    setNotificationMessage("");
    setWebhookUrl("");
    setScoreField("");
    setScoreWeight("10");
    setWaitSeconds("3600");
    setError(null);
  }

  function buildActionConfig(): Record<string, unknown> {
    switch (actionType) {
      case "SEND_NOTIFICATION":
        return { target: notificationTarget, message: notificationMessage || undefined };
      case "CALL_WEBHOOK":
        return { url: webhookUrl };
      case "SCORE_LEAD":
        return scoreField ? { fieldWeights: { [scoreField]: Number(scoreWeight) || 0 } } : {};
      case "WAIT":
        return { seconds: Number(waitSeconds) || 0 };
      default:
        return {};
    }
  }

  async function createWorkflow(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await api.createWorkflow(user.tenantId, {
        name,
        triggerType,
        actions: [
          {
            id: "step-1",
            type: actionType,
            config: buildActionConfig(),
            retry: { maxAttempts: 3, backoffSeconds: 60 },
            onFailureNotify: { target: notifyTarget, channel: notifyChannel },
          },
        ],
      });
      setModalOpen(false);
      resetForm();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create workflow.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(w: Workflow) {
    if (!user) return;
    setBusyWorkflowId(w.id);
    setError(null);
    try {
      await api.updateWorkflow(user.tenantId, w.id, { enabled: !w.enabled });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this workflow.");
    } finally {
      setBusyWorkflowId(null);
    }
  }

  async function removeWorkflow(workflowId: string) {
    if (!user) return;
    setBusyWorkflowId(workflowId);
    setError(null);
    try {
      await api.deleteWorkflow(user.tenantId, workflowId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove this workflow.");
    } finally {
      setBusyWorkflowId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Workflows</h1>
          <p className="mt-1 text-sm text-foreground/50">Trigger → condition → action → notification automations that run alongside your agents.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New workflow</Button>
      </div>
      {error && !modalOpen ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Active workflows" subtitle={workflows ? `${workflows.length} configured` : undefined} />
        {workflows === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {workflows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                <p className="text-sm text-foreground/50">No workflows yet. Automate a follow-up, escalation, or notification.</p>
                <button onClick={() => setModalOpen(true)} className="text-xs font-medium text-brand-300 hover:underline">
                  Create your first workflow →
                </button>
              </div>
            ) : (
              workflows.map((w) => (
                <div key={w.id} className={`flex items-center justify-between px-5 py-3.5 text-sm ${w.enabled ? "" : "opacity-50"}`}>
                  <div>
                    <div className="text-foreground">{w.name}</div>
                    <div className="text-xs text-foreground/40">v{w.version}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{w.triggerType.replace(/_/g, " ")}</Badge>
                    <Badge tone={w.enabled ? "success" : "neutral"}>{w.enabled ? "enabled" : "disabled"}</Badge>
                    <button
                      onClick={() => toggleEnabled(w)}
                      disabled={busyWorkflowId === w.id}
                      className="text-xs font-medium text-foreground/40 transition-colors hover:text-foreground/70 disabled:opacity-50"
                    >
                      {w.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => removeWorkflow(w.id)}
                      disabled={busyWorkflowId === w.id}
                      className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New workflow" subtitle="Trigger → action → notification, versioned like your agent config.">
        <form onSubmit={createWorkflow} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Notify sales on hot lead"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Trigger</label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t} className="bg-surface-overlay">
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Then, action</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            >
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t} className="bg-surface-overlay">
                  {t.replace(/_/g, " ")}
                  {ACTIONS_NEEDING_SETUP.has(t) ? " (needs setup)" : ""}
                </option>
              ))}
            </select>
          </div>

          {ACTIONS_NEEDING_SETUP.has(actionType) ? (
            <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2.5 text-xs text-warning">
              {actionType === "SEND_EMAIL" || actionType === "CREATE_CRM_RECORD"
                ? "This action sends from your own systems (your email service, your CRM), not ours — it isn't configurable from this form yet. Contact us to get it wired up."
                : "This action isn't supported yet — use Trigger Tool with a configured tool instead."}
            </p>
          ) : null}

          {actionType === "SEND_NOTIFICATION" ? (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Notify</label>
                <select
                  value={notificationTarget}
                  onChange={(e) => setNotificationTarget(e.target.value as typeof notificationTarget)}
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
                >
                  <option value="tenant_owner" className="bg-surface-overlay">Tenant owner</option>
                  <option value="tenant_admin" className="bg-surface-overlay">Tenant admin</option>
                  <option value="staff_fallback" className="bg-surface-overlay">Staff fallback</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Message (optional)</label>
                <textarea
                  rows={2}
                  value={notificationMessage}
                  onChange={(e) => setNotificationMessage(e.target.value)}
                  placeholder="Defaults to a summary of the trigger if left blank"
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
                />
              </div>
            </>
          ) : null}

          {actionType === "CALL_WEBHOOK" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Webhook URL</label>
              <input
                required
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.example.com/..."
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
              />
            </div>
          ) : null}

          {actionType === "SCORE_LEAD" ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Trigger field to weight</label>
                <input
                  value={scoreField}
                  onChange={(e) => setScoreField(e.target.value)}
                  placeholder="e.g. statedInfo"
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Weight</label>
                <input
                  type="number"
                  value={scoreWeight}
                  onChange={(e) => setScoreWeight(e.target.value)}
                  className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
                />
              </div>
            </div>
          ) : null}

          {actionType === "WAIT" ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Wait (seconds)</label>
              <input
                type="number"
                value={waitSeconds}
                onChange={(e) => setWaitSeconds(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">If this action fails, notify</label>
              <select
                value={notifyTarget}
                onChange={(e) => setNotifyTarget(e.target.value as typeof notifyTarget)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
              >
                <option value="tenant_owner" className="bg-surface-overlay">Tenant owner</option>
                <option value="tenant_admin" className="bg-surface-overlay">Tenant admin</option>
                <option value="staff_fallback" className="bg-surface-overlay">Staff fallback</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Via</label>
              <select
                value={notifyChannel}
                onChange={(e) => setNotifyChannel(e.target.value as typeof notifyChannel)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
              >
                <option value="email" className="bg-surface-overlay">Email</option>
                <option value="dashboard" className="bg-surface-overlay">Audit log only</option>
              </select>
            </div>
          </div>
          <p className="text-[11px] text-foreground/35">A failed step is always logged and never fails silently — this is who gets notified, and how.</p>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || ACTIONS_NEEDING_SETUP.has(actionType)}>
              {saving ? "Creating..." : "Create workflow"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
