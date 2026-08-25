"use client";

import { useEffect, useState } from "react";
import { StatTile, StatTileSkeleton, Card, CardHeader, CardBody, LineChart, BarBreakdown } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  overageTokens: number;
  estimatedOverageUsd: number;
  byProvider: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
}
interface DailyUsage {
  date: string;
  totalTokens: number;
}

const PROVIDER_TONE = { anthropic: "brand", openai: "success", gemini: "info" } as const;

export default function BillingPage() {
  const { user } = useAuth();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[] | null>(null);

  useEffect(() => {
    if (!user) return;
    api.getUsageSummary(user.tenantId).then((d) => setUsage(d as UsageSummary));
    api.getUsageDaily(user.tenantId, 30).then((d) => setDaily(d));
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Billing & Usage</h1>
        <p className="mt-1 text-sm text-white/50">Month-to-date usage against your plan's included limits.</p>
      </div>

      {usage ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTile label="Input tokens" value={usage.totalInputTokens.toLocaleString()} />
          <StatTile label="Output tokens" value={usage.totalOutputTokens.toLocaleString()} />
          <StatTile label="Overage tokens" value={usage.overageTokens.toLocaleString()} deltaTone={usage.overageTokens > 0 ? "negative" : "neutral"} />
          <StatTile label="Est. overage cost" value={`$${usage.estimatedOverageUsd.toFixed(2)}`} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      )}

      <Card>
        <CardHeader title="Usage over time" subtitle="Last 30 days, total input + output tokens per day." />
        <CardBody>
          {daily ? (
            daily.some((d) => d.totalTokens > 0) ? (
              <LineChart data={daily.map((d) => ({ label: new Date(d.date).getDate().toString(), value: d.totalTokens }))} tone="brand" />
            ) : (
              <p className="py-6 text-center text-sm text-white/40">No usage recorded yet.</p>
            )
          ) : (
            <div className="h-[180px] animate-pulse rounded-lg bg-white/[0.03]" />
          )}
        </CardBody>
      </Card>

      {usage ? (
        <Card>
          <CardHeader title="By provider" subtitle="Provider identity is never shown to your customers — this view is for your own cost visibility." />
          <CardBody>
            {Object.keys(usage.byProvider).length === 0 ? (
              <p className="py-4 text-center text-sm text-white/40">No requests yet this month.</p>
            ) : (
              <BarBreakdown
                items={Object.entries(usage.byProvider).map(([provider, stats]) => ({
                  label: `${provider} · ${stats.requests} req`,
                  value: stats.inputTokens + stats.outputTokens,
                  tone: PROVIDER_TONE[provider as keyof typeof PROVIDER_TONE] ?? "neutral",
                }))}
              />
            )}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
