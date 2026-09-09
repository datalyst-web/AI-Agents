"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Ticket {
  id: string;
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

/** A client's own request to the platform team — distinct from the "Ticketing" tool an agent uses on the client's behalf in their own external helpdesk. */
export default function SupportPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"LOW" | "NORMAL" | "HIGH" | "URGENT">("NORMAL");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listSupportTickets(user.tenantId)
      .then(setTickets)
      .catch((err) => {
        setTickets([]);
        setError(err instanceof ApiError ? err.message : "Could not load your support tickets.");
      });
  }
  useEffect(refresh, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setFormError(null);
    try {
      await api.createSupportTicket(user.tenantId, { subject, description, priority });
      setModalOpen(false);
      setSubject("");
      setDescription("");
      setPriority("NORMAL");
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not submit this ticket.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Support</h1>
          <p className="mt-1 text-sm text-foreground/50">Need help from our team? Submit a ticket and we&apos;ll get back to you.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New ticket</Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Your tickets" subtitle={tickets ? `${tickets.length} ticket${tickets.length === 1 ? "" : "s"}` : undefined} />
        {tickets === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {tickets.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No support tickets yet.</p>
            ) : (
              tickets.map((t) => (
                <div key={t.id} className="flex flex-wrap items-start justify-between gap-y-2 px-5 py-3.5 text-sm">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="text-foreground">{t.subject}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-foreground/50">{t.description}</p>
                    <div className="mt-1 text-[11px] text-foreground/35">{new Date(t.createdAt).toLocaleString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={PRIORITY_TONE[t.priority] ?? "neutral"}>{t.priority.toLowerCase()}</Badge>
                    <Badge tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status.replace(/_/g, " ").toLowerCase()}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New support ticket" subtitle="Tell us what's going on — our team will follow up by email.">
        <form onSubmit={submit} className="space-y-3">
          {formError ? <p className="text-xs text-danger">{formError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Subject</label>
            <input
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Description</label>
            <textarea
              required
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            >
              <option value="LOW" className="bg-surface-overlay text-foreground">Low</option>
              <option value="NORMAL" className="bg-surface-overlay text-foreground">Normal</option>
              <option value="HIGH" className="bg-surface-overlay text-foreground">High</option>
              <option value="URGENT" className="bg-surface-overlay text-foreground">Urgent</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Submitting…" : "Submit ticket"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
