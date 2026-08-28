"use client";

import { useEffect, useRef, useState } from "react";
import { StatTile, StatTileSkeleton, Card, CardHeader, CardBody, Button, LineChart, BarBreakdown } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError, API_BASE } from "@/lib/api";

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
  const { user, impersonation } = useAuth();
  const isStaff = user?.role === "setup_specialist" || user?.role === "platform_admin";
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
    api
      .getUsageSummary(user.tenantId)
      .then((d) => setUsage(d as UsageSummary))
      .catch((err) => {
        setUsage({ totalInputTokens: 0, totalOutputTokens: 0, totalTokens: 0, overageTokens: 0, estimatedOverageUsd: 0, byProvider: {} });
        setError(err instanceof ApiError ? err.message : "Could not load usage.");
      });
    api
      .getUsageDaily(user.tenantId, 30)
      .then((d) => setDaily(d))
      .catch(() => setDaily([]));
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Billing & Usage</h1>
        <p className="mt-1 text-sm text-foreground/50">Month-to-date usage against your plan's included limits.</p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      {isStaff && impersonation ? (
        <Card>
          <CardHeader
            title="Client branding"
            subtitle="What this client sees on their own dashboard — set once during onboarding, never client-editable."
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
              <p className="py-6 text-center text-sm text-foreground/40">No usage recorded yet.</p>
            )
          ) : (
            <div className="h-[180px] animate-pulse rounded-lg bg-foreground/[0.03]" />
          )}
        </CardBody>
      </Card>

      {usage ? (
        <Card>
          <CardHeader title="By provider" subtitle="Provider identity is never shown to your customers — this view is for your own cost visibility." />
          <CardBody>
            {Object.keys(usage.byProvider).length === 0 ? (
              <p className="py-4 text-center text-sm text-foreground/40">No requests yet this month.</p>
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
