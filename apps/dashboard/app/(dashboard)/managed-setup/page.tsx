"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError, API_BASE } from "@/lib/api";

interface QueueTenant {
  id: string;
  name: string;
  managedSetupTier: string;
  subscriptionState: string;
  updatedAt: string;
  brandName: string | null;
  logoUrl: string | null;
}
interface StaffAccount {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
}

const TIER_LABEL: Record<string, string> = {
  ASSISTED_SETUP: "Assisted setup",
  FULLY_MANAGED: "Fully managed",
};
const ROLE_LABEL: Record<string, string> = {
  setup_specialist: "Setup specialist",
  platform_admin: "Platform admin",
};

export default function ManagedSetupPage() {
  const { user, startImpersonation } = useAuth();
  const [queue, setQueue] = useState<QueueTenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<QueueTenant | null>(null);
  const [reason, setReason] = useState("");
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<QueueTenant | null>(null);

  const [brandingTarget, setBrandingTarget] = useState<QueueTenant | null>(null);
  const [clientBrandName, setClientBrandName] = useState("");
  const [clientLogoUrl, setClientLogoUrl] = useState<string | null>(null);
  const [savingClientBrand, setSavingClientBrand] = useState(false);
  const [uploadingClientLogo, setUploadingClientLogo] = useState(false);
  const [clientBrandingError, setClientBrandingError] = useState<string | null>(null);
  const clientLogoInputRef = useRef<HTMLInputElement>(null);

  const [addClientOpen, setAddClientOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPassword, setNewClientPassword] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [addClientError, setAddClientError] = useState<string | null>(null);

  const [platformBrandName, setPlatformBrandName] = useState("");
  const [savingBrand, setSavingBrand] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [brandingError, setBrandingError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"setup_specialist" | "platform_admin">("setup_specialist");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

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
    if (!user) return;
    api.listManagedSetupQueue().then(setQueue).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the queue."));
    api.listStaff().then(setStaff).catch(() => setStaff([]));
  }
  useEffect(refresh, [user]);

  async function begin(e: FormEvent) {
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

  async function createClient(e: FormEvent) {
    e.preventDefault();
    setCreatingClient(true);
    setAddClientError(null);
    try {
      await api.createClient(newTenantName, newClientEmail, newClientPassword);
      setAddClientOpen(false);
      setNewTenantName("");
      setNewClientEmail("");
      setNewClientPassword("");
      refresh();
    } catch (err) {
      setAddClientError(err instanceof ApiError ? err.message : "Could not create this client.");
    } finally {
      setCreatingClient(false);
    }
  }

  async function cancelClient() {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    setError(null);
    try {
      await api.cancelClient(cancelTarget.id);
      setCancelTarget(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove this client.");
    } finally {
      setBusyId(null);
    }
  }

  async function reactivateClient(tenantId: string) {
    setBusyId(tenantId);
    setError(null);
    try {
      await api.reactivateClient(tenantId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reactivate this client.");
    } finally {
      setBusyId(null);
    }
  }

  function openBranding(t: QueueTenant) {
    setBrandingTarget(t);
    setClientBrandName(t.brandName ?? "");
    setClientLogoUrl(t.logoUrl);
    setClientBrandingError(null);
  }

  async function saveClientBrandName() {
    if (!brandingTarget) return;
    setSavingClientBrand(true);
    setClientBrandingError(null);
    try {
      await api.updateClientBranding(brandingTarget.id, clientBrandName.trim() || null);
      refresh();
    } catch (err) {
      setClientBrandingError(err instanceof ApiError ? err.message : "Could not save the console name.");
    } finally {
      setSavingClientBrand(false);
    }
  }

  async function uploadClientLogo(file: File) {
    if (!brandingTarget) return;
    setUploadingClientLogo(true);
    setClientBrandingError(null);
    try {
      await api.uploadClientLogo(brandingTarget.id, file);
      setClientLogoUrl(`/v1/tenants/${brandingTarget.id}/branding/logo?t=${Date.now()}`);
      refresh();
    } catch (err) {
      setClientBrandingError(err instanceof ApiError ? err.message : "Could not upload the logo.");
    } finally {
      setUploadingClientLogo(false);
    }
  }

  async function deactivateStaff(staffId: string) {
    setBusyId(staffId);
    setError(null);
    try {
      await api.deactivateStaff(staffId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove this staff account.");
    } finally {
      setBusyId(null);
    }
  }

  async function reactivateStaff(staffId: string) {
    setBusyId(staffId);
    setError(null);
    try {
      await api.reactivateStaff(staffId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reactivate this staff account.");
    } finally {
      setBusyId(null);
    }
  }

  async function createStaff(e: FormEvent) {
    e.preventDefault();
    setCreatingStaff(true);
    setStaffError(null);
    try {
      await api.createStaff(newStaffEmail, newStaffPassword, newStaffName, newStaffRole);
      setAddStaffOpen(false);
      setNewStaffEmail("");
      setNewStaffName("");
      setNewStaffPassword("");
      setNewStaffRole("setup_specialist");
      refresh();
    } catch (err) {
      setStaffError(err instanceof ApiError ? err.message : "Could not create this staff account.");
    } finally {
      setCreatingStaff(false);
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
        <CardHeader
          title="Queue"
          subtitle={queue ? `${queue.length} client${queue.length === 1 ? "" : "s"}` : undefined}
          action={<Button onClick={() => setAddClientOpen(true)}>+ Add client</Button>}
        />
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openBranding(t)}
                      className="text-xs font-medium text-foreground/40 transition-colors hover:text-foreground/70"
                    >
                      Branding
                    </button>
                    {t.subscriptionState === "CANCELLED" ? (
                      <button
                        onClick={() => reactivateClient(t.id)}
                        disabled={busyId === t.id}
                        className="text-xs font-medium text-brand-300 transition-colors hover:text-brand-200 disabled:opacity-50"
                      >
                        {busyId === t.id ? "Reactivating…" : "Reactivate"}
                      </button>
                    ) : (
                      <button
                        onClick={() => setCancelTarget(t)}
                        disabled={busyId === t.id}
                        className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                      >
                        Remove
                      </button>
                    )}
                    <Button
                      onClick={() => {
                        setTarget(t);
                        setReason("");
                      }}
                    >
                      Manage this client
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Staff accounts"
          subtitle={staff ? `${staff.length} account${staff.length === 1 ? "" : "s"}` : undefined}
          action={<Button onClick={() => setAddStaffOpen(true)}>+ Add staff</Button>}
        />
        {staff === null ? (
          <CardRowSkeleton rows={2} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {staff.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-foreground/40">No staff accounts yet.</p>
            ) : (
              staff.map((s) => {
                const isSelf = s.id === user?.id;
                return (
                  <div key={s.id} className={`flex items-center justify-between px-5 py-3.5 text-sm ${s.isActive ? "" : "opacity-50"}`}>
                    <div>
                      <div className="text-foreground">
                        {s.displayName}
                        {isSelf ? <span className="ml-1.5 text-[11px] text-foreground/35">(you)</span> : null}
                      </div>
                      <div className="text-xs text-foreground/40">{s.email}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone={s.role === "platform_admin" ? "brand" : "neutral"}>{ROLE_LABEL[s.role] ?? s.role}</Badge>
                      {!s.isActive ? (
                        <Badge tone="warning">removed</Badge>
                      ) : null}
                      {!isSelf ? (
                        s.isActive ? (
                          <button
                            onClick={() => deactivateStaff(s.id)}
                            disabled={busyId === s.id}
                            className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                          >
                            {busyId === s.id ? "Removing…" : "Remove"}
                          </button>
                        ) : (
                          <button
                            onClick={() => reactivateStaff(s.id)}
                            disabled={busyId === s.id}
                            className="text-xs font-medium text-brand-300 transition-colors hover:text-brand-200 disabled:opacity-50"
                          >
                            {busyId === s.id ? "Reactivating…" : "Reactivate"}
                          </button>
                        )
                      ) : null}
                    </div>
                  </div>
                );
              })
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

      <Modal
        open={brandingTarget !== null}
        onClose={() => setBrandingTarget(null)}
        title={`${brandingTarget?.name ?? ""} branding`}
        subtitle="What this client sees on their own dashboard — never client-editable."
      >
        <div className="space-y-4">
          {clientBrandingError ? <p className="text-xs text-danger">{clientBrandingError}</p> : null}
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-foreground/5">
              {clientLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`${API_BASE}${clientLogoUrl}`} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-[10px] text-foreground/30">No logo</span>
              )}
            </div>
            <div>
              <input
                ref={clientLogoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadClientLogo(file);
                }}
              />
              <Button variant="secondary" type="button" disabled={uploadingClientLogo} onClick={() => clientLogoInputRef.current?.click()}>
                {uploadingClientLogo ? "Uploading…" : "Upload logo"}
              </Button>
              <p className="mt-1.5 text-xs text-foreground/40">PNG, JPEG, SVG, or WebP.</p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Console name</label>
            <div className="flex gap-2">
              <input
                value={clientBrandName}
                onChange={(e) => setClientBrandName(e.target.value)}
                placeholder={`e.g. ${brandingTarget?.name ?? "Acme Inc"}`}
                className="flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-500"
              />
              <Button type="button" disabled={savingClientBrand} onClick={saveClientBrandName}>
                {savingClientBrand ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button type="button" variant="ghost" onClick={() => setBrandingTarget(null)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={addClientOpen}
        onClose={() => setAddClientOpen(false)}
        title="Add a new client"
        subtitle="Creates their tenant and login now — you'll build their agent and knowledge base yourself via Managed Setup."
      >
        <form onSubmit={createClient} className="space-y-3">
          {addClientError ? <p className="text-xs text-danger">{addClientError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Business name</label>
            <input
              required
              value={newTenantName}
              onChange={(e) => setNewTenantName(e.target.value)}
              placeholder="e.g. Acme Plumbing"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Their login email</label>
            <input
              required
              type="email"
              value={newClientEmail}
              onChange={(e) => setNewClientEmail(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Their initial password</label>
            <input
              required
              type="text"
              minLength={8}
              value={newClientPassword}
              onChange={(e) => setNewClientPassword(e.target.value)}
              placeholder="At least 8 characters — share this with them securely"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAddClientOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creatingClient}>
              {creatingClient ? "Creating…" : "Create client"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        title={`Remove ${cancelTarget?.name ?? ""}?`}
        subtitle="This cancels their subscription and suspends their agent — it does not delete their data, and can be undone with Reactivate."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCancelTarget(null)} disabled={busyId === cancelTarget?.id}>
            Cancel
          </Button>
          <Button variant="danger" onClick={cancelClient} disabled={busyId === cancelTarget?.id}>
            {busyId === cancelTarget?.id ? "Removing…" : "Remove client"}
          </Button>
        </div>
      </Modal>

      <Modal
        open={addStaffOpen}
        onClose={() => setAddStaffOpen(false)}
        title="Add a staff account"
        subtitle="They'll be able to log in and manage clients through Managed Setup, same as you."
      >
        <form onSubmit={createStaff} className="space-y-3">
          {staffError ? <p className="text-xs text-danger">{staffError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Name</label>
            <input
              required
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Email</label>
            <input
              required
              type="email"
              value={newStaffEmail}
              onChange={(e) => setNewStaffEmail(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Initial password</label>
            <input
              required
              type="text"
              minLength={8}
              value={newStaffPassword}
              onChange={(e) => setNewStaffPassword(e.target.value)}
              placeholder="At least 8 characters — share this with them securely"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Role</label>
            <select
              value={newStaffRole}
              onChange={(e) => setNewStaffRole(e.target.value as typeof newStaffRole)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            >
              <option value="setup_specialist" className="bg-surface-overlay">Setup specialist — manages clients (recommended)</option>
              <option value="platform_admin" className="bg-surface-overlay">Platform admin — also manages subscriptions/billing tiers</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setAddStaffOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creatingStaff}>
              {creatingStaff ? "Creating…" : "Create account"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
