"use client";

import { useEffect, useState } from "react";
import { Card, CardBody, CardHeader, StatTile, CardRowSkeleton, StatTileSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Business {
  totalTenants: number;
  mrr: number;
  churnRate: number;
  byTier: Record<string, number>;
  byState: Record<string, number>;
}
interface Usage {
  windowDays: number;
  totalTokens: number;
  totalCostUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; requests: number; estimatedCostUsd: number }>;
}

/** Platform-wide business + usage metrics — every tenant at once. Distinct from per-tenant usage and System Health (provider uptime). */
export default function PlatformAnalyticsPage() {
  const { user } = useAuth();
  const [business, setBusiness] = useState<Business | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api
      .getPlatformBusinessAnalytics()
      .then(setBusiness)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load business analytics."));
    api
      .getPlatformUsageAnalytics(30)
      .then(setUsage)
      .catch((err) => setError((prev) => prev ?? (err instanceof ApiError ? err.message : "Could not load usage analytics.")));
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Platform Analytics</h1>
        <p className="mt-1 text-sm text-foreground/50">Revenue, churn, and AI usage cost across every tenant.</p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {business === null ? (
          <>
            <StatTileSkeleton />
            <StatTileSkeleton />
            <StatTileSkeleton />
          </>
        ) : (
          <>
            <StatTile label="MRR" value={`$${business.mrr.toLocaleString()}`} />
            <StatTile label="Total tenants" value={business.totalTenants} />
            <StatTile label="Churn rate" value={`${(business.churnRate * 100).toFixed(1)}%`} deltaTone={business.churnRate > 0.1 ? "negative" : "neutral"} />
          </>
        )}
      </div>

      <Card>
        <CardHeader title="Tenants by tier" />
        {business === null ? (
          <CardRowSkeleton rows={3} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {Object.entries(business.byTier).map(([tier, count]) => (
              <div key={tier} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-foreground/70">{tier}</span>
                <span className="font-medium text-foreground">{count}</span>
              </div>
            ))}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Tenants by subscription state" />
        {business === null ? (
          <CardRowSkeleton rows={3} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {Object.entries(business.byState).map(([state, count]) => (
              <div key={state} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="text-foreground/70">{state}</span>
                <span className="font-medium text-foreground">{count}</span>
              </div>
            ))}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="AI usage cost by provider" subtitle={usage ? `Last ${usage.windowDays} days · $${usage.totalCostUsd.toFixed(2)} total` : undefined} />
        {usage === null ? (
          <CardRowSkeleton rows={3} />
        ) : Object.keys(usage.byProvider).length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-foreground/40">No usage recorded in this window.</p>
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {Object.entries(usage.byProvider).map(([provider, stats]) => (
              <div key={provider} className="flex flex-wrap items-center justify-between gap-y-1 px-5 py-3 text-sm">
                <span className="capitalize text-foreground/70">{provider}</span>
                <div className="flex items-center gap-4 text-xs text-foreground/50">
                  <span>{stats.requests.toLocaleString()} requests</span>
                  <span>{(stats.inputTokens + stats.outputTokens).toLocaleString()} tokens</span>
                  <span className="font-medium text-foreground">${stats.estimatedCostUsd.toFixed(2)}</span>
                </div>
              </div>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
