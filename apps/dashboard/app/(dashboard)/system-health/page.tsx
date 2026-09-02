"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, Badge, Button, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

type ProviderKey = "anthropic" | "openai" | "gemini";
interface ProviderStatus {
  healthy: boolean;
  latencyMs?: number;
  error?: string;
  checkedAt: string;
}

const PROVIDER_LABEL: Record<ProviderKey, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
};
// Client requests always fail over across these in order (CLAUDE.md model
// routing) — shown here so an admin can see at a glance whether the
// *first* one is actually healthy, not just whether the platform as a
// whole is still limping along on its second or third choice.
const FAILOVER_ORDER: ProviderKey[] = ["anthropic", "openai", "gemini"];

export default function SystemHealthPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<Record<ProviderKey, ProviderStatus> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function refresh() {
    if (!user) return;
    setRefreshing(true);
    api
      .getProviderHealth()
      .then((d) => {
        setStatus(d);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "Could not check provider health.");
      })
      .finally(() => setRefreshing(false));
  }

  // Auto-refresh every 30s so this page is useful left open on a second
  // monitor during an incident, not just a one-shot check.
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const allHealthy = status ? FAILOVER_ORDER.every((p) => status[p]?.healthy) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">System Health</h1>
          <p className="mt-1 text-sm text-foreground/50">
            Live status of every AI provider in the failover chain — checks every 30 seconds.
          </p>
        </div>
        <Button variant="secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Checking…" : "Check now"}
        </Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {allHealthy !== null ? (
        <div
          className={`rounded-xl3 px-5 py-3.5 text-sm font-medium ring-1 ring-inset ${
            allHealthy ? "bg-success/10 text-success ring-success/25" : "bg-danger/10 text-danger ring-danger/25"
          }`}
        >
          {allHealthy ? "All providers healthy — no failover in effect." : "One or more providers are unhealthy — traffic may be failing over."}
        </div>
      ) : null}

      <Card>
        <CardHeader title="Providers" subtitle="In failover order — the platform tries each in turn until one succeeds." />
        {status === null ? (
          <CardRowSkeleton rows={3} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {FAILOVER_ORDER.map((provider) => {
              const s = status[provider];
              return (
                <div key={provider} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-4 text-sm">
                  <div>
                    <div className="font-medium text-foreground">{PROVIDER_LABEL[provider]}</div>
                    {s?.error ? <div className="mt-0.5 text-xs text-danger">{s.error}</div> : null}
                  </div>
                  <div className="flex items-center gap-3">
                    {s?.latencyMs !== undefined ? (
                      <span className="text-xs tabular-nums text-foreground/40">{s.latencyMs}ms</span>
                    ) : null}
                    {s ? (
                      <span className="text-xs text-foreground/30">{new Date(s.checkedAt).toLocaleTimeString()}</span>
                    ) : null}
                    <Badge tone={s?.healthy ? "success" : "danger"}>{s?.healthy ? "Healthy" : "Unhealthy"}</Badge>
                  </div>
                </div>
              );
            })}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
