"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Incident {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  startedAt: string;
  resolvedAt: string | null;
}

const SEVERITY_TONE: Record<string, "neutral" | "warning" | "danger"> = { MINOR: "neutral", MAJOR: "warning", CRITICAL: "danger" };
const STATUS_TONE: Record<string, "warning" | "info" | "success"> = { OPEN: "warning", MONITORING: "info", RESOLVED: "success" };
const STATUS_OPTIONS = ["OPEN", "MONITORING", "RESOLVED"] as const;

/** Platform-level incident log — an AI provider outage or infra issue, logged by hand by whichever staff member is handling it. */
export default function IncidentsPage() {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<"MINOR" | "MAJOR" | "CRITICAL">("MINOR");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listIncidents()
      .then(setIncidents)
      .catch((err) => {
        setIncidents([]);
        setError(err instanceof ApiError ? err.message : "Could not load the incident log.");
      });
  }
  useEffect(refresh, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.createIncident({ title, description, severity });
      setModalOpen(false);
      setTitle("");
      setDescription("");
      setSeverity("MINOR");
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not log this incident.");
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(id: string, status: (typeof STATUS_OPTIONS)[number]) {
    setBusyId(id);
    setError(null);
    try {
      await api.updateIncidentStatus(id, status);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update that incident.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Incident Log</h1>
          <p className="mt-1 text-sm text-foreground/50">Platform-wide incidents — provider outages, infra issues — not tied to any one client.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ Log incident</Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Incidents" subtitle={incidents ? `${incidents.length} logged` : undefined} />
        {incidents === null ? (
          <CardRowSkeleton rows={3} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {incidents.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No incidents logged.</p>
            ) : (
              incidents.map((inc) => (
                <div key={inc.id} className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">{inc.title}</span>
                      <Badge tone={SEVERITY_TONE[inc.severity] ?? "neutral"}>{inc.severity.toLowerCase()}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-foreground/50">{inc.description}</p>
                    <div className="mt-1 text-[11px] text-foreground/35">{new Date(inc.startedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <select
                      value={inc.status}
                      disabled={busyId === inc.id}
                      onChange={(e) => setStatus(inc.id, e.target.value as (typeof STATUS_OPTIONS)[number])}
                      className="rounded-lg border border-foreground/10 bg-foreground/5 px-2 py-1 text-xs text-foreground outline-none focus:border-brand-400"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s} className="bg-surface-overlay text-foreground">
                          {s.toLowerCase()}
                        </option>
                      ))}
                    </select>
                    <Badge tone={STATUS_TONE[inc.status] ?? "neutral"}>{inc.status.toLowerCase()}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Log a new incident">
        <form onSubmit={submit} className="space-y-3">
          {formError ? <p className="text-xs text-danger">{formError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Title</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Description</label>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            >
              <option value="MINOR" className="bg-surface-overlay text-foreground">Minor</option>
              <option value="MAJOR" className="bg-surface-overlay text-foreground">Major</option>
              <option value="CRITICAL" className="bg-surface-overlay text-foreground">Critical</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Logging…" : "Log incident"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
