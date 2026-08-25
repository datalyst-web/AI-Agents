"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Card, CardBody, CardHeader, Button, AgentStatusBadge, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";

interface Agent {
  id: string;
  name: string;
  status: string;
}

export default function AgentsPage() {
  const { user } = useAuth();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("Hi! How can I help you today?");

  function refresh() {
    if (user) api.listAgents(user.tenantId).then((data) => setAgents(data as Agent[]));
  }

  useEffect(refresh, [user]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
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
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Agents</h1>
          <p className="mt-1 text-sm text-white/50">Each agent is a separately configured AI employee.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>{creating ? "Cancel" : "New agent"}</Button>
      </div>

      {creating ? (
        <Card className="animate-fade-up">
          <CardBody>
            <form onSubmit={onCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60">Agent name</label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full max-w-sm rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                  placeholder="e.g. Ava"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60">Greeting</label>
                <input
                  value={greeting}
                  onChange={(e) => setGreeting(e.target.value)}
                  className="w-full max-w-md rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                />
              </div>
              <Button type="submit">Create agent</Button>
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
              <p className="px-5 py-6 text-sm text-white/40">No agents yet.</p>
            ) : (
              agents.map((agent) => (
                <Link
                  key={agent.id}
                  href={`/agents/${agent.id}`}
                  className="flex items-center justify-between px-5 py-3.5 text-sm transition-colors hover:bg-white/[0.03]"
                >
                  <span className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-gradient-soft text-xs font-semibold text-brand-200 ring-1 ring-inset ring-brand-500/20">
                      {agent.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-white">{agent.name}</span>
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
