"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge, Button, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Lead {
  id: string;
  startedAt: string;
  channel: string;
  outcome: string;
  businessResult: string;
  agent: { name: string };
}

/**
 * Every conversation that produced a business result (lead qualified,
 * sale, ticket created, ...) across every agent, in one place — the
 * per-agent Conversations tab can only show one agent at a time.
 * businessResult itself has no raw contact info to export (CustomerIdentity
 * stores only a hashed identifier by design) — this exports what's
 * actually structured data, not a substitute for reading the conversation
 * transcript for whatever contact details a customer typed.
 */
export default function LeadsPage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .listLeads(user.tenantId)
      .then((d) => setLeads(d as Lead[]))
      .catch((err) => {
        setLeads([]);
        setError(err instanceof ApiError ? err.message : "Could not load leads.");
      });
  }, [user]);

  function exportCsv() {
    if (!leads || leads.length === 0) return;
    const header = ["Date", "Agent", "Channel", "Outcome", "Result", "Conversation ID"];
    const rows = leads.map((l) => [
      new Date(l.startedAt).toISOString(),
      l.agent.name,
      l.channel,
      l.outcome,
      l.businessResult,
      l.id,
    ]);
    // Quote every field and escape embedded quotes — agent/tenant names are
    // free text and can contain commas, so a naive join(",") would silently
    // corrupt the CSV's column alignment.
    const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-foreground/50">
            Every conversation that produced a business result, across all your agents.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={!leads || leads.length === 0}>
          Export CSV
        </Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Results" subtitle={leads ? `${leads.length} conversation${leads.length === 1 ? "" : "s"}` : undefined} />
        {leads === null ? (
          <CardRowSkeleton rows={5} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {leads.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">
                No leads yet — this fills in as your agents&apos; conversations produce a tracked business result.
              </p>
            ) : (
              leads.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground/70">{new Date(l.startedAt).toLocaleString()}</span>
                    <Badge tone="neutral">{l.agent.name}</Badge>
                    <Badge tone="neutral">{l.channel.replace(/_/g, " ").toLowerCase()}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone="brand">{l.businessResult.replace(/_/g, " ").toLowerCase()}</Badge>
                    <span className="text-xs text-foreground/40">{l.outcome.replace(/_/g, " ").toLowerCase()}</span>
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
