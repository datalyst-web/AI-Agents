"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Ticket {
  id: string;
  tenantId: string;
  tenant: { name: string };
  subject: string;
  description: string;
  priority: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

const STATUS_TONE: Record<string, "neutral" | "warning" | "info" | "success"> = {
  OPEN: "warning",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CLOSED: "neutral",
};
const PRIORITY_TONE: Record<string, "neutral" | "warning" | "danger"> = {
  LOW: "neutral",
  NORMAL: "neutral",
  HIGH: "warning",
  URGENT: "danger",
};
const STATUS_OPTIONS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const;

/** Every client's support ticket, across every tenant — the queue our own team triages. */
export default function SupportQueuePage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listAllSupportTickets()
      .then(setTickets)
      .catch((err) => {
        setTickets([]);
        setError(err instanceof ApiError ? err.message : "Could not load the support queue.");
      });
  }
  useEffect(refresh, [user]);

  async function setStatus(id: string, status: (typeof STATUS_OPTIONS)[number]) {
    setBusyId(id);
    setError(null);
    try {
      await api.updateSupportTicketStatus(id, status);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update that ticket.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Support Queue</h1>
        <p className="mt-1 text-sm text-foreground/50">Every support ticket filed by every client, most recent first.</p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Tickets" subtitle={tickets ? `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}` : undefined} />
        {tickets === null ? (
          <CardRowSkeleton rows={5} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {tickets.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No support tickets right now.</p>
            ) : (
              tickets.map((t) => (
                <div key={t.id} className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">{t.subject}</span>
                      <Badge tone="neutral">{t.tenant.name}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-foreground/50">{t.description}</p>
                    <div className="mt-1 text-[11px] text-foreground/35">{new Date(t.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{t.priority.toLowerCase()}</Badge>
                    <select
                      value={t.status}
                      disabled={busyId === t.id}
                      onChange={(e) => setStatus(t.id, e.target.value as (typeof STATUS_OPTIONS)[number])}
                      className="rounded-lg border border-foreground/10 bg-foreground/5 px-2 py-1 text-xs text-foreground outline-none focus:border-brand-400"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s} className="bg-surface-overlay text-foreground">
                          {s.replace(/_/g, " ").toLowerCase()}
                        </option>
                      ))}
                    </select>
                    <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ").toLowerCase()}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
