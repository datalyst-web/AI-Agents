"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardBody, CardHeader, Badge, Button, Modal, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Tool {
  id: string;
  name: string;
  description: string;
  category: string;
  executionTier: string;
  enabled: boolean;
}

const TIER_TONE = { automatic: "success", confirmation_required: "warning", human_approval: "danger" } as const;
const CATEGORIES = ["search_knowledge", "search_database", "crm", "calendar", "email", "webhook", "api", "ticketing", "inventory", "orders", "custom"];
const TIERS = [
  { value: "automatic", label: "Automatic — low risk only" },
  { value: "confirmation_required", label: "Confirmation required — asks the customer first" },
  { value: "human_approval", label: "Human approval — staff must approve" },
];

export default function ToolsPage() {
  const { user } = useAuth();
  const [tools, setTools] = useState<Tool[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyToolId, setBusyToolId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState(CATEGORIES[3]);
  const [executionTier, setExecutionTier] = useState(TIERS[1]!.value);
  const [credentialValue, setCredentialValue] = useState("");

  function refresh() {
    if (!user) return;
    api
      .listTools(user.tenantId)
      .then((d) => setTools(d as Tool[]))
      .catch((err) => {
        setTools([]);
        setError(err instanceof ApiError ? err.message : "Could not load tools.");
      });
  }
  useEffect(refresh, [user]);

  function resetForm() {
    setName("");
    setDescription("");
    setCategory(CATEGORIES[3]!);
    setExecutionTier(TIERS[1]!.value);
    setCredentialValue("");
    setError(null);
  }

  async function createTool(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await api.createTool(user.tenantId, {
        name,
        description,
        category,
        executionTier,
        inputSchema: {},
        outputSchema: {},
        ...(credentialValue ? { credentialValue } : {}),
      });
      setModalOpen(false);
      resetForm();
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create tool.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(tool: Tool) {
    if (!user) return;
    setBusyToolId(tool.id);
    setError(null);
    try {
      await api.updateTool(user.tenantId, tool.id, { enabled: !tool.enabled });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this tool.");
    } finally {
      setBusyToolId(null);
    }
  }

  async function removeTool(toolId: string) {
    if (!user) return;
    setBusyToolId(toolId);
    setError(null);
    try {
      await api.deleteTool(user.tenantId, toolId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove this tool.");
    } finally {
      setBusyToolId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tools & Integrations</h1>
          <p className="mt-1 text-sm text-foreground/50">
            What your agents are allowed to do — CRM, calendar, email, webhooks. Confirmation-gated actions always ask the customer before executing; human-approval actions wait for your team.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>+ Add tool</Button>
      </div>
      {error && !modalOpen ? <p className="text-xs text-danger">{error}</p> : null}

      <Card>
        <CardHeader title="Configured tools" subtitle={tools ? `${tools.length} tool${tools.length === 1 ? "" : "s"}` : undefined} />
        {tools === null ? (
          <CardRowSkeleton />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {tools.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
                <p className="text-sm text-foreground/50">No tools configured yet.</p>
                <button onClick={() => setModalOpen(true)} className="text-xs font-medium text-brand-link hover:underline">
                  Add your first tool →
                </button>
              </div>
            ) : (
              tools.map((tool) => (
                <div key={tool.id} className={`flex items-center justify-between px-5 py-3.5 text-sm ${tool.enabled ? "" : "opacity-50"}`}>
                  <div>
                    <div className="text-foreground">{tool.name}</div>
                    <div className="text-xs text-foreground/40">{tool.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="neutral">{tool.category}</Badge>
                    <Badge tone={TIER_TONE[tool.executionTier as keyof typeof TIER_TONE] ?? "neutral"}>
                      {tool.executionTier.replace(/_/g, " ")}
                    </Badge>
                    <button
                      onClick={() => toggleEnabled(tool)}
                      disabled={busyToolId === tool.id}
                      className="text-xs font-medium text-foreground/40 transition-colors hover:text-foreground/70 disabled:opacity-50"
                    >
                      {tool.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => removeTool(tool.id)}
                      disabled={busyToolId === tool.id}
                      className="text-xs font-medium text-foreground/30 transition-colors hover:text-danger disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Add a tool" subtitle="Give an agent a new capability, gated by an execution tier.">
        <form onSubmit={createTool} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Book appointment"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Description</label>
            <textarea
              required
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this tool does and when the agent should use it"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c} className="bg-surface-overlay text-foreground">
                    {c.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground/60">Execution tier</label>
              <select
                value={executionTier}
                onChange={(e) => setExecutionTier(e.target.value)}
                className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400"
              >
                {TIERS.map((t) => (
                  <option key={t.value} value={t.value} className="bg-surface-overlay text-foreground">
                    {t.value}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-foreground/35">{TIERS.find((t) => t.value === executionTier)?.label}</p>
          <div>
            <label className="mb-1 block text-xs font-medium text-foreground/60">Credential / API key (optional)</label>
            <input
              type="password"
              value={credentialValue}
              onChange={(e) => setCredentialValue(e.target.value)}
              placeholder="Stored encrypted, never shown again"
              className="w-full rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2.5 text-sm text-foreground outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
            />
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add tool"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
