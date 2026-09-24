"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError, API_BASE, type IntakeView } from "@/lib/api";

type AgentStatus = "DRAFT" | "CONFIGURING" | "KNOWLEDGE_PROCESSING" | "TESTING" | "APPROVED" | "LIVE";
interface QueueTenant {
  id: string;
  name: string;
  managedSetupTier: string;
  subscriptionState: string;
  updatedAt: string;
  brandName: string | null;
  logoUrl: string | null;
  dataResidencyRegion: string | null;
  /** When a trial client sent the welcome questionnaire (null if not yet / not a trial). */
  onboardingIntakeAt: string | null;
  /** The client has authorised staff to publish without their approval. Only a platform admin can change it. */
  delegatesAutoPublish: boolean;
  agents: { id: string; name: string; status: AgentStatus }[];
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
// Earliest-first — a client with agents at multiple stages is summarized
// by whichever is furthest from done, since that's the one that actually
// needs staff attention next.
const AGENT_STATUS_ORDER: AgentStatus[] = ["DRAFT", "CONFIGURING", "KNOWLEDGE_PROCESSING", "TESTING", "APPROVED", "LIVE"];
const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  DRAFT: "Draft",
  CONFIGURING: "Configuring",
  KNOWLEDGE_PROCESSING: "Processing knowledge",
  TESTING: "In testing",
  APPROVED: "Approved",
  LIVE: "Live",
};
const AGENT_STATUS_TONE: Record<AgentStatus, "neutral" | "warning" | "info" | "success"> = {
  DRAFT: "neutral",
  CONFIGURING: "warning",
  KNOWLEDGE_PROCESSING: "warning",
  TESTING: "info",
  APPROVED: "info",
  LIVE: "success",
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
  const [intakeTarget, setIntakeTarget] = useState<QueueTenant | null>(null);
  const [intake, setIntake] = useState<IntakeView | null>(null);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<QueueTenant | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [authorityTarget, setAuthorityTarget] = useState<QueueTenant | null>(null);
  const [authorityBasis, setAuthorityBasis] = useState("");
  const [authorityError, setAuthorityError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isPlatformAdmin = user?.role === "platform_admin";

  const [brandingTarget, setBrandingTarget] = useState<QueueTenant | null>(null);
  const [clientBrandName, setClientBrandName] = useState("");
  const [clientLogoUrl, setClientLogoUrl] = useState<string | null>(null);
  const [savingClientBrand, setSavingClientBrand] = useState(false);
  const [uploadingClientLogo, setUploadingClientLogo] = useState(false);
  const [clientBrandingError, setClientBrandingError] = useState<string | null>(null);
  const clientLogoInputRef = useRef<HTMLInputElement>(null);
  const [presets, setPresets] = useState<{ id: string; name: string; brandName: string }[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [applyingPreset, setApplyingPreset] = useState(false);
  const [dataResidency, setDataResidency] = useState("");
  const [savingResidency, setSavingResidency] = useState(false);

  const [addClientOpen, setAddClientOpen] = useState(false);
  const [newTenantName, setNewTenantName] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");
  const [newClientPassword, setNewClientPassword] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);
  const [addClientError, setAddClientError] = useState<string | null>(null);

  const [staff, setStaff] = useState<StaffAccount[] | null>(null);
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffName, setNewStaffName] = useState("");
  const [newStaffPassword, setNewStaffPassword] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<"setup_specialist" | "platform_admin">("setup_specialist");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [staffError, setStaffError] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api.listManagedSetupQueue().then(setQueue).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the queue."));
    // A failed load must not read as "no staff" or "no presets" — staff
    // would think their team or saved branding had been deleted.
    api
      .listStaff()
      .then(setStaff)
      .catch((err) => {
        setStaff([]);
        // Page-level, not staffError — that one only renders inside the
        // "Add staff" dialog, so a list failure there would stay invisible.
        setError(err instanceof ApiError ? `Could not load staff: ${err.message}` : "Could not load staff.");
      });
    api
      .listBrandingPresets()
      .then(setPresets)
      .catch((err) => {
        setPresets([]);
        setError(err instanceof ApiError ? `Could not load branding presets: ${err.message}` : "Could not load branding presets.");
      });
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

  async function savePublishAuthority() {
    if (!authorityTarget) return;
    const enable = !authorityTarget.delegatesAutoPublish;
    setBusyId(authorityTarget.id);
    setAuthorityError(null);
    try {
      await api.setPublishAuthority(authorityTarget.id, enable, authorityBasis.trim());
      setNotice(enable ? `${authorityTarget.name} can now be published by staff without their approval.` : `${authorityTarget.name} must approve changes again.`);
      setAuthorityTarget(null);
      setAuthorityBasis("");
      refresh();
    } catch (err) {
      setAuthorityError(err instanceof ApiError ? err.message : "Could not save this.");
    } finally {
      setBusyId(null);
    }
  }

  async function openIntake(t: QueueTenant) {
    setIntakeTarget(t);
    setIntake(null);
    setIntakeError(null);
    try {
      setIntake(await api.getIntake(t.id));
    } catch (err) {
      setIntakeError(err instanceof ApiError ? err.message : "Could not load their answers.");
    }
  }

  async function downloadIntakeFile(tenantId: string, index: number) {
    try {
      const { url } = await api.getIntakeFileUrl(tenantId, index);
      window.open(url, "_blank", "noopener");
    } catch (err) {
      setIntakeError(err instanceof ApiError ? err.message : "Could not open that file.");
    }
  }

  function openDelete(t: QueueTenant) {
    setDeleteTarget(t);
    setDeleteConfirmName("");
    setDeleteReason("");
    setDeleteError(null);
  }

  async function deleteClient(e: FormEvent) {
    e.preventDefault();
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setDeleteError(null);
    try {
      const result = await api.deleteClient(deleteTarget.id, deleteConfirmName, deleteReason);
      setNotice(
        result.filesCleanupIncomplete
          ? `${deleteTarget.name} was deleted, but some of their stored files couldn't be removed. This has been recorded — let your developer know.`
          : `${deleteTarget.name} and all of their data were permanently deleted.`,
      );
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Could not delete this client.");
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
    setSelectedPresetId("");
    setDataResidency(t.dataResidencyRegion ?? "");
  }

  async function applyPreset() {
    if (!brandingTarget || !selectedPresetId) return;
    setApplyingPreset(true);
    setClientBrandingError(null);
    try {
      await api.applyBrandingPreset(brandingTarget.id, selectedPresetId);
      const preset = presets.find((p) => p.id === selectedPresetId);
      if (preset) setClientBrandName(preset.brandName);
      refresh();
    } catch (err) {
      setClientBrandingError(err instanceof ApiError ? err.message : "Could not apply that preset.");
    } finally {
      setApplyingPreset(false);
    }
  }

  async function saveDataResidency() {
    if (!brandingTarget) return;
    setSavingResidency(true);
    setClientBrandingError(null);
    try {
      await api.updateDataResidency(brandingTarget.id, dataResidency.trim() || null);
      refresh();
    } catch (err) {
      setClientBrandingError(err instanceof ApiError ? err.message : "Could not save data residency.");
    } finally {
      setSavingResidency(false);
    }
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
          Clients on an Assisted or Fully Managed plan. Starting a session gives you time-boxed, fully audited access to their tenant — through the exact same tools they&apos;d use themselves.
        </p>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {notice ? <p className="text-xs text-success">{notice}</p> : null}

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
                <div key={t.id} className="flex flex-col gap-3 px-5 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-foreground">{t.name}</div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <Badge tone="brand">{TIER_LABEL[t.managedSetupTier] ?? t.managedSetupTier}</Badge>
                      <Badge tone={t.subscriptionState === "ACTIVE" ? "success" : "neutral"}>{t.subscriptionState.toLowerCase()}</Badge>
                      <AgentPipelineBadge agents={t.agents} />
                      {t.subscriptionState === "TRIAL" ? (
                        <Badge tone={t.onboardingIntakeAt ? "info" : "warning"}>
                          {t.onboardingIntakeAt ? "questionnaire received" : "awaiting questionnaire"}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {t.onboardingIntakeAt ? (
                      <button
                        onClick={() => void openIntake(t)}
                        className="text-xs font-medium text-brand-link transition-colors hover:text-brand-link-hover"
                      >
                        Questionnaire
                      </button>
                    ) : null}
                    <button
                      onClick={() => openBranding(t)}
                      className="text-xs font-medium text-foreground/40 transition-colors hover:text-foreground/70"
                    >
                      Branding
                    </button>
                    {isPlatformAdmin ? (
                      <button
                        onClick={() => {
                          setAuthorityTarget(t);
                          setAuthorityBasis("");
                          setAuthorityError(null);
                        }}
                        className={`text-xs font-medium transition-colors ${
                          t.delegatesAutoPublish ? "text-success hover:text-success/80" : "text-foreground/40 hover:text-foreground/70"
                        }`}
                        title="Whether we may publish this client's changes without their approval"
                      >
                        {t.delegatesAutoPublish ? "Publishing authorised" : "Publish authority"}
                      </button>
                    ) : null}
                    {t.subscriptionState === "CANCELLED" ? (
                      <>
                        <button
                          onClick={() => reactivateClient(t.id)}
                          disabled={busyId === t.id}
                          className="text-xs font-medium text-brand-link transition-colors hover:text-brand-link-hover disabled:opacity-50"
                        >
                          {busyId === t.id ? "Reactivating…" : "Reactivate"}
                        </button>
                        {isPlatformAdmin ? (
                          <button
                            onClick={() => openDelete(t)}
                            disabled={busyId === t.id}
                            className="text-xs font-medium text-danger/80 transition-colors hover:text-danger disabled:opacity-50"
                          >
                            Delete
                          </button>
                        ) : null}
                      </>
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
                  <div key={s.id} className={`flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between ${s.isActive ? "" : "opacity-50"}`}>
                    <div>
                      <div className="text-foreground">
                        {s.displayName}
                        {isSelf ? <span className="ml-1.5 text-[11px] text-foreground/35">(you)</span> : null}
                      </div>
                      <div className="text-xs text-foreground/40">{s.email}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge tone={s.role === "platform_admin" ? "brand" : "neutral"}>{ROLE_LABEL[s.role] ?? s.role}</Badge>
                      {!s.isActive ? (
                        <Badge tone="warning">removed</Badge>
                      ) : null}
                      {s.isActive ? (
                        <button
                          onClick={() => deactivateStaff(s.id)}
                          disabled={isSelf || busyId === s.id}
                          title={isSelf ? "You can't remove your own account." : undefined}
                          className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-foreground/30"
                        >
                          {busyId === s.id ? "Removing…" : "Remove"}
                        </button>
                      ) : (
                        <button
                          onClick={() => reactivateStaff(s.id)}
                          disabled={busyId === s.id}
                          className="text-xs font-medium text-brand-link transition-colors hover:text-brand-link-hover disabled:opacity-50"
                        >
                          {busyId === s.id ? "Reactivating…" : "Reactivate"}
                        </button>
                      )}
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
          {presets.length > 0 ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Apply a branding preset</label>
              <div className="flex gap-2">
                <select
                  value={selectedPresetId}
                  onChange={(e) => setSelectedPresetId(e.target.value)}
                  className="flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-500"
                >
                  <option value="" className="bg-surface-overlay text-foreground">Select a preset…</option>
                  {presets.map((p) => (
                    <option key={p.id} value={p.id} className="bg-surface-overlay text-foreground">
                      {p.name}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="secondary" disabled={!selectedPresetId || applyingPreset} onClick={applyPreset}>
                  {applyingPreset ? "Applying…" : "Apply"}
                </Button>
              </div>
              <p className="mt-1 text-xs text-foreground/40">Overwrites this client&apos;s name and logo with the preset&apos;s.</p>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">
              Data residency <span className="text-foreground/30">— disclosure only, doesn&apos;t relocate data</span>
            </label>
            <div className="flex gap-2">
              <input
                value={dataResidency}
                onChange={(e) => setDataResidency(e.target.value)}
                placeholder="e.g. EU, US — as agreed with this client"
                className="flex-1 rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-500"
              />
              <Button type="button" variant="secondary" disabled={savingResidency} onClick={saveDataResidency}>
                {savingResidency ? "Saving…" : "Save"}
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
        open={authorityTarget !== null}
        onClose={() => setAuthorityTarget(null)}
        title={authorityTarget?.delegatesAutoPublish ? `Take back publishing authority — ${authorityTarget?.name ?? ""}` : `Publishing authority — ${authorityTarget?.name ?? ""}`}
        subtitle={
          authorityTarget?.delegatesAutoPublish
            ? "Staff will need this client to approve changes again before anything reaches their customers."
            : "Only for a client who has agreed we may publish for them. Until then every change waits for their own approval — that gate is what protects them."
        }
      >
        <div className="space-y-3">
          {authorityTarget?.delegatesAutoPublish ? null : (
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Who authorised this, and when?</label>
              <input
                value={authorityBasis}
                onChange={(e) => setAuthorityBasis(e.target.value)}
                placeholder="e.g. Approved by the owner in writing (WhatsApp/email), 24 Sep 2026"
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
              <p className="mt-1.5 text-xs text-foreground/40">Saved to their audit trail with your name.</p>
            </div>
          )}
          {authorityError ? <p className="text-xs text-danger">{authorityError}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setAuthorityTarget(null)} disabled={busyId === authorityTarget?.id}>
              Cancel
            </Button>
            <Button
              onClick={savePublishAuthority}
              disabled={busyId === authorityTarget?.id || (!authorityTarget?.delegatesAutoPublish && authorityBasis.trim().length < 10)}
            >
              {busyId === authorityTarget?.id ? "Saving…" : authorityTarget?.delegatesAutoPublish ? "Take back authority" : "Record authority"}
            </Button>
          </div>
        </div>
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
        open={intakeTarget !== null}
        onClose={() => setIntakeTarget(null)}
        title={`${intakeTarget?.name ?? ""} — trial questionnaire`}
        subtitle={intake ? `Sent ${new Date(intake.submittedAt).toLocaleString()}. Build their assistant from this, then publish — their 14-day trial starts at go-live.` : undefined}
      >
        {intakeError ? <p className="text-sm text-danger">{intakeError}</p> : null}
        {!intake && !intakeError ? <p className="text-sm text-foreground/40">Loading…</p> : null}
        {intake ? (
          <div className="space-y-4">
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap rounded-lg bg-foreground/[0.03] p-4 font-sans text-xs leading-relaxed text-foreground/80 ring-1 ring-inset ring-surface-border">
              {intake.summary}
            </pre>
            <div>
              <p className="text-xs font-medium text-foreground/60">Files</p>
              {intake.files.length === 0 ? (
                <p className="mt-1 text-xs text-foreground/40">None sent.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {intake.files.map((f) => (
                    <li key={f.index} className="flex items-center justify-between rounded-lg bg-foreground/[0.03] px-3 py-2 text-xs ring-1 ring-inset ring-surface-border">
                      <span className="truncate">
                        {f.kind === "logo" ? <Badge tone="brand">logo</Badge> : null} <span className="ml-1">{f.name}</span>
                        <span className="ml-2 text-foreground/35">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                      </span>
                      <button onClick={() => void downloadIntakeFile(intakeTarget!.id, f.index)} className="ml-3 shrink-0 font-medium text-brand-link hover:underline">
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => (busyId ? undefined : setDeleteTarget(null))}
        title={`Permanently delete ${deleteTarget?.name ?? ""}?`}
        subtitle="This can't be undone. Their account, logins, agent, knowledge base, conversations, leads, billing history and uploaded files are all erased. To keep their data, use Reactivate or leave them removed."
      >
        <form onSubmit={deleteClient} className="space-y-4">
          <label className="block text-sm">
            <span className="text-foreground/70">
              Type <span className="font-semibold text-foreground">{deleteTarget?.name}</span> to confirm
            </span>
            <input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              autoComplete="off"
              className="mt-1.5 w-full rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-surface-border focus:outline-none focus:ring-danger/50"
            />
          </label>
          <label className="block text-sm">
            <span className="text-foreground/70">Reason (kept on record)</span>
            <textarea
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              rows={2}
              placeholder="e.g. Client asked us to close their account and erase their data"
              className="mt-1.5 w-full rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground ring-1 ring-inset ring-surface-border placeholder:text-foreground/30 focus:outline-none focus:ring-danger/50"
            />
          </label>
          {deleteError ? <p className="text-sm text-danger">{deleteError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)} disabled={busyId === deleteTarget?.id}>
              Keep this client
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={
                busyId === deleteTarget?.id ||
                deleteConfirmName.trim() !== (deleteTarget?.name ?? "").trim() ||
                deleteReason.trim().length < 3
              }
            >
              {busyId === deleteTarget?.id ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </form>
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
              <option value="setup_specialist" className="bg-surface-overlay text-foreground">Setup specialist — manages clients (recommended)</option>
              <option value="platform_admin" className="bg-surface-overlay text-foreground">Platform admin — also manages subscriptions/billing tiers</option>
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

/**
 * Onboarding-pipeline visibility at a glance — which stage a managed
 * client's own agent(s) are actually at, without opening every tenant
 * individually. Summarized to whichever agent is furthest from LIVE,
 * since that's the one blocking this client from actually going live.
 */
function AgentPipelineBadge({ agents }: { agents: { id: string; name: string; status: AgentStatus }[] }) {
  if (agents.length === 0) return <Badge tone="neutral">No agent yet</Badge>;
  const earliest = agents.reduce((a, b) => (AGENT_STATUS_ORDER.indexOf(a.status) <= AGENT_STATUS_ORDER.indexOf(b.status) ? a : b));
  return (
    <Badge tone={AGENT_STATUS_TONE[earliest.status]}>
      {AGENT_STATUS_LABEL[earliest.status]}
      {agents.length > 1 ? ` (${agents.length} agents)` : ""}
    </Badge>
  );
}
