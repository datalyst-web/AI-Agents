"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface AuditEntry {
  id: string;
  action: string;
  actorIsStaff: boolean;
  contentSource?: string;
  timestamp: string;
}

export default function AuditLogPage() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .getAuditLog(user.tenantId)
      .then((d) => setEntries(d as AuditEntry[]))
      .catch((err) => {
        setEntries([]);
        setError(err instanceof ApiError ? err.message : "Could not load the audit log.");
      });
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Audit Log</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Every change to your agents and knowledge base — including everything our Setup Team does on your behalf under a Managed Setup plan.
        </p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <Card>
        <CardHeader title="Recent activity" subtitle={entries ? `${entries.length} entries` : undefined} />
        {entries === null ? (
          <CardRowSkeleton rows={5} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {entries.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground/40">No activity yet.</p>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground">{entry.action.replace(/_/g, " ")}</span>
                    {entry.actorIsStaff ? <Badge tone="brand">AI Setup Team</Badge> : null}
                    {entry.contentSource ? <span className="text-xs text-foreground/30">({entry.contentSource})</span> : null}
                  </div>
                  <span className="text-xs text-foreground/40">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
