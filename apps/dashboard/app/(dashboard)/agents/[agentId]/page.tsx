"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Card, CardHeader, CardBody, Button, AgentStatusBadge, StatTile, ContentSourceTag, LineChart, BarBreakdown, CardRowSkeleton } from "@chat-agent/ui";
import { useAuth } from "@/lib/auth";
import { api, ApiError } from "@/lib/api";

interface AgentDetail {
  id: string;
  name: string;
  status: string;
  version: string;
  personality: { name: string; greeting: string; systemInstructions: string; tone: string };
}
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

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Test Agent");
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [dailyAnalytics, setDailyAnalytics] = useState<DailyAnalytics[] | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    if (user) api.getAgent(user.tenantId, agentId).then((data) => setAgent(data as AgentDetail));
  }
  function refreshKnowledge() {
    if (user) api.listKnowledge(user.tenantId, agentId).then((data) => setKnowledge(data as KnowledgeSource[]));
  }

  useEffect(refreshAgent, [user, agentId]);
  useEffect(() => {
    if (!user) return;
    if (tab === "Knowledge") refreshKnowledge();
    if (tab === "Conversations") {
      setConversationsLoading(true);
      api
        .listConversations(user.tenantId, agentId)
        .then((d) => setConversations(d as Conversation[]))
        .finally(() => setConversationsLoading(false));
    }
    if (tab === "Analytics") {
      api.getAnalytics(user.tenantId, agentId).then((d) => setAnalytics(d as Analytics));
      api.getAnalyticsDaily(user.tenantId, agentId, 14).then(setDailyAnalytics);
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

  async function publish() {
    if (!user) return;
    setError(null);
    try {
      await api.publishAgent(user.tenantId, agentId);
      refreshAgent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
    }
  }

  async function approve() {
    if (!user) return;
    setError(null);
    try {
      await api.approveAgent(user.tenantId, agentId);
      refreshAgent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Approve failed.");
    }
  }

  async function addFaq(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    await api.addFaq(user.tenantId, agentId, [{ question: faqQ, answer: faqA }]);
    setFaqQ("");
    setFaqA("");
    refreshKnowledge();
  }

  async function crawl(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    await api.crawlWebsite(user.tenantId, agentId, [crawlUrl]);
    setCrawlUrl("");
    refreshKnowledge();
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
          {agent.status === "TESTING" ? <Button variant="secondary" onClick={approve}>Approve for launch</Button> : null}
          {agent.status === "APPROVED" ? <Button onClick={publish}>Publish to Live</Button> : null}
        </div>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}

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
      ) : null}

      {tab === "Knowledge" ? (
        <div className="space-y-4">
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
                    <span className="text-xs text-white/40">{k.status}</span>
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
