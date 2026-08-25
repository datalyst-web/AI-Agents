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
const ACTION_TYPES = ["CREATE_CRM_RECORD", "SEND_EMAIL", "SEND_NOTIFICATION", "CALL_WEBHOOK", "CREATE_TICKET", "SCORE_LEAD", "WAIT", "TRIGGER_TOOL"];

export default function WorkflowsPage() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState(TRIGGERS[0]);
  const [actionType, setActionType] = useState(ACTION_TYPES[1]);
  const [notifyTarget, setNotifyTarget] = useState<"tenant_owner" | "tenant_admin" | "staff_fallback">("tenant_owner");

  function refresh() {
    if (user) api.listWorkflows(user.tenantId).then((d) => setWorkflows(d as Workflow[]));
  }
  useEffect(refresh, [user]);

  function resetForm() {
    setName("");
    setTriggerType(TRIGGERS[0]);
    setActionType(ACTION_TYPES[1]);
    setNotifyTarget("tenant_owner");
    setError(null);
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
            config: {},
            retry: { maxAttempts: 3, backoffSeconds: 60 },
            onFailureNotify: { target: notifyTarget, channel: "dashboard" },
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Workflows</h1>
          <p className="mt-1 text-sm text-white/50">Trigger → condition → action → notification automations that run alongside your agents.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New workflow</Button>
      </div>

      <Card>
        <CardHeader title="Active workflows" subtitle={workflows ? `${workflows.length} configured` : undefined} />
        {workflows === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {workflows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                <p className="text-sm text-white/50">No workflows yet. Automate a follow-up, escalation, or notification.</p>
                <button onClick={() => setModalOpen(true)} className="text-xs font-medium text-brand-300 hover:underline">
                  Create your first workflow →
                </button>
              </div>
            ) : (
              workflows.map((w) => (
                <div key={w.id} className="flex items-center justify-between px-5 py-3.5 text-sm">
                  <div>
                    <div className="text-white">{w.name}</div>
                    <div className="text-xs text-white/40">v{w.version}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="brand">{w.triggerType.replace(/_/g, " ")}</Badge>
                    <Badge tone={w.enabled ? "success" : "neutral"}>{w.enabled ? "enabled" : "disabled"}</Badge>
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
            <label className="mb-1 block text-xs font-medium text-white/60">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Notify sales on hot lead"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60">Trigger</label>
            <select
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-400"
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t} className="bg-surface-overlay">
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60">Then, action</label>
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-400"
            >
              {ACTION_TYPES.map((t) => (
                <option key={t} value={t} className="bg-surface-overlay">
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/60">If this action fails, notify</label>
            <select
              value={notifyTarget}
              onChange={(e) => setNotifyTarget(e.target.value as typeof notifyTarget)}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-400"
            >
              <option value="tenant_owner" className="bg-surface-overlay">
                Tenant owner
              </option>
              <option value="tenant_admin" className="bg-surface-overlay">
                Tenant admin
              </option>
              <option value="staff_fallback" className="bg-surface-overlay">
                Staff fallback
              </option>
            </select>
            <p className="mt-1 text-[11px] text-white/35">A failed step is always logged and never fails silently — this is who gets notified.</p>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating..." : "Create workflow"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
