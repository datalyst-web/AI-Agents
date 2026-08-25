/**
 * Standalone, no-Docker demo backend.
 *
 * The real apps/api server needs Postgres + Redis (see server.ts). This
 * script exists purely so the dashboard + a real Gemini-backed agent can be
 * demoed on a machine with neither — it holds tenant/agent/conversation
 * state in memory (lost on restart) instead of Postgres, but every AI reply
 * is a genuine call through the same @chat-agent/ai-provider GeminiProvider
 * the real API uses (CLAUDE.md principle 2: never call a vendor SDK
 * directly outside the AIProvider abstraction — that still holds here).
 *
 * Run with: pnpm --filter @chat-agent/api run demo
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { GeminiProvider } from "@chat-agent/ai-provider";

// ---- load repo-root .env (no dotenv dependency needed) --------------------
const rootDir = path.resolve(fileURLToPath(import.meta.url), "../../../../");
try {
  const content = readFileSync(path.join(rootDir, ".env"), "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
} catch {
  // no .env — fine, GEMINI_API_KEY may already be set in the environment
}

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || "gemini-3.5-flash-lite";
if (!GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY is not set (checked .env and the environment). The demo agent can't reply without it.");
  process.exit(1);
}
const gemini = new GeminiProvider(GEMINI_API_KEY);

// ---- in-memory demo tenant -------------------------------------------------
const TENANT_ID = "demo-tenant";
const USER_ID = "demo-user";

const tenant = { id: TENANT_ID, slug: "solstice-coffee", name: "Solstice Coffee Roasters" };

const FAQS = [
  { q: "What are your hours?", a: "We're open 7am–6pm Monday to Friday, and 8am–4pm on weekends, at all three locations." },
  { q: "Do you offer catering?", a: "Yes — office catering boxes (12/24/36 cups) with 48 hours' notice. Order through the website or in-store." },
  { q: "Is there WiFi?", a: "Free WiFi at every location, network 'Solstice-Guest', no password required." },
  { q: "Do you have oat milk / non-dairy options?", a: "Oat, almond, and soy milk are available at no extra charge on any drink." },
  { q: "Where are you located?", a: "Downtown (5th & Pine), Riverside (12 Harbor Rd), and the Uptown Market kiosk." },
  { q: "Do you sell gift cards?", a: "Yes, physical and digital gift cards from $10–$100, available in-store or online." },
  { q: "What's your loyalty program?", a: "Solstice Circle: 1 point per $1 spent, a free drink at 50 points, sign up free in the app." },
  { q: "Can I book the space for a private event?", a: "The Downtown location has a back room that seats 20, bookable for private events — a $75 deposit holds the date." },
];

interface Agent {
  id: string;
  name: string;
  status: string;
  version: string;
  updatedAt: string;
  personality: { name: string; greeting: string; systemInstructions: string; tone: string };
}

const agents = new Map<string, Agent>([
  [
    "agent-ava",
    {
      id: "agent-ava",
      name: "Ava",
      status: "LIVE",
      version: "v1.2",
      updatedAt: new Date().toISOString(),
      personality: {
        name: "Ava",
        greeting: "Hi! I'm Ava from Solstice Coffee Roasters — how can I help today?",
        tone: "warm, concise, a little playful",
        systemInstructions:
          "You are Ava, the AI employee for Solstice Coffee Roasters, a specialty coffee roaster with three locations. " +
          "Answer only from the knowledge base below — if something isn't covered, say you're not sure and offer to connect the customer with the team. Never invent prices, hours, or policies. " +
          "Keep replies short and friendly, like a real barista texting back.\n\nKnowledge base:\n" +
          FAQS.map((f) => `Q: ${f.q}\nA: ${f.a}`).join("\n\n"),
      },
    },
  ],
  [
    "agent-milo",
    {
      id: "agent-milo",
      name: "Milo",
      status: "DRAFT",
      version: "v0.1",
      updatedAt: new Date().toISOString(),
      personality: {
        name: "Milo",
        greeting: "Hey, I'm Milo — still being configured!",
        tone: "friendly",
        systemInstructions: "You are Milo, a work-in-progress AI employee. Not yet configured.",
      },
    },
  ],
]);

interface KnowledgeItem {
  id: string;
  type: string;
  status: string;
  originalFilename?: string;
  sourceUrl?: string;
  addedBySource: "CLIENT" | "STAFF_MANAGED_SETUP";
}
const knowledge: KnowledgeItem[] = FAQS.map((f, i) => ({
  id: `kb-${i}`,
  type: "faq",
  status: "READY",
  originalFilename: f.q,
  addedBySource: "STAFF_MANAGED_SETUP" as const,
}));

interface ConversationMsg {
  role: "customer" | "agent";
  content: string;
}
interface Conv {
  id: string;
  agentId: string;
  outcome: "IN_PROGRESS" | "RESOLVED" | "ESCALATED_TO_HUMAN" | "ABANDONED";
  dropOffPoint: string;
  startedAt: string;
  sentimentTrend: number[];
  messages: ConversationMsg[];
  pending?: { toolCallId: string; toolName: string; confirmationPrompt: string };
}
const conversations = new Map<string, Conv>();

interface UsageEntry {
  timestamp: string;
  inputTokens: number;
  outputTokens: number;
  provider: "gemini";
}
const usage: UsageEntry[] = [];

interface AuditEntry {
  id: string;
  action: string;
  actorIsStaff: boolean;
  contentSource?: string;
  timestamp: string;
}
const auditLog: AuditEntry[] = [
  { id: randomUUID(), action: "knowledge_base_published", actorIsStaff: true, contentSource: "client-provided intake call", timestamp: daysAgo(6) },
  { id: randomUUID(), action: "agent_configured", actorIsStaff: true, contentSource: "AI Setup Team", timestamp: daysAgo(6) },
  { id: randomUUID(), action: "tool_configured", actorIsStaff: true, contentSource: "AI Setup Team", timestamp: daysAgo(5) },
  { id: randomUUID(), action: "agent_published", actorIsStaff: false, timestamp: daysAgo(4) },
];

const tools = [
  { id: "tool-order-status", name: "Check order status", description: "Looks up an online order by confirmation number.", category: "api", executionTier: "automatic", enabled: true },
  { id: "tool-book-table", name: "Book a table", description: "Reserves the Downtown back room for a private event.", category: "calendar", executionTier: "confirmation_required", enabled: true },
  { id: "tool-issue-refund", name: "Issue a refund", description: "Refunds a customer's order to their original payment method.", category: "orders", executionTier: "human_approval", enabled: true },
];

const workflows = [
  { id: "wf-frustration", name: "Notify manager on frustrated customer", triggerType: "SENTIMENT_THRESHOLD_CROSSED", enabled: true, version: 1 },
  { id: "wf-abandoned", name: "Follow up after abandoned chat", triggerType: "CONVERSATION_ABANDONED", enabled: true, version: 2 },
];

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function dateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

// naive keyword sentiment — same style/spirit as apps/api/src/engine/sentiment.ts's documented placeholder
function estimateSentiment(text: string): number {
  const lower = text.toLowerCase();
  const negative = ["angry", "frustrated", "terrible", "awful", "worst", "refund", "complaint", "unhappy", "annoyed"];
  const positive = ["thanks", "great", "awesome", "love", "perfect", "amazing", "helpful"];
  let score = 0.55;
  for (const w of negative) if (lower.includes(w)) score -= 0.25;
  for (const w of positive) if (lower.includes(w)) score += 0.2;
  return Math.max(-1, Math.min(1, score));
}
function wantsHuman(text: string): boolean {
  const lower = text.toLowerCase();
  return ["speak to a human", "talk to a person", "real person", "human agent", "manager"].some((p) => lower.includes(p));
}
function wantsBooking(text: string): boolean {
  const lower = text.toLowerCase();
  return ["book", "reserve", "reservation", "table"].some((p) => lower.includes(p));
}

// ---- server -----------------------------------------------------------------
const app = Fastify({ logger: { level: "info", transport: { target: "pino-pretty", options: { colorize: true } } } });
await app.register(cors, { origin: true });

app.get("/healthz", async () => ({ ok: true, mode: "demo", provider: "gemini" }));

app.post("/v1/auth/login", async () => ({ token: "demo-token", user: { id: USER_ID, tenantId: TENANT_ID, role: "tenant_owner" } }));
app.post("/v1/auth/signup", async () => ({ token: "demo-token", tenant }));
app.get("/v1/auth/me", async () => ({ id: USER_ID, email: "owner@solsticecoffee.demo", role: "tenant_owner", tenantId: TENANT_ID, displayName: "Demo Owner" }));

app.get("/v1/tenants/:tenantId", async () => tenant);

app.get("/v1/tenants/:tenantId/agents", async () => Array.from(agents.values()));
app.get("/v1/tenants/:tenantId/agents/:agentId", async (req, reply) => {
  const { agentId } = req.params as { agentId: string };
  const agent = agents.get(agentId);
  if (!agent) return reply.code(404).send({ error: "not found" });
  return agent;
});
app.post("/v1/tenants/:tenantId/agents", async (req, reply) => {
  const body = req.body as { name: string; personality: Agent["personality"] };
  const id = `agent-${randomUUID().slice(0, 8)}`;
  const agent: Agent = { id, name: body.name, status: "DRAFT", version: "v0.1", updatedAt: new Date().toISOString(), personality: body.personality };
  agents.set(id, agent);
  auditLog.unshift({ id: randomUUID(), action: "agent_created", actorIsStaff: false, timestamp: new Date().toISOString() });
  reply.code(201).send(agent);
});
app.patch("/v1/tenants/:tenantId/agents/:agentId", async (req, reply) => {
  const { agentId } = req.params as { agentId: string };
  const agent = agents.get(agentId);
  if (!agent) return reply.code(404).send({ error: "not found" });
  const body = req.body as { personality?: Partial<Agent["personality"]> };
  if (body.personality) Object.assign(agent.personality, body.personality);
  agent.updatedAt = new Date().toISOString();
  auditLog.unshift({ id: randomUUID(), action: "agent_instructions_edited", actorIsStaff: false, timestamp: agent.updatedAt });
  return agent;
});
app.post("/v1/tenants/:tenantId/agents/:agentId/approve", async (req, reply) => {
  const { agentId } = req.params as { agentId: string };
  const agent = agents.get(agentId);
  if (!agent) return reply.code(404).send({ error: "not found" });
  agent.status = "APPROVED";
  return agent;
});
app.post("/v1/tenants/:tenantId/agents/:agentId/publish", async (req, reply) => {
  const { agentId } = req.params as { agentId: string };
  const agent = agents.get(agentId);
  if (!agent) return reply.code(404).send({ error: "not found" });
  agent.status = "LIVE";
  auditLog.unshift({ id: randomUUID(), action: "agent_published", actorIsStaff: false, timestamp: new Date().toISOString() });
  return agent;
});

app.post("/v1/tenants/:tenantId/agents/:agentId/test-message", async (req, reply) => {
  const { agentId } = req.params as { agentId: string };
  const agent = agents.get(agentId);
  if (!agent) return reply.code(404).send({ error: "not found" });
  const body = req.body as { message: string; conversationId?: string; confirmToolCallId?: string };

  let conv = body.conversationId ? conversations.get(body.conversationId) : undefined;
  if (!conv) {
    conv = { id: randomUUID(), agentId, outcome: "IN_PROGRESS", dropOffPoint: "NONE", startedAt: new Date().toISOString(), sentimentTrend: [], messages: [] };
    conversations.set(conv.id, conv);
  }

  // resolving a pending confirmation-gated action
  if (body.confirmToolCallId && conv.pending?.toolCallId === body.confirmToolCallId) {
    conv.pending = undefined;
    const reply_ = "Booked! You'll get a confirmation text shortly. Anything else?";
    conv.messages.push({ role: "agent", content: reply_ });
    return { conversationId: conv.id, reply: reply_, handoffTriggered: false };
  }

  conv.messages.push({ role: "customer", content: body.message });
  conv.sentimentTrend.push(estimateSentiment(body.message));

  const handoffTriggered = wantsHuman(body.message);
  if (handoffTriggered) conv.outcome = "ESCALATED_TO_HUMAN";

  if (!handoffTriggered && wantsBooking(body.message)) {
    const toolCallId = randomUUID();
    conv.pending = { toolCallId, toolName: "book_table", confirmationPrompt: "I can hold the Downtown back room for you — want me to book it?" };
    const reply_ = "I can help with that — want me to go ahead and book it?";
    conv.messages.push({ role: "agent", content: reply_ });
    return { conversationId: conv.id, reply: reply_, pendingConfirmation: { toolCallId, toolName: "book_table", input: {}, confirmationPrompt: conv.pending.confirmationPrompt }, handoffTriggered: false };
  }

  const messages = [
    { role: "system" as const, content: agent.personality.systemInstructions },
    ...conv.messages.map((m) => ({ role: (m.role === "customer" ? "user" : "assistant") as "user" | "assistant", content: m.content })),
  ];

  let replyText: string;
  if (handoffTriggered) {
    replyText = "Of course — connecting you with our team now. Someone will be with you shortly.";
    conv.messages.push({ role: "agent", content: replyText });
  } else {
    const result = await gemini.generate({ model: GEMINI_MODEL_ID, messages, maxOutputTokens: 1024, temperature: 0.6 });
    replyText = result.content;
    conv.messages.push({ role: "agent", content: replyText });
    usage.push({ timestamp: new Date().toISOString(), inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, provider: "gemini" });
    if (conv.outcome === "IN_PROGRESS" && conv.messages.length >= 4) conv.outcome = "RESOLVED";
  }

  return { conversationId: conv.id, reply: replyText, handoffTriggered };
});

app.get("/v1/tenants/:tenantId/agents/:agentId/knowledge", async () => knowledge);
app.post("/v1/tenants/:tenantId/knowledge/faq", async (req, reply) => {
  const body = req.body as { agentId: string; entries: { question: string; answer: string }[] };
  for (const e of body.entries) {
    knowledge.push({ id: `kb-${randomUUID().slice(0, 8)}`, type: "faq", status: "READY", originalFilename: e.question, addedBySource: "CLIENT" });
    const agent = agents.get(body.agentId);
    if (agent) agent.personality.systemInstructions += `\n\nQ: ${e.question}\nA: ${e.answer}`;
  }
  auditLog.unshift({ id: randomUUID(), action: "faq_added", actorIsStaff: false, contentSource: "client-provided", timestamp: new Date().toISOString() });
  reply.code(201).send({ ok: true });
});
app.post("/v1/tenants/:tenantId/knowledge/crawl", async (req, reply) => {
  const body = req.body as { agentId: string; startUrls: string[] };
  for (const url of body.startUrls) {
    knowledge.push({ id: `kb-${randomUUID().slice(0, 8)}`, type: "website", status: "PROCESSING", sourceUrl: url, addedBySource: "CLIENT" });
  }
  auditLog.unshift({ id: randomUUID(), action: "website_crawl_started", actorIsStaff: false, contentSource: "client-provided URL", timestamp: new Date().toISOString() });
  reply.code(201).send({ ok: true });
});
app.delete("/v1/tenants/:tenantId/knowledge/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const idx = knowledge.findIndex((k) => k.id === id);
  if (idx >= 0) knowledge.splice(idx, 1);
  reply.code(204).send();
});

app.get("/v1/tenants/:tenantId/agents/:agentId/conversations", async (req) => {
  const { agentId } = req.params as { agentId: string };
  return Array.from(conversations.values())
    .filter((c) => c.agentId === agentId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((c) => ({ id: c.id, outcome: c.outcome, startedAt: c.startedAt }));
});
app.get("/v1/tenants/:tenantId/conversations/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const conv = conversations.get(id);
  if (!conv) return reply.code(404).send({ error: "not found" });
  return { conversation: conv, messages: conv.messages };
});

app.get("/v1/tenants/:tenantId/agents/:agentId/analytics", async (req) => {
  const { agentId } = req.params as { agentId: string };
  const convs = Array.from(conversations.values()).filter((c) => c.agentId === agentId);
  const byOutcome: Record<string, number> = {};
  const byDropOff: Record<string, number> = {};
  for (const c of convs) {
    byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
    byDropOff[c.dropOffPoint] = (byDropOff[c.dropOffPoint] ?? 0) + 1;
  }
  const allSentiment = convs.flatMap((c) => c.sentimentTrend);
  const avgSentiment = allSentiment.length ? allSentiment.reduce((a, b) => a + b, 0) / allSentiment.length : 0;
  return { total: convs.length, byOutcome, byDropOff, avgSentiment };
});
app.get("/v1/tenants/:tenantId/agents/:agentId/analytics/daily", async (req) => {
  const { agentId } = req.params as { agentId: string };
  const days = Number((req.query as { days?: string }).days) || 14;
  const byDay = new Map<string, { conversations: number; sum: number; count: number }>();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(dateKey(d), { conversations: 0, sum: 0, count: 0 });
  }
  for (const c of conversations.values()) {
    if (c.agentId !== agentId) continue;
    const key = dateKey(new Date(c.startedAt));
    const entry = byDay.get(key);
    if (!entry) continue;
    entry.conversations += 1;
    for (const s of c.sentimentTrend) {
      entry.sum += s;
      entry.count += 1;
    }
  }
  return Array.from(byDay.entries()).map(([date, d]) => ({ date, conversations: d.conversations, avgSentiment: d.count ? d.sum / d.count : null }));
});

app.get("/v1/tenants/:tenantId/tools", async () => tools);
app.post("/v1/tenants/:tenantId/tools", async (req, reply) => {
  const body = req.body as { name: string; description: string; category: string; executionTier: string };
  const tool = { id: `tool-${randomUUID().slice(0, 8)}`, name: body.name, description: body.description, category: body.category, executionTier: body.executionTier, enabled: true };
  tools.push(tool);
  auditLog.unshift({ id: randomUUID(), action: "tool_configured", actorIsStaff: false, timestamp: new Date().toISOString() });
  reply.code(201).send(tool);
});

app.get("/v1/tenants/:tenantId/workflows", async () => workflows);
app.post("/v1/tenants/:tenantId/workflows", async (req, reply) => {
  const body = req.body as { name: string; triggerType: string };
  const wf = { id: `wf-${randomUUID().slice(0, 8)}`, name: body.name, triggerType: body.triggerType, enabled: true, version: 1 };
  workflows.push(wf);
  auditLog.unshift({ id: randomUUID(), action: "workflow_created", actorIsStaff: false, timestamp: new Date().toISOString() });
  reply.code(201).send(wf);
});

app.get("/v1/tenants/:tenantId/usage/summary", async () => {
  const totalInputTokens = usage.reduce((s, u) => s + u.inputTokens, 0);
  const totalOutputTokens = usage.reduce((s, u) => s + u.outputTokens, 0);
  const byProvider = usage.reduce<Record<string, { inputTokens: number; outputTokens: number; requests: number }>>((acc, u) => {
    const e = (acc[u.provider] ??= { inputTokens: 0, outputTokens: 0, requests: 0 });
    e.inputTokens += u.inputTokens;
    e.outputTokens += u.outputTokens;
    e.requests += 1;
    return acc;
  }, {});
  const totalTokens = totalInputTokens + totalOutputTokens;
  const includedTokensPerMonth = 500_000;
  const overageTokens = Math.max(0, totalTokens - includedTokensPerMonth);
  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    overageTokens,
    estimatedOverageUsd: overageTokens * 0.002,
    byProvider,
  };
});
app.get("/v1/tenants/:tenantId/usage/daily", async (req) => {
  const days = Number((req.query as { days?: string }).days) || 14;
  const byDay = new Map<string, { inputTokens: number; outputTokens: number }>();
  const since = new Date();
  since.setDate(since.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    byDay.set(dateKey(d), { inputTokens: 0, outputTokens: 0 });
  }
  for (const u of usage) {
    const key = dateKey(new Date(u.timestamp));
    const entry = byDay.get(key);
    if (entry) {
      entry.inputTokens += u.inputTokens;
      entry.outputTokens += u.outputTokens;
    }
  }
  return Array.from(byDay.entries()).map(([date, t]) => ({ date, inputTokens: t.inputTokens, outputTokens: t.outputTokens, totalTokens: t.inputTokens + t.outputTokens }));
});

app.get("/v1/tenants/:tenantId/audit-log", async () => auditLog);

const port = Number(process.env.API_PORT) || 4000;
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`\nDemo API (no Docker, no Postgres) listening on http://localhost:${port}`);
  console.log(`Gemini model: ${GEMINI_MODEL_ID} — real AI replies, in-memory data (resets on restart).\n`);
});
