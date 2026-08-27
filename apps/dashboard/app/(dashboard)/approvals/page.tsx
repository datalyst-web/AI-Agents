"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Button, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Approval {
  id: string;
  agentId: string;
  conversationId: string;
  toolName: string;
  input: unknown;
  requestedAt: string;
}

export default function ApprovalsPage() {
  const { user } = useAuth();
  const [approvals, setApprovals] = useState<Approval[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listApprovals(user.tenantId)
      .then(setApprovals)
      .catch((err) => {
        setApprovals([]);
        setError(err instanceof ApiError ? err.message : "Could not load approvals.");
      });
  }
  useEffect(refresh, [user]);

  async function approve(id: string) {
    if (!user) return;
    setError(null);
    setBusyId(id);
    try {
      await api.approveApproval(user.tenantId, id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve this request.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    if (!user) return;
    setError(null);
    setBusyId(id);
    try {
      await api.rejectApproval(user.tenantId, id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reject this request.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Approvals</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Actions your agents flagged as high-risk — configured to require your team's sign-off before they run. Nothing here executes until you approve it.
        </p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Pending" subtitle={approvals ? `${approvals.length} waiting on you` : undefined} />
        {approvals === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {approvals.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 ring-1 ring-inset ring-success/25">
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5l3 3 7-7" stroke="#2fbf71" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <p className="text-sm text-foreground/50">Nothing waiting for approval right now.</p>
              </div>
            ) : (
              approvals.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-4 px-5 py-4 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{a.toolName.replace(/_/g, " ")}</div>
                    <div className="mt-1 max-w-xl truncate text-xs text-foreground/40">{JSON.stringify(a.input)}</div>
                    <div className="mt-1 text-[11px] text-foreground/30">Requested {new Date(a.requestedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="secondary" className="!bg-danger/15 !text-danger hover:!bg-danger/25" disabled={busyId === a.id} onClick={() => reject(a.id)}>
                      Reject
                    </Button>
                    <Button disabled={busyId === a.id} onClick={() => approve(a.id)}>
                      {busyId === a.id ? "Working…" : "Approve"}
                    </Button>
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
