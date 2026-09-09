"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Flag {
  id: string;
  key: string;
  name: string;
  description: string;
  enabledTiers: string[];
}

const TIERS = ["STARTER", "GROWTH", "SCALE", "ENTERPRISE"] as const;

/**
 * Which plan tiers get which features — management surface only. Nothing
 * in the product actually reads these yet to gate a real code path; this
 * ships the control surface staff need first.
 */
export default function FeatureFlagsPage() {
  const { user } = useAuth();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tiers, setTiers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listFeatureFlags()
      .then(setFlags)
      .catch((err) => {
        setFlags([]);
        setError(err instanceof ApiError ? err.message : "Could not load feature flags.");
      });
  }
  useEffect(refresh, [user]);

  function toggleTier(t: string) {
    setTiers((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.createFeatureFlag({ key, name, description, enabledTiers: tiers });
      setModalOpen(false);
      setKey("");
      setName("");
      setDescription("");
      setTiers([]);
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create this flag.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleFlagTier(flag: Flag, t: string) {
    setBusyId(flag.id);
    setError(null);
    try {
      const enabledTiers = flag.enabledTiers.includes(t) ? flag.enabledTiers.filter((x) => x !== t) : [...flag.enabledTiers, t];
      await api.updateFeatureFlag(flag.id, { enabledTiers });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this flag.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.deleteFeatureFlag(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this flag.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Feature Flags</h1>
          <p className="mt-1 text-sm text-foreground/50">Which plan tiers get which features.</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New flag</Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Flags" subtitle={flags ? `${flags.length} flag${flags.length === 1 ? "" : "s"}` : undefined} />
        {flags === null ? (
          <CardRowSkeleton rows={3} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {flags.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No feature flags yet.</p>
            ) : (
              flags.map((f) => (
                <div key={f.id} className="flex flex-col gap-2 px-5 py-3.5 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">{f.name}</span>
                      <span className="font-mono text-[11px] text-foreground/35">{f.key}</span>
                    </div>
                    {f.description ? <p className="mt-0.5 text-xs text-foreground/50">{f.description}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {TIERS.map((t) => (
                      <button
                        key={t}
                        disabled={busyId === f.id}
                        onClick={() => toggleFlagTier(f, t)}
                        className="disabled:opacity-50"
                      >
                        <Badge tone={f.enabledTiers.includes(t) ? "brand" : "neutral"}>{t.toLowerCase()}</Badge>
                      </button>
                    ))}
                    <button
                      onClick={() => remove(f.id)}
                      disabled={busyId === f.id}
                      className="ml-1.5 text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
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

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New feature flag" subtitle="Toggle which plan tiers a feature is enabled for.">
        <form onSubmit={submit} className="space-y-3">
          {formError ? <p className="text-xs text-danger">{formError}</p> : null}
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Key</label>
            <input
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. voice_channel"
              pattern="[a-z0-9_]+"
              title="lowercase letters, numbers, underscores only"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Enabled for</label>
            <div className="flex flex-wrap gap-1.5">
              {TIERS.map((t) => (
                <button key={t} type="button" onClick={() => toggleTier(t)}>
                  <Badge tone={tiers.includes(t) ? "brand" : "neutral"}>{t.toLowerCase()}</Badge>
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create flag"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
