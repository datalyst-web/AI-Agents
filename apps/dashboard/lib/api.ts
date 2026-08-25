"use client";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("chat-agent:token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("chat-agent:token", token);
  else localStorage.removeItem("chat-agent:token");
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Every dashboard data fetch goes through here — never directly to any
 * LLM/DB, only to apps/api (CLAUDE.md principle 2 / Security
 * Requirements applied to the dashboard client).
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new ApiError(resp.status, body.error ?? resp.statusText);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: { id: string; tenantId: string; role: string } }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: (tenantName: string, email: string, password: string) =>
    apiFetch<{ token: string; tenant: { id: string; slug: string; name: string } }>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ tenantName, email, password }),
    }),
  me: () => apiFetch<{ id: string; email: string; role: string; tenantId: string; displayName: string }>("/v1/auth/me"),

  listAgents: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/agents`),
  getAgent: (tenantId: string, agentId: string) => apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}`),
  createAgent: (tenantId: string, body: unknown) =>
    apiFetch(`/v1/tenants/${tenantId}/agents`, { method: "POST", body: JSON.stringify(body) }),
  updateAgent: (tenantId: string, agentId: string, body: unknown) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(body) }),
  startTesting: (tenantId: string, agentId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/start-testing`, { method: "POST" }),
  deleteAgent: (tenantId: string, agentId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}`, { method: "DELETE" }),
  approveAgent: (tenantId: string, agentId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/approve`, { method: "POST" }),
  publishAgent: (tenantId: string, agentId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/publish`, { method: "POST" }),
  sendTestMessage: (
    tenantId: string,
    agentId: string,
    body: { message: string; conversationId?: string; confirmToolCallId?: string },
  ) =>
    apiFetch<{
      conversationId: string;
      reply: string;
      pendingConfirmation?: { toolCallId: string; toolName: string; input: unknown; confirmationPrompt: string };
      handoffTriggered: boolean;
    }>(`/v1/tenants/${tenantId}/agents/${agentId}/test-message`, { method: "POST", body: JSON.stringify(body) }),

  listKnowledge: (tenantId: string, agentId: string) => apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/knowledge`),
  addFaq: (tenantId: string, agentId: string, entries: { question: string; answer: string }[]) =>
    apiFetch(`/v1/tenants/${tenantId}/knowledge/faq`, { method: "POST", body: JSON.stringify({ agentId, entries }) }),
  crawlWebsite: (tenantId: string, agentId: string, startUrls: string[]) =>
    apiFetch(`/v1/tenants/${tenantId}/knowledge/crawl`, { method: "POST", body: JSON.stringify({ agentId, startUrls }) }),
  deleteKnowledge: (tenantId: string, knowledgeSourceId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/knowledge/${knowledgeSourceId}`, { method: "DELETE" }),

  listConversations: (tenantId: string, agentId: string) => apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/conversations`),
  getConversation: (tenantId: string, conversationId: string) => apiFetch(`/v1/tenants/${tenantId}/conversations/${conversationId}`),
  getAnalytics: (tenantId: string, agentId: string) => apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/analytics`),
  getAnalyticsDaily: (tenantId: string, agentId: string, days = 14) =>
    apiFetch<{ date: string; conversations: number; avgSentiment: number | null }[]>(
      `/v1/tenants/${tenantId}/agents/${agentId}/analytics/daily?days=${days}`,
    ),

  listTools: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/tools`),
  createTool: (tenantId: string, body: unknown) => apiFetch(`/v1/tenants/${tenantId}/tools`, { method: "POST", body: JSON.stringify(body) }),

  listWorkflows: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/workflows`),
  createWorkflow: (tenantId: string, body: unknown) =>
    apiFetch(`/v1/tenants/${tenantId}/workflows`, { method: "POST", body: JSON.stringify(body) }),

  getUsageSummary: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/usage/summary`),
  getUsageDaily: (tenantId: string, days = 14) =>
    apiFetch<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }[]>(
      `/v1/tenants/${tenantId}/usage/daily?days=${days}`,
    ),
  getAuditLog: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/audit-log`),
  getTenant: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}`),
};
