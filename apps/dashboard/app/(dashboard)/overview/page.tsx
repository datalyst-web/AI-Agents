"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatTile, StatTileSkeleton, Card, CardHeader, CardBody, AgentStatusBadge, LineChart, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Agent {
  id: string;
  name: string;
  status: string;
  updatedAt: string;
}
interface UsageSummary {
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedOverageUsd: number;
}
interface DailyUsage {
  date: string;
  totalTokens: number;
}

function dayLabel(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
}

export default function OverviewPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "setup_specialist" || user?.role === "platform_admin";
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Staff with no client in view have no tenant; the layout redirects
    // them to Managed Setup, so there's nothing to load here meanwhile.
    if (!user?.tenantId) return;
    setError(null);
    const onFail = (err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load your dashboard.");
    api
      .listAgents(user.tenantId)
      .then((data) => setAgents(data as Agent[]))
      .catch((err) => {
        setAgents([]);
        onFail(err);
      });
    api
      .getUsageSummary(user.tenantId)
      .then((data) => setUsage(data as UsageSummary))
      .catch((err) => {
        setUsage({ totalTokens: 0, totalInputTokens: 0, totalOutputTokens: 0, estimatedOverageUsd: 0 });
        onFail(err);
      });
    api
      .getUsageDaily(user.tenantId, 14)
      .then((data) => setDaily(data))
      .catch((err) => {
        setDaily([]);
        onFail(err);
      });
  }, [user]);

  const liveCount = agents ? agents.filter((a) => a.status === "LIVE").length : 0;
  const trend = daily?.map((d) => d.totalTokens);

  // One agent per client (CLAUDE.md: "configure each client's AI employee
  // separately" — one employee, not several) — hide the create action
  // once they already have one, rather than let a repeat click create a
  // duplicate the backend will now reject anyway.
  const canCreateAgent = isStaff && agents !== null && agents.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back<span className="text-gradient">.</span>
          </h1>
          <p className="mt-1 text-sm text-foreground/50">Here&apos;s how your AI employees are performing.</p>
        </div>
        {canCreateAgent ? (
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient bg-[length:160%_auto] bg-left px-4 py-2.5 text-sm font-medium text-white shadow-glow transition-all duration-300 hover:bg-right hover:shadow-glow-lg"
          >
            + New agent
          </Link>
        ) : null}
      </div>

      {!isStaff && user?.subscriptionState === "TRIAL" && user.trialStarted && user.trialDaysRemaining !== null && user.trialEndsAt ? (
        <TrialCountdown daysRemaining={user.trialDaysRemaining} trialEndsAt={user.trialEndsAt} />
      ) : null}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {agents === null || usage === null ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Agents" value={agents.length} icon={<DotIcon />} delayMs={0} />
          <StatTile
            label="Live"
            value={liveCount}
            deltaTone="positive"
            delta={liveCount > 0 ? "active" : undefined}
            icon={<PulseIcon />}
            delayMs={40}
          />
          <StatTile
            label="Tokens this month"
            value={usage.totalTokens.toLocaleString()}
            icon={<SparkIcon />}
            trend={trend}
            delayMs={80}
          />
          <StatTile
            label="Est. overage"
            value={`$${usage.estimatedOverageUsd.toFixed(2)}`}
            deltaTone={usage.estimatedOverageUsd > 0 ? "negative" : "positive"}
            delta={usage.estimatedOverageUsd > 0 ? undefined : "within plan"}
            icon={<CoinIcon />}
            delayMs={120}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Token usage" subtitle="Last 14 days." />
        <CardBody>
          {daily ? (
            daily.some((d) => d.totalTokens > 0) ? (
              <LineChart data={daily.map((d) => ({ label: dayLabel(d.date), value: d.totalTokens }))} tone="brand" />
            ) : (
              <p className="py-6 text-center text-sm text-foreground/40">
                No usage yet — send a test message from an agent to see activity here.
              </p>
            )
          ) : (
            <div className="h-[180px] animate-pulse rounded-lg bg-foreground/[0.03]" />
          )}
        </CardBody>
      </Card>

      <Card hover>
        <CardHeader
          title="Your agents"
          subtitle={agents ? `${agents.length} configured` : undefined}
          action={
            <Link href="/agents" className="text-xs font-medium text-brand-link hover:underline">
              View all →
            </Link>
          }
        />
        {agents === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {agents.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-500/10 ring-1 ring-inset ring-brand-500/25">
                  <DotIcon />
                </div>
                <p className="text-sm text-foreground/50">
                  {isStaff ? "No agents yet. Create your first AI employee to get started." : "Your AI Setup Team is configuring your agent — check back soon."}
                </p>
                {canCreateAgent ? (
                  <Link href="/agents" className="text-xs font-medium text-brand-link hover:underline">
                    Create an agent →
                  </Link>
                ) : null}
              </div>
            ) : (
              agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient-soft text-xs font-semibold text-brand-link ring-1 ring-inset ring-brand-500/20">
                      {agent.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-foreground">{agent.name}</span>
                  </span>
                  <AgentStatusBadge status={agent.status} />
                </Link>
              ))
            )}
          </CardBody>
        )}
      </Card>
    </div>
  );
}

/**
 * The client's first, and best, look at where their trial stands: how many
 * of the 14 days are left, and since when. Shown the whole way through the
 * trial — not just the last-week urgency banner in the dashboard layout,
 * which is a global reminder across every page, not this page's own
 * welcome. 14 mirrors TRIAL_DAYS in apps/api/src/lib/planLimits.ts — the
 * dashboard has no import path to that server-side constant, so it's
 * restated here the same way the marketing site restates plan pricing.
 */
function TrialCountdown({ daysRemaining, trialEndsAt }: { daysRemaining: number; trialEndsAt: string }) {
  const TRIAL_DAYS = 14;
  const dayNumber = Math.min(TRIAL_DAYS, Math.max(1, TRIAL_DAYS - daysRemaining + 1));
  const urgent = daysRemaining <= 3;

  const endDate = new Date(trialEndsAt);
  const startDate = new Date(endDate.getTime() - TRIAL_DAYS * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const size = 88;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = circumference * (dayNumber / TRIAL_DAYS);

  return (
    <div
      className={`relative overflow-hidden rounded-xl3 p-px shadow-card ${
        urgent ? "bg-gradient-to-br from-danger/70 to-danger/15" : "bg-brand-gradient-soft"
      }`}
    >
      <div className="relative flex flex-wrap items-center gap-5 rounded-[calc(1.75rem-1px)] bg-surface-raised/95 px-6 py-5 backdrop-blur sm:gap-6">
        <div
          aria-hidden
          className={`pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full blur-3xl ${
            urgent ? "bg-danger/15" : "bg-brand-500/15"
          }`}
        />

        <div className="relative flex h-[88px] w-[88px] flex-none items-center justify-center">
          <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Day ${dayNumber} of ${TRIAL_DAYS}`}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-foreground/[0.07]" />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - filled}
              className={`transition-[stroke-dashoffset] duration-700 ease-out ${urgent ? "stroke-danger" : "stroke-brand-500"}`}
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-xl font-bold leading-none tabular-nums text-foreground">{dayNumber}</span>
            <span className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/40">of {TRIAL_DAYS}</span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-success">Live &amp; trialling</span>
          </div>
          <p className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">
            {daysRemaining === 0
              ? "Your trial ends today"
              : daysRemaining === 1
                ? "1 day left on your free trial"
                : `${daysRemaining} days left on your free trial`}
          </p>
          <p className="mt-0.5 text-xs text-foreground/45">
            Live since {fmt(startDate)} · trial ends {fmt(endDate)}
          </p>
        </div>

        <Link
          href="/billing"
          className="flex-none rounded-lg bg-brand-gradient bg-[length:160%_auto] bg-left px-4 py-2.5 text-sm font-medium text-white shadow-glow transition-all duration-300 hover:bg-right hover:shadow-glow-lg"
        >
          View plans
        </Link>
      </div>
    </div>
  );
}

function DotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="2" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
function PulseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M2 8h3l1.5-4L9 12l1.5-4H14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}
function CoinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 5.3v5.4M6.3 6.7c0-.9.8-1.4 1.7-1.4s1.7.5 1.7 1.2c0 1.6-3.4.9-3.4 2.5 0 .7.8 1.2 1.7 1.2s1.7-.5 1.7-1.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
