"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError, API_BASE } from "@/lib/api";

interface Preset {
  id: string;
  name: string;
  brandName: string;
  logoUrl: string | null;
}

/**
 * A reusable white-label identity staff can apply to a tenant in one
 * click — e.g. an agency reseller's own consistent brand across many of
 * their own sub-clients. Applying a preset to a specific tenant happens
 * from that tenant's own Branding editor in Managed Setup, not here.
 */
export default function BrandingPresetsPage() {
  const { user } = useAuth();
  const [presets, setPresets] = useState<Preset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [brandName, setBrandName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [pendingLogoFor, setPendingLogoFor] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listBrandingPresets()
      .then(setPresets)
      .catch((err) => {
        setPresets([]);
        setError(err instanceof ApiError ? err.message : "Could not load branding presets.");
      });
  }
  useEffect(refresh, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.createBrandingPreset(name, brandName);
      setModalOpen(false);
      setName("");
      setBrandName("");
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create this preset.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(id: string, file: File) {
    setBusyId(id);
    setError(null);
    try {
      await api.uploadBrandingPresetLogo(id, file);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not upload that logo.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.deleteBrandingPreset(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this preset.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Branding Presets</h1>
          <p className="mt-1 text-sm text-foreground/50">
            Reusable white-label identities. Apply one to a specific client from that client&apos;s Branding editor in Managed Setup.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New preset</Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file && pendingLogoFor) void uploadLogo(pendingLogoFor, file);
        }}
      />

      <Card>
        <CardHeader title="Presets" subtitle={presets ? `${presets.length} preset${presets.length === 1 ? "" : "s"}` : undefined} />
        {presets === null ? (
          <CardRowSkeleton rows={2} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {presets.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No branding presets yet.</p>
            ) : (
              presets.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-foreground/5">
                      {p.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`${API_BASE}${p.logoUrl}`} alt="" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-[9px] text-foreground/30">No logo</span>
                      )}
                    </div>
                    <div>
                      <div className="text-foreground">{p.name}</div>
                      <div className="text-xs text-foreground/40">Brand name: {p.brandName}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      onClick={() => {
                        setPendingLogoFor(p.id);
                        logoInputRef.current?.click();
                      }}
                      disabled={busyId === p.id}
                      className="text-xs font-medium text-brand-link hover:text-brand-link-hover disabled:opacity-50"
                    >
                      {busyId === p.id ? "Uploading…" : "Upload logo"}
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      disabled={busyId === p.id}
                      className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New branding preset">
        <form onSubmit={submit} className="space-y-3">
          {formError ? <p className="text-xs text-danger">{formError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Preset name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Reseller Brand"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Console brand name</label>
            <input
              required
              value={brandName}
              onChange={(e) => setBrandName(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create preset"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
