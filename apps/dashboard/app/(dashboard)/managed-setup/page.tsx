"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError, API_BASE } from "@/lib/api";

interface QueueTenant {
  id: string;
  name: string;
  managedSetupTier: string;
  subscriptionState: string;
  updatedAt: string;
}

const TIER_LABEL: Record<string, string> = {
  ASSISTED_SETUP: "Assisted setup",
  FULLY_MANAGED: "Fully managed",
};

export default function ManagedSetupPage() {
  const { user, startImpersonation } = useAuth();
  const [queue, setQueue] = useState<QueueTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<QueueTenant | null>(null);
  const [reason, setReason] = useState("");
  const [starting, setStarting] = useState(false);

  const [platformBrandName, setPlatformBrandName] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.platformBrandName) setPlatformBrandName(user.platformBrandName);
  }, [user?.platformBrandName]);

  async function savePlatformBrandName() {
    setSavingBrand(true);
    setBrandingError(null);
    setBrandingSaved(false);
    try {
      await api.updatePlatformBranding(platformBrandName.trim() || null);
      setBrandingSaved(true);
    } catch (err) {
      setBrandingError(err instanceof ApiError ? err.message : "Could not save the platform name.");
    } finally {
      setSavingBrand(false);
    }
  }

  async function uploadPlatformLogo(file: File) {
    setUploadingLogo(true);
    setBrandingError(null);
    setBrandingSaved(false);
    try {
      await api.uploadPlatformLogo(file);
      setBrandingSaved(true);
      window.location.reload(); // simplest way to pick up the new logo everywhere it's rendered
    } catch (err) {
      setBrandingError(err instanceof ApiError ? err.message : "Could not upload the logo.");
      setUploadingLogo(false);
    }
  }

  function refresh() {
    if (user) api.listManagedSetupQueue().then(setQueue).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the queue."));
  }
  useEffect(refresh, [user]);

  async function begin(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setStarting(true);
    setError(null);
    try {
      await startImpersonation(target.id, target.name, reason, 60);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the session.");
      setStarting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Managed Setup</h1>
        <p className="mt-1 text-sm text-foreground/50">
          Clients on an Assisted or Fully Managed plan. Starting a session gives you time-boxed, fully audited access to their tenant — through the exact same tools they'd use themselves.
        </p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Platform branding" subtitle="Your own dashboard identity — shown here and as the default for any client you haven't branded yet." />
        <CardBody className="space-y-4">
          {brandingError ? <p className="text-xs text-danger">{brandingError}</p> : null}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-foreground/5">
              {user?.platformLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API_BASE}${user.platformLogoUrl}`} alt="" className="h-full w-full object-contain" />
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
                  if (file) void uploadPlatformLogo(file);
                }}
              />
              <Button variant="secondary" type="button" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()}>
                {uploadingLogo ? "Uploading…" : "Upload logo"}
              </Button>
              <p className="mt-1.5 text-xs text-foreground/40">PNG, JPEG, SVG, or WebP. Shown in the corner of your dashboard.</p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Platform name</label>
            <div className="flex max-w-md gap-2">
              <input
                value={platformBrandName}
                onChange={(e) => setPlatformBrandName(e.target.value)}
                placeholder="e.g. Datalyst Africa"
                className="flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-500"
              />
              <Button type="button" disabled={savingBrand} onClick={savePlatformBrandName}>
                {savingBrand ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          {brandingSaved ? <p className="text-xs text-success">Saved.</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Queue" subtitle={queue ? `${queue.length} client${queue.length === 1 ? "" : "s"}` : undefined} />
        {queue === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {queue.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No clients waiting on Assisted or Fully Managed setup right now.</p>
            ) : (
              queue.map((t) => (
                <div key={t.id} className="flex items-center justify-between px-5 py-3.5 text-sm">
                  <div>
                    <div className="text-foreground">{t.name}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Badge tone="brand">{TIER_LABEL[t.managedSetupTier] ?? t.managedSetupTier}</Badge>
                      <Badge tone={t.subscriptionState === "ACTIVE" ? "success" : "neutral"}>{t.subscriptionState.toLowerCase()}</Badge>
                    </div>
                  </div>
                  <Button
                    onClick={() => {
                      setTarget(t);
                      setReason("");
                    }}
                  >
                    Manage this client
                  </Button>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Modal open={target !== null} onClose={() => setTarget(null)} title={`Manage ${target?.name ?? ""}`} subtitle="This starts a time-boxed session (1 hour). Say why — it's written to their audit trail.">
        <form onSubmit={begin} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Reason</label>
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Initial onboarding — building knowledge base from client call"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={starting}>
              {starting ? "Starting…" : "Start session"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
