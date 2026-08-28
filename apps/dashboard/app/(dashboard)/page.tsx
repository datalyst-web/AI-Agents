"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StatTile, StatTileSkeleton, Card, CardHeader, CardBody, Button, AgentStatusBadge, LineChart, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError, API_BASE } from "@/lib/api";

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
  const { user, impersonation } = useAuth();
  const isStaff = user?.role === "setup_specialist" || user?.role === "platform_admin";
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [daily, setDaily] = useState<DailyUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [brandName, setBrandName] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.brandName) setBrandName(user.brandName);
  }, [user?.brandName]);

  async function saveBrandName() {
    if (!user) return;
    setSavingBrand(true);
    setBrandingError(null);
    setBrandingSaved(false);
    try {
      await api.updateTenantBranding(user.tenantId, brandName.trim() || null);
      setBrandingSaved(true);
    } catch (err) {
      setBrandingError(err instanceof ApiError ? err.message : "Could not save the console name.");
    } finally {
      setSavingBrand(false);
    }
  }

  async function uploadLogo(file: File) {
    if (!user) return;
    setUploadingLogo(true);
    setBrandingError(null);
    setBrandingSaved(false);
    try {
      await api.uploadTenantLogo(user.tenantId, file);
      setBrandingSaved(true);
      window.location.reload(); // simplest way to pick up the new logo everywhere it's rendered
    } catch (err) {
      setBrandingError(err instanceof ApiError ? err.message : "Could not upload the logo.");
      setUploadingLogo(false);
    }
  }

  useEffect(() => {
    if (!user) return;
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
      .catch(() => setDaily([]));
  }, [user]);

  const liveCount = agents ? agents.filter((a) => a.status === "LIVE").length : 0;
  const trend = daily?.map((d) => d.totalTokens);

  return (
    <div className="space-y-6">
      {isStaff && impersonation ? (
        <Card>
          <CardHeader
            title="Client branding"
            subtitle="What this client sees on their own dashboard — set once here, never client-editable."
          />
          <CardBody className="space-y-4">
            {brandingError ? <p className="text-xs text-danger">{brandingError}</p> : null}
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-foreground/5">
                {user?.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`${API_BASE}${user.logoUrl}`} alt="" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-foreground/30">No logo</span>
                )}
              </div>
              <div>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadLogo(file);
                  }}
                />
                <Button variant="secondary" type="button" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()}>
                  {uploadingLogo ? "Uploading…" : "Upload logo"}
                </Button>
                <p className="mt-1.5 text-xs text-foreground/40">PNG, JPEG, SVG, or WebP. Shown in the corner of their dashboard.</p>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Console name</label>
              <div className="flex max-w-md gap-2">
                <input
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder={`e.g. ${user?.brandName ?? "Acme Inc"}`}
                  className="flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-500"
                />
                <Button type="button" disabled={savingBrand} onClick={saveBrandName}>
                  {savingBrand ? "Saving…" : "Save"}
                </Button>
              </div>
              <p className="mt-1.5 text-xs text-foreground/40">Shown under their logo, e.g. &quot;{brandName || "Acme Inc"} · AI Console&quot;.</p>
            </div>
            {brandingSaved ? <p className="text-xs text-success">Saved.</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Welcome back<span className="text-gradient">.</span>
          </h1>
          <p className="mt-1 text-sm text-foreground/50">Here&apos;s how your AI employees are performing.</p>
        </div>
        {isStaff ? (
          <Link
            href="/agents"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-gradient bg-[length:160%_auto] bg-left px-4 py-2.5 text-sm font-medium text-white shadow-glow transition-all duration-300 hover:bg-right hover:shadow-glow-lg"
          >
            + New agent
          </Link>
        ) : null}
      </div>
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
          <StatTile label="Agents" value={agents.length} icon={<DotIcon />} />
          <StatTile label="Live" value={liveCount} deltaTone="positive" delta={liveCount > 0 ? "active" : undefined} icon={<PulseIcon />} />
          <StatTile
            label="Tokens this month"
            value={usage.totalTokens.toLocaleString()}
            icon={<SparkIcon />}
            trend={trend}
          />
          <StatTile
            label="Est. overage"
            value={`$${usage.estimatedOverageUsd.toFixed(2)}`}
            deltaTone={usage.estimatedOverageUsd > 0 ? "negative" : "positive"}
            delta={usage.estimatedOverageUsd > 0 ? undefined : "within plan"}
            icon={<CoinIcon />}
          />
        </div>
      )}

      <Card>
        <CardHeader title="Token usage" subtitle="Last 14 days, across all providers on your model router." />
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
            <Link href="/agents" className="text-xs font-medium text-brand-300 hover:underline">
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
                {isStaff ? (
                  <Link href="/agents" className="text-xs font-medium text-brand-300 hover:underline">
                    Create an agent →
                  </Link>
                ) : null}
              </div>
            ) : (
              agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex items-center justify-between px-5 py-3.5 text-sm transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient-soft text-xs font-semibold text-brand-200 ring-1 ring-inset ring-brand-500/20">
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
