"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardBody, Button, AgentStatusBadge, StatTile, ContentSourceTag, LineChart, BarBreakdown, CardRowSkeleton, Modal } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface AgentDetail {
  id: string;
  name: string;
  status: string;
  version: string;
  personality: { name: string; greeting: string; systemInstructions: string; tone: string };
  modelRouting: {
    preferredProvider: "anthropic" | "openai" | "gemini";
    anthropicModelTier: "haiku" | "sonnet" | "opus";
    reasoningEffort: "low" | "medium" | "high";
  };
}

const ANTHROPIC_TIER_LABELS: Record<string, string> = {
  haiku: "Haiku — fastest, most affordable",
  sonnet: "Sonnet — balanced (recommended)",
  opus: "Opus — most capable, highest cost",
};
interface KnowledgeSource {
  id: string;
  type: string;
  status: string;
  originalFilename?: string;
  sourceUrl?: string;
  addedBySource: "CLIENT" | "STAFF_MANAGED_SETUP";
}
interface Conversation {
  id: string;
  outcome: string;
  startedAt: string;
}
interface Analytics {
  total: number;
  byOutcome: Record<string, number>;
  byDropOff: Record<string, number>;
  avgSentiment: number;
}
interface DailyAnalytics {
  date: string;
  conversations: number;
  avgSentiment: number | null;
}
interface VersionSnapshot {
  id: string;
  version: string;
  status: string;
  publishedAt: string;
}

const OUTCOME_TONE = {
  RESOLVED: "success",
  ESCALATED_TO_HUMAN: "warning",
  ABANDONED: "danger",
  IN_PROGRESS: "info",
} as const;

const TABS = ["Test Agent", "Configuration", "Knowledge", "Conversations", "Analytics"] as const;

interface TestMessage {
  id: string;
  role: "customer" | "agent" | "system";
  text: string;
}
interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  confirmationPrompt: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const WIDGET_SCRIPT_URL = process.env.NEXT_PUBLIC_WIDGET_SCRIPT_URL ?? "http://localhost:3000/widget.js";

const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  staff_cannot_approve_on_clients_behalf:
    "Only the client can approve this stage — log in as the client's own account to approve, or delegate auto-publish authority in this tenant's account settings.",
  no_active_impersonation_session: "Your Managed Setup session isn't active — start a new session from the Managed Setup queue.",
  impersonation_session_not_active: "Your Managed Setup session has ended or expired — start a new session from the Managed Setup queue.",
};

function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return KNOWN_ERROR_MESSAGES[err.message] ?? err.message;
  return fallback;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-xs text-white/70">
        {value}
      </code>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-lg bg-white/5 px-3 py-2.5 text-xs font-medium text-white/70 ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/10 hover:text-white"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const { user, impersonation } = useAuth();
  const [dashboardOrigin, setDashboardOrigin] = useState("");
  useEffect(() => setDashboardOrigin(window.location.origin), []);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Test Agent");
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const [deletingKnowledgeId, setDeletingKnowledgeId] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [resolvingConversationId, setResolvingConversationId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [dailyAnalytics, setDailyAnalytics] = useState<DailyAnalytics[] | null>(null);
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [rollingBackTo, setRollingBackTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentLoadError, setAgentLoadError] = useState<string | null>(null);
  const [faqQ, setFaqQ] = useState("");
  const [faqA, setFaqA] = useState("");
  const [crawlUrl, setCrawlUrl] = useState("");

  const [testMessages, setTestMessages] = useState<TestMessage[]>([]);
  const [testConversationId, setTestConversationId] = useState<string | undefined>(undefined);
  const [testInput, setTestInput] = useState("");
  const [testSending, setTestSending] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const testScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    testScrollRef.current?.scrollTo({ top: testScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [testMessages, testSending]);

  async function sendTestMessage(text: string, confirmToolCallId?: string) {
    if (!user || !agent) return;
    setTestError(null);
    if (text) setTestMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "customer", text }]);
    setPendingConfirmation(null);
    setTestSending(true);
    try {
      const result = await api.sendTestMessage(user.tenantId, agentId, {
        message: text || "(confirmed the pending action)",
        conversationId: testConversationId,
        confirmToolCallId,
      });
      setTestConversationId(result.conversationId);
      if (result.reply) setTestMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: result.reply }]);
      if (result.pendingConfirmation) {
        setPendingConfirmation({
          toolCallId: result.pendingConfirmation.toolCallId,
          toolName: result.pendingConfirmation.toolName,
          confirmationPrompt: result.pendingConfirmation.confirmationPrompt,
        });
      }
      if (result.handoffTriggered) {
        setTestMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "system", text: "This turn would trigger a human handoff." },
        ]);
      }
    } catch (err) {
      setTestError(
        err instanceof ApiError
          ? err.message
          : "The agent must be in TESTING or LIVE status to chat with it — save your instructions and move it to Testing first.",
      );
    } finally {
      setTestSending(false);
    }
  }

  function onTestSubmit(e: FormEvent) {
    e.preventDefault();
    const text = testInput.trim();
    if (!text || testSending) return;
    setTestInput("");
    void sendTestMessage(text);
  }

  function resetTestConversation() {
    setTestMessages([]);
    setTestConversationId(undefined);
    setPendingConfirmation(null);
    setTestError(null);
  }

  function refreshAgent() {
    if (!user) return;
    setAgentLoadError(null);
    api
      .getAgent(user.tenantId, agentId)
      .then((data) => setAgent(data as AgentDetail))
      .catch((err) => setAgentLoadError(err instanceof ApiError ? err.message : "Could not load this agent."));
  }
  function refreshKnowledge() {
    if (!user) return;
    api
      .listKnowledge(user.tenantId, agentId)
      .then((data) => setKnowledge(data as KnowledgeSource[]))
      .catch((err) => setKnowledgeError(err instanceof ApiError ? err.message : "Could not load knowledge sources."));
  }

  function refreshConversations() {
    if (!user) return;
    setConversationsLoading(true);
    api
      .listConversations(user.tenantId, agentId)
      .then((d) => setConversations(d as Conversation[]))
      .catch(() => setConversations([]))
      .finally(() => setConversationsLoading(false));
  }

  async function resolveConversation(conversationId: string) {
    if (!user) return;
    setResolvingConversationId(conversationId);
    try {
      await api.resolveConversation(user.tenantId, conversationId);
      refreshConversations();
    } catch {
      // Non-fatal — the row just keeps its current outcome; the button
      // reappears on retry rather than needing a dedicated error banner.
    } finally {
      setResolvingConversationId(null);
    }
  }

  useEffect(refreshAgent, [user, agentId]);
  useEffect(() => {
    if (!user) return;
    if (tab === "Knowledge") refreshKnowledge();
    if (tab === "Configuration")
      api
        .listAgentVersions(user.tenantId, agentId)
        .then(setVersions)
        .catch(() => setVersions([]));
    if (tab === "Conversations") refreshConversations();
    if (tab === "Analytics") {
      api
        .getAnalytics(user.tenantId, agentId)
        .then((d) => setAnalytics(d as Analytics))
        .catch(() => setAnalytics(null));
      api
        .getAnalyticsDaily(user.tenantId, agentId, 14)
        .then(setDailyAnalytics)
        .catch(() => setDailyAnalytics([]));
    }
  }, [tab, user, agentId]);

  async function saveInstructions(e: FormEvent) {
    e.preventDefault();
    if (!user || !agent) return;
    setError(null);
    try {
      await api.updateAgent(user.tenantId, agentId, { personality: { systemInstructions: agent.personality.systemInstructions } });
      refreshAgent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  async function saveModelRouting() {
    if (!user || !agent) return;
    setError(null);
    try {
      await api.updateAgent(user.tenantId, agentId, { modelRouting: agent.modelRouting });
      refreshAgent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Save failed.");
    }
  }

  async function rollback(toVersion: string) {
    if (!user) return;
    setError(null);
    setRollingBackTo(toVersion);
    try {
      await api.rollbackAgent(user.tenantId, agentId, toVersion);
      refreshAgent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Rollback failed.");
    } finally {
      setRollingBackTo(null);
    }
  }

  async function deleteAgent() {
    if (!user) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAgent(user.tenantId, agentId);
      router.push("/agents");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete agent.");
      setDeleting(false);
      setDeleteModalOpen(false);
    }
  }

  async function startTesting() {
    if (!user) return;
    setError(null);
    try {
      await api.startTesting(user.tenantId, agentId);
      refreshAgent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to start testing.");
    }
  }

  async function publish() {
    if (!user) return;
    setError(null);
    try {
      await api.publishAgent(user.tenantId, agentId);
      refreshAgent();
    } catch (err) {
      setError(friendlyError(err, "Publish failed."));
    }
  }

  async function approve() {
    if (!user) return;
    setError(null);
    try {
      await api.approveAgent(user.tenantId, agentId);
      refreshAgent();
    } catch (err) {
      setError(friendlyError(err, "Approve failed."));
    }
  }

  async function addFaq(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setKnowledgeError(null);
    try {
      await api.addFaq(user.tenantId, agentId, [{ question: faqQ, answer: faqA }]);
      setFaqQ("");
      setFaqA("");
      refreshKnowledge();
    } catch (err) {
      setKnowledgeError(err instanceof ApiError ? err.message : "Failed to add FAQ.");
    }
  }

  async function crawl(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setKnowledgeError(null);
    try {
      await api.crawlWebsite(user.tenantId, agentId, [crawlUrl]);
      setCrawlUrl("");
      refreshKnowledge();
    } catch (err) {
      setKnowledgeError(err instanceof ApiError ? err.message : "Failed to start crawl.");
    }
  }

  async function removeKnowledge(knowledgeSourceId: string) {
    if (!user) return;
    setKnowledgeError(null);
    setDeletingKnowledgeId(knowledgeSourceId);
    try {
      await api.deleteKnowledge(user.tenantId, knowledgeSourceId);
      refreshKnowledge();
    } catch (err) {
      setKnowledgeError(err instanceof ApiError ? err.message : "Failed to remove.");
    } finally {
      setDeletingKnowledgeId(null);
    }
  }

  if (!agent && agentLoadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-danger">{agentLoadError}</p>
        <Button variant="secondary" onClick={refreshAgent}>
          Retry
        </Button>
      </div>
    );
  }
  if (!agent) return <p className="text-sm text-white/40">Loading...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-white">{agent.name}</h1>
          <AgentStatusBadge status={agent.status} />
          <span className="text-xs text-white/30">{agent.version}</span>
        </div>
        <div className="flex gap-2">
          {["DRAFT", "CONFIGURING", "KNOWLEDGE_PROCESSING"].includes(agent.status) ? (
            <Button onClick={startTesting}>Start Testing</Button>
          ) : null}
          {agent.status === "TESTING" ? (
            <Button
              variant="secondary"
              onClick={approve}
              disabled={Boolean(impersonation)}
              title={impersonation ? "Only the client can approve this stage — see the note below." : undefined}
            >
              Approve for launch
            </Button>
          ) : null}
          {agent.status === "APPROVED" ? <Button onClick={publish}>Publish to Live</Button> : null}
          {agent.status !== "LIVE" ? (
            <Button variant="ghost" className="!text-danger hover:!bg-danger/10" onClick={() => setDeleteModalOpen(true)}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      {agent.status === "TESTING" && impersonation ? (
        <p className="text-xs text-white/40">
          Only <span className="text-white/70">{impersonation.tenantName}</span> can approve this stage — ask them to log in
          and approve, or have them delegate auto-publish authority in their account settings if that's already agreed.
        </p>
      ) : null}
      {agent.status === "DRAFT" ? (
        <p className="text-xs text-white/40">
          Save your instructions and add some knowledge below, then click <span className="text-white/70">Start Testing</span> to unlock the Test Agent tab.
        </p>
      ) : null}

      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title={`Delete ${agent.name}?`}
        subtitle="This permanently removes the agent, its knowledge base, and its conversation history. This cannot be undone."
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleteModalOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={deleteAgent} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </Modal>

      <div className="flex gap-1 border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${tab === t ? "border-b-2 border-brand-500 text-white" : "text-white/40 hover:text-white/70"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Test Agent" ? (
        <Card>
          <CardHeader
            title="Live test conversation"
            subtitle={
              agent.status === "LIVE" || agent.status === "TESTING"
                ? "Talk to this agent exactly as a customer would — nothing here is scripted."
                : `Testing chat unlocks once this agent reaches TESTING status (currently ${agent.status.replace(/_/g, " ")}).`
            }
            action={
              testMessages.length > 0 ? (
                <button onClick={resetTestConversation} className="text-xs font-medium text-white/40 hover:text-white/70">
                  Reset conversation
                </button>
              ) : null
            }
          />
          <CardBody className="p-0">
            <div ref={testScrollRef} className="flex h-[28rem] flex-col gap-3 overflow-y-auto px-5 py-5">
              {testMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-gradient shadow-glow">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <path d="M2 8a6 6 0 1 1 6 6" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
                      <circle cx="12" cy="12" r="1.4" fill="white" />
                    </svg>
                  </div>
                  <p className="max-w-xs text-sm text-white/45">
                    Say hello to <span className="text-white/80">{agent.name}</span> below to try it out — this uses your
                    real knowledge base, tools, and guardrails.
                  </p>
                </div>
              ) : (
                testMessages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex ${m.role === "customer" ? "justify-end" : "justify-start"}`}
                  >
                    {m.role === "system" ? (
                      <span className="mx-auto rounded-full bg-warning/10 px-3 py-1 text-[11px] font-medium text-warning ring-1 ring-inset ring-warning/25">
                        {m.text}
                      </span>
                    ) : (
                      <span
                        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                          m.role === "customer"
                            ? "rounded-br-md bg-brand-gradient text-white"
                            : "rounded-bl-md bg-white/[0.06] text-white/90 ring-1 ring-inset ring-white/10"
                        }`}
                      >
                        {m.text}
                      </span>
                    )}
                  </div>
                ))
              )}
              {testSending ? (
                <div className="flex justify-start">
                  <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-white/[0.06] px-3.5 py-3 ring-1 ring-inset ring-white/10">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50 [animation-delay:0.15s]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white/50 [animation-delay:0.3s]" />
                  </span>
                </div>
              ) : null}
            </div>

            {pendingConfirmation ? (
              <div className="border-t border-warning/25 bg-warning/[0.06] px-5 py-3">
                <p className="mb-2 text-xs text-white/80">{pendingConfirmation.confirmationPrompt}</p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="!bg-success/15 !text-success hover:!bg-success/25"
                    onClick={() => void sendTestMessage("", pendingConfirmation.toolCallId)}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setPendingConfirmation(null);
                      setTestMessages((prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), role: "system", text: "Action cancelled in this test conversation." },
                      ]);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            {testError ? <p className="border-t border-surface-border px-5 py-2 text-xs text-danger">{testError}</p> : null}

            <form onSubmit={onTestSubmit} className="flex gap-2 border-t border-surface-border p-3">
              <input
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder="Type a message to test the agent..."
                disabled={testSending}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none transition-colors focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20"
              />
              <Button type="submit" disabled={testSending || !testInput.trim()}>
                Send
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {tab === "Configuration" ? (
        <div className="space-y-4">
          {agent.status === "LIVE" ? (
            <Card>
              <CardHeader title="Deploy" subtitle="Your agent is live — add it to your site, or share its own page." />
              <CardBody className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-white/60">Website embed</label>
                  <CopyField
                    value={`<script src="${WIDGET_SCRIPT_URL}" data-agent-id="${agent.id}" data-api-base="${API_BASE_URL}"></script>`}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-white/60">Standalone link</label>
                  <CopyField value={`${dashboardOrigin}/client-agent/${agent.id}`} />
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Instructions" subtitle="What this agent knows to do and how it should behave." />
            <CardBody>
              <form onSubmit={saveInstructions} className="space-y-3">
                <textarea
                  value={agent.personality.systemInstructions}
                  onChange={(e) => setAgent({ ...agent, personality: { ...agent.personality, systemInstructions: e.target.value } })}
                  rows={8}
                  className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white outline-none focus:border-brand-500"
                />
                <Button type="submit">Save changes</Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="AI Model" subtitle="Which model powers this agent's responses. Anthropic Claude is the default — the most reliable choice for accuracy and instruction-following." />
            <CardBody className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-white/60">Provider</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["anthropic", "openai", "gemini"] as const).map((provider) => (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => setAgent({ ...agent, modelRouting: { ...agent.modelRouting, preferredProvider: provider } })}
                      className={`rounded-lg border px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
                        agent.modelRouting.preferredProvider === provider
                          ? "border-brand-500/50 bg-brand-500/15 text-white"
                          : "border-white/10 bg-white/5 text-white/60 hover:text-white/80"
                      }`}
                    >
                      {provider}
                      {provider === "anthropic" ? <span className="ml-1 text-[10px] text-brand-300">default</span> : null}
                    </button>
                  ))}
                </div>
              </div>

              {agent.modelRouting.preferredProvider === "anthropic" ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-white/60">Claude model</label>
                  <select
                    value={agent.modelRouting.anthropicModelTier}
                    onChange={(e) =>
                      setAgent({
                        ...agent,
                        modelRouting: { ...agent.modelRouting, anthropicModelTier: e.target.value as AgentDetail["modelRouting"]["anthropicModelTier"] },
                      })
                    }
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-brand-500"
                  >
                    {(["haiku", "sonnet", "opus"] as const).map((tier) => (
                      <option key={tier} value={tier} className="bg-surface-raised">
                        {ANTHROPIC_TIER_LABELS[tier]}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-white/40">Which Claude tier depends on your plan — you can change this any time.</p>
                </div>
              ) : null}

              <Button onClick={saveModelRouting}>Save model settings</Button>
            </CardBody>
          </Card>

          {versions.length > 0 ? (
            <Card>
              <CardHeader title="Version history" subtitle="A snapshot is taken every time you publish to Live. Roll back if a change causes problems." />
              <CardBody className="divide-y divide-surface-border p-0">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div>
                      <span className="font-medium text-white">{v.version}</span>
                      <span className="ml-2 text-xs text-white/40">{new Date(v.publishedAt).toLocaleString()}</span>
                    </div>
                    <button
                      onClick={() => rollback(v.version)}
                      disabled={rollingBackTo === v.version}
                      className="text-xs font-medium text-brand-300 transition-colors hover:text-brand-200 disabled:opacity-50"
                    >
                      {rollingBackTo === v.version ? "Rolling back…" : "Roll back to this version"}
                    </button>
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "Knowledge" ? (
        <div className="space-y-4">
          {knowledgeError ? <p className="text-xs text-danger">{knowledgeError}</p> : null}
          <Card>
            <CardHeader title="Add FAQ" />
            <CardBody>
              <form onSubmit={addFaq} className="space-y-2">
                <input
                  required
                  placeholder="Question"
                  value={faqQ}
                  onChange={(e) => setFaqQ(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                />
                <input
                  required
                  placeholder="Answer"
                  value={faqA}
                  onChange={(e) => setFaqA(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                />
                <Button type="submit" variant="secondary">Add FAQ</Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Crawl a website page" />
            <CardBody>
              <form onSubmit={crawl} className="flex gap-2">
                <input
                  required
                  type="url"
                  placeholder="https://example.com/faq"
                  value={crawlUrl}
                  onChange={(e) => setCrawlUrl(e.target.value)}
                  className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
                />
                <Button type="submit" variant="secondary">Crawl</Button>
              </form>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Knowledge sources" />
            <CardBody className="divide-y divide-surface-border p-0">
              {knowledge.length === 0 ? (
                <p className="px-5 py-6 text-sm text-white/40">No knowledge sources yet.</p>
              ) : (
                knowledge.map((k) => (
                  <div key={k.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-white">{k.originalFilename ?? k.sourceUrl ?? k.type}</span>
                      <ContentSourceTag source={k.addedBySource} />
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-white/40">{k.status}</span>
                      <button
                        onClick={() => removeKnowledge(k.id)}
                        disabled={deletingKnowledgeId === k.id}
                        className="text-xs font-medium text-white/30 transition-colors hover:text-danger disabled:opacity-50"
                      >
                        {deletingKnowledgeId === k.id ? "Removing…" : "Remove"}
                      </button>
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === "Conversations" ? (
        <Card>
          <CardHeader title="Recent conversations" subtitle="Outcome tracked per CLAUDE.md's Conversation Analytics & Quality section." />
          {conversationsLoading ? (
            <CardRowSkeleton rows={4} />
          ) : (
            <CardBody className="divide-y divide-surface-border p-0">
              {conversations.length === 0 ? (
                <p className="px-5 py-6 text-sm text-white/40">No conversations yet.</p>
              ) : (
                conversations.map((c) => (
                  <div key={c.id} className="flex items-center justify-between px-5 py-3 text-sm">
                    <span className="text-white/70">{new Date(c.startedAt).toLocaleString()}</span>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-medium ${
                          c.outcome === "RESOLVED"
                            ? "text-success"
                            : c.outcome === "ESCALATED_TO_HUMAN"
                              ? "text-warning"
                              : c.outcome === "ABANDONED"
                                ? "text-danger"
                                : "text-white/40"
                        }`}
                      >
                        {c.outcome.replace(/_/g, " ")}
                      </span>
                      {c.outcome === "IN_PROGRESS" ? (
                        <button
                          onClick={() => resolveConversation(c.id)}
                          disabled={resolvingConversationId === c.id}
                          className="text-xs font-medium text-brand-300 transition-colors hover:text-brand-200 disabled:opacity-50"
                        >
                          {resolvingConversationId === c.id ? "Resolving…" : "Mark resolved"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))
              )}
            </CardBody>
          )}
        </Card>
      ) : null}

      {tab === "Analytics" ? (
        analytics ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatTile label="Total conversations" value={analytics.total} />
              <StatTile label="Resolved" value={analytics.byOutcome.RESOLVED ?? 0} deltaTone="positive" />
              <StatTile label="Escalated" value={analytics.byOutcome.ESCALATED_TO_HUMAN ?? 0} deltaTone="negative" />
              <StatTile label="Avg sentiment" value={analytics.avgSentiment.toFixed(2)} />
            </div>

            <Card>
              <CardHeader title="Sentiment trend" subtitle="Average per-message sentiment score, last 14 days — surfaces a degrading agent before it shows up as lost business." />
              <CardBody>
                {dailyAnalytics ? (
                  dailyAnalytics.some((d) => d.avgSentiment !== null) ? (
                    <LineChart
                      data={dailyAnalytics.map((d) => ({
                        label: new Date(d.date).toLocaleDateString(undefined, { weekday: "short" }),
                        value: d.avgSentiment ?? 0,
                      }))}
                      tone="accent"
                      zeroLine
                      valueFormatter={(v) => v.toFixed(2)}
                    />
                  ) : (
                    <p className="py-6 text-center text-sm text-white/40">Not enough conversation data yet.</p>
                  )
                ) : (
                  <div className="h-[180px] animate-pulse rounded-lg bg-white/[0.03]" />
                )}
              </CardBody>
            </Card>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card>
                <CardHeader title="Outcome breakdown" />
                <CardBody>
                  {Object.keys(analytics.byOutcome).length === 0 ? (
                    <p className="py-4 text-center text-sm text-white/40">No conversations yet.</p>
                  ) : (
                    <BarBreakdown
                      items={Object.entries(analytics.byOutcome).map(([outcome, count]) => ({
                        label: outcome.replace(/_/g, " "),
                        value: count,
                        tone: OUTCOME_TONE[outcome as keyof typeof OUTCOME_TONE] ?? "neutral",
                      }))}
                    />
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Drop-off point" subtitle="Where customers disengage." />
                <CardBody>
                  {Object.keys(analytics.byDropOff ?? {}).length === 0 ? (
                    <p className="py-4 text-center text-sm text-white/40">No drop-offs recorded.</p>
                  ) : (
                    <BarBreakdown
                      items={Object.entries(analytics.byDropOff).map(([point, count]) => ({
                        label: point.replace(/_/g, " ").toLowerCase(),
                        value: count,
                        tone: point === "NONE" ? "success" : "warning",
                      }))}
                    />
                  )}
                </CardBody>
              </Card>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Total conversations" value="—" />
            <StatTile label="Resolved" value="—" />
            <StatTile label="Escalated" value="—" />
            <StatTile label="Avg sentiment" value="—" />
          </div>
        )
      ) : null}
    </div>
  );
}
