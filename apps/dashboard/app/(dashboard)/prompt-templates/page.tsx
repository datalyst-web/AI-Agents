"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Template {
  id: string;
  name: string;
  description: string;
  systemInstructions: string;
  guardrailPolicy: string;
  isDefault: boolean;
}

/**
 * Starting-point templates staff reference/copy from while configuring a
 * new client's agent under Managed Setup — never applied automatically to
 * any tenant/agent.
 */
export default function PromptTemplatesPage() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemInstructions, setSystemInstructions] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Template | null>(null);

  function refresh() {
    if (!user) return;
    api
      .listPromptTemplates()
      .then(setTemplates)
      .catch((err) => {
        setTemplates([]);
        setError(err instanceof ApiError ? err.message : "Could not load prompt templates.");
      });
  }
  useEffect(refresh, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.createPromptTemplate({ name, description, systemInstructions, isDefault });
      setModalOpen(false);
      setName("");
      setDescription("");
      setSystemInstructions("");
      setIsDefault(false);
      refresh();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create this template.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.deletePromptTemplate(id);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this template.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be denied silently — not worth surfacing an error for.
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Prompt Templates</h1>
          <p className="mt-1 text-sm text-foreground/50">
            Starting points to copy from while configuring a new client&apos;s agent — never applied automatically.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ New template</Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Templates" subtitle={templates ? `${templates.length} template${templates.length === 1 ? "" : "s"}` : undefined} />
        {templates === null ? (
          <CardRowSkeleton rows={3} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {templates.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-foreground/40">No prompt templates yet.</p>
            ) : (
              templates.map((t) => (
                <div key={t.id} className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-3.5 text-sm">
                  <div className="min-w-0 flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">{t.name}</span>
                      {t.isDefault ? <Badge tone="brand">Default</Badge> : null}
                    </div>
                    {t.description ? <p className="mt-0.5 text-xs text-foreground/50">{t.description}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => setViewing(t)} className="text-xs font-medium text-brand-link hover:text-brand-link-hover">
                      View
                    </button>
                    <button
                      onClick={() => remove(t.id)}
                      disabled={busyId === t.id}
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

      <Modal open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.name ?? ""} subtitle={viewing?.guardrailPolicy}>
        <div className="space-y-3">
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-foreground/5 p-3 text-xs text-foreground/80">
            {viewing?.systemInstructions}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => viewing && copyToClipboard(viewing.systemInstructions)}>
              Copy
            </Button>
            <Button variant="ghost" onClick={() => setViewing(null)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New prompt template">
        <form onSubmit={submit} className="space-y-3">
          {formError ? <p className="text-xs text-danger">{formError}</p> : null}
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
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Good starting point for service businesses"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">System instructions</label>
            <textarea
              required
              rows={8}
              value={systemInstructions}
              onChange={(e) => setSystemInstructions(e.target.value)}
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 font-mono text-xs text-foreground outline-none focus:border-brand-400"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-foreground/60">
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
            Mark as default starting point
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create template"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
