"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge, Button, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Flag {
  id: string;
  tenantId: string;
  tenant: { name: string };
  matchedPhrase: string;
  content: string;
  flaggedAt: string;
  reviewed: boolean;
  reviewedAt: string | null;
}

/**
 * Everything agentLoop.ts's heuristic prompt-injection phrase match has
 * flagged, across every tenant, for staff triage — never an automatic
 * block on the conversation itself, just a signal for a human to look at.
 */
export default function SecurityFlagsPage() {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [showReviewed, setShowReviewed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listSecurityFlags(showReviewed ? undefined : false)
      .then(setFlags)
      .catch((err) => {
        setFlags([]);
        setError(err instanceof ApiError ? err.message : "Could not load security flags.");
      });
  }
  useEffect(refresh, [user, showReviewed]);

  async function markReviewed(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.markSecurityFlagReviewed(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this reviewed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Security Flags</h1>
          <p className="mt-1 text-sm text-foreground/50">
            Messages our heuristic check flagged as possible prompt-injection / jailbreak attempts, across every tenant. Detection aid only — never an automatic block.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setShowReviewed((v) => !v)}>
          {showReviewed ? "Show unreviewed only" : "Show all"}
        </Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Flagged messages" subtitle={flags ? `${flags.length} flag${flags.length === 1 ? "" : "s"}` : undefined} />
        {flags === null ? (
          <CardRowSkeleton rows={4} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {flags.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">
                {showReviewed ? "No security flags yet." : "No unreviewed flags — nice and quiet."}
              </p>
            ) : (
              flags.map((f) => (
                <div key={f.id} className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <Badge tone="neutral">{f.tenant.name}</Badge>
                      <Badge tone="danger">matched: &ldquo;{f.matchedPhrase}&rdquo;</Badge>
                    </div>
                    <p className="mt-1 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-xs text-foreground/70">{f.content}</p>
                    <div className="mt-1 text-[11px] text-foreground/35">{new Date(f.flaggedAt).toLocaleString()}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {f.reviewed ? (
                      <Badge tone="success">Reviewed</Badge>
                    ) : (
                      <Button variant="secondary" onClick={() => markReviewed(f.id)} disabled={busyId === f.id}>
                        {busyId === f.id ? "Marking…" : "Mark reviewed"}
                      </Button>
                    )}
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
