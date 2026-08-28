"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, Button, AgentStatusBadge, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface Agent {
  id: string;
  name: string;
  status: string;
}

export default function AgentsPage() {
  const { user } = useAuth();
  const isStaff = user?.role === "setup_specialist" || user?.role === "platform_admin";
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("Hi! How can I help you today?");

  function refresh() {
    if (!user) return;
    api
      .listAgents(user.tenantId)
      .then((data) => setAgents(data as Agent[]))
      .catch((err) => {
        setAgents([]);
        setError(err instanceof ApiError ? err.message : "Could not load agents.");
      });
  }

  useEffect(refresh, [user]);

  // One agent per client (CLAUDE.md: "configure each client's AI employee
  // separately") — the backend now rejects a second create outright, so
  // hide the option once one already exists rather than let staff hit
  // that error.
  const canCreateAgent = isStaff && agents !== null && agents.length === 0;

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    setError(null);
    try {
      await api.createAgent(user.tenantId, {
        name,
        personality: {
          tone: "friendly",
          name,
          greeting,
          languagePrimary: "en",
          languagesSupported: ["en"],
          systemInstructions: `You are ${name}, an AI assistant for this business. Answer only from the knowledge base and be honest when you don't know something.`,
        },
      });
      setCreating(false);
      setName("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create agent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Agents</h1>
          <p className="mt-1 text-sm text-foreground/50">Each agent is a separately configured AI employee.</p>
        </div>
        {canCreateAgent ? <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New agent"}</Button> : null}
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {isStaff && agents !== null && agents.length > 0 ? (
        <p className="text-xs text-foreground/40">This client already has an agent — delete it first if you need to start over.</p>
      ) : null}

      {canCreateAgent && creating ? (
        <Card className="animate-fade-up">
          <CardBody>
            <form onSubmit={onCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Agent name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full max-w-sm rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
                  placeholder="e.g. Ava"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground/60">Greeting</label>
                <input
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-foreground/10 bg-foreground/5 px-3 py-2 text-sm text-foreground outline-none focus:border-brand-500"
                />
              </div>
              <Button type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create agent"}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="All agents" subtitle={agents ? `${agents.length} configured` : undefined} />
        {agents === null ? (
          <CardRowSkeleton rows={4} />
        ) : (
          <CardBody className="divide-y divide-surface-border p-0">
            {agents.length === 0 ? (
              <p className="px-5 py-6 text-sm text-foreground/40">No agents yet.</p>
            ) : (
              agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex items-center justify-between px-5 py-3.5 text-sm transition-colors hover:bg-foreground/[0.03]"
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
