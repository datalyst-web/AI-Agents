"use client";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("chat-agent:token");
}

export function setToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem("chat-agent:token", token);
  else localStorage.removeItem("chat-agent:token");
}

export interface ImpersonationContext {
  tenantId: string;
  tenantName: string;
  sessionId: string;
  expiresAt: string;
}

/**
 * Which tenant a setup_specialist is currently "acting as," kept client-side
 * alongside the (impersonation-claim-bearing) JWT. Every other dashboard
 * page already calls api.xxx(user.tenantId, ...) — AuthProvider overlays
 * this onto `user.tenantId` so impersonation works through the exact same
 * client-facing pages/components a tenant themselves would use (CLAUDE.md:
 * staff must never get a separate path), with zero changes to those pages.
 */
export function getImpersonation(): ImpersonationContext | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("chat-agent:impersonation");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ImpersonationContext;
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      localStorage.removeItem("chat-agent:impersonation");
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setImpersonation(ctx: ImpersonationContext | null) {
  if (typeof window === "undefined") return;
  if (ctx) localStorage.setItem("chat-agent:impersonation", JSON.stringify(ctx));
  else localStorage.removeItem("chat-agent:impersonation");
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
      // Only set content-type when there's an actual body — Fastify's JSON
      // body parser throws FST_ERR_CTP_EMPTY_JSON_BODY (400) on a request
      // that declares application/json but sends nothing, which broke
      // every bodyless call (deleteAgent, startTesting, publishAgent,
      // approveAgent, endImpersonation, ...) even though they looked fine
      // tested via curl (curl doesn't set this header without -d).
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    // Some routes (e.g. test-message) return both a stable `error` code
    // and a human-readable `message` with the actual underlying reason —
    // prefer the message when present rather than showing just the code,
    // which is useless on its own (e.g. "test_message_failed" tells you
    // nothing about *why*). Routes that only set `error` are unaffected.
    throw new ApiError(resp.status, body.message ?? body.error ?? resp.statusText);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

async function uploadLogo(path: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new ApiError(resp.status, body.message ?? body.error ?? resp.statusText);
  }
  return resp.json();
}

export const api = {
  login: (email: string, password: string) =>
    apiFetch<{ token: string; user: { id: string; tenantId: string; role: string } }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  forgotPassword: (email: string) =>
    apiFetch<{ message: string }>("/v1/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, newPassword: string) =>
    apiFetch<{ message: string }>("/v1/auth/reset-password", { method: "POST", body: JSON.stringify({ token, newPassword }) }),
  signup: (tenantName: string, email: string, password: string) =>
    apiFetch<{ token: string; tenant: { id: string; slug: string; name: string } }>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ tenantName, email, password }),
    }),
  me: () =>
    apiFetch<{
      id: string;
      email: string;
      role: string;
      tenantId: string;
      displayName: string;
      theme: "DARK" | "LIGHT";
      subscriptionTier: "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE" | null;
      subscriptionState: "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "CANCELLED" | null;
      brandName: string | null;
      logoUrl: string | null;
      platformBrandName: string | null;
      platformLogoUrl: string | null;
    }>("/v1/auth/me"),
  updateTenantTheme: (tenantId: string, theme: "DARK" | "LIGHT") =>
    apiFetch(`/v1/tenants/${tenantId}/theme`, { method: "PATCH", body: JSON.stringify({ theme }) }),
  updateTenantBranding: (tenantId: string, brandName: string | null) =>
    apiFetch(`/v1/tenants/${tenantId}/branding`, { method: "PATCH", body: JSON.stringify({ brandName }) }),
  uploadTenantLogo: (tenantId: string, file: File) => uploadLogo(`/v1/tenants/${tenantId}/branding/logo`, file),
  updatePlatformBranding: (brandName: string | null) =>
    apiFetch(`/v1/platform/branding`, { method: "PATCH", body: JSON.stringify({ brandName }) }),
  uploadPlatformLogo: (file: File) => uploadLogo(`/v1/platform/branding/logo`, file),

  createClient: (tenantName: string, email: string, password: string) =>
    apiFetch<{ id: string; name: string }>("/v1/platform/clients", {
      method: "POST",
      body: JSON.stringify({ tenantName, email, password }),
    }),
  cancelClient: (tenantId: string) => apiFetch(`/v1/platform/tenants/${tenantId}/cancel`, { method: "POST" }),
  reactivateClient: (tenantId: string) => apiFetch(`/v1/platform/tenants/${tenantId}/reactivate`, { method: "POST" }),

  listStaff: () =>
    apiFetch<{ id: string; email: string; displayName: string; role: string; isActive: boolean; createdAt: string }[]>(
      "/v1/platform/staff",
    ),
  createStaff: (email: string, password: string, displayName: string, role: "setup_specialist" | "platform_admin") =>
    apiFetch<{ id: string; email: string; displayName: string; role: string }>("/v1/platform/staff", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName, role }),
    }),

  listManagedSetupQueue: () =>
    apiFetch<{ id: string; name: string; managedSetupTier: string; subscriptionState: string; updatedAt: string }[]>(
      "/v1/managed-setup/queue",
    ),
  startImpersonation: (tenantId: string, reason: string, durationMinutes = 60) =>
    apiFetch<{ token: string; sessionId: string; tenantId: string; expiresAt: string }>("/v1/managed-setup/impersonate/start", {
      method: "POST",
      body: JSON.stringify({ tenantId, reason, durationMinutes }),
    }),
  endImpersonation: (sessionId: string) =>
    apiFetch(`/v1/managed-setup/impersonate/${sessionId}/end`, { method: "POST" }),

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
  listAgentVersions: (tenantId: string, agentId: string) =>
    apiFetch<{ id: string; version: string; status: string; publishedAt: string }[]>(`/v1/tenants/${tenantId}/agents/${agentId}/versions`),
  rollbackAgent: (tenantId: string, agentId: string, toVersion: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/rollback`, { method: "POST", body: JSON.stringify({ toVersion }) }),
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
  resolveConversation: (tenantId: string, conversationId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/conversations/${conversationId}/resolve`, { method: "POST" }),
  getAnalytics: (tenantId: string, agentId: string) => apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/analytics`),
  getAnalyticsDaily: (tenantId: string, agentId: string, days = 14) =>
    apiFetch<{ date: string; conversations: number; avgSentiment: number | null }[]>(
      `/v1/tenants/${tenantId}/agents/${agentId}/analytics/daily?days=${days}`,
    ),

  listTools: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/tools`),
  createTool: (tenantId: string, body: unknown) => apiFetch(`/v1/tenants/${tenantId}/tools`, { method: "POST", body: JSON.stringify(body) }),
  updateTool: (tenantId: string, toolId: string, body: unknown) =>
    apiFetch(`/v1/tenants/${tenantId}/tools/${toolId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteTool: (tenantId: string, toolId: string) => apiFetch(`/v1/tenants/${tenantId}/tools/${toolId}`, { method: "DELETE" }),

  listWorkflows: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/workflows`),
  updateWorkflow: (tenantId: string, workflowId: string, body: unknown) =>
    apiFetch(`/v1/tenants/${tenantId}/workflows/${workflowId}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteWorkflow: (tenantId: string, workflowId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/workflows/${workflowId}`, { method: "DELETE" }),
  createWorkflow: (tenantId: string, body: unknown) =>
    apiFetch(`/v1/tenants/${tenantId}/workflows`, { method: "POST", body: JSON.stringify(body) }),

  listApprovals: (tenantId: string) =>
    apiFetch<
      { id: string; agentId: string; conversationId: string; toolName: string; input: unknown; requestedAt: string }[]
    >(`/v1/tenants/${tenantId}/approvals`),
  approveApproval: (tenantId: string, approvalId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/approvals/${approvalId}/approve`, { method: "POST" }),
  rejectApproval: (tenantId: string, approvalId: string, reason?: string) =>
    apiFetch(`/v1/tenants/${tenantId}/approvals/${approvalId}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),

  getUsageSummary: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/usage/summary`),
  getUsageDaily: (tenantId: string, days = 14) =>
    apiFetch<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }[]>(
      `/v1/tenants/${tenantId}/usage/daily?days=${days}`,
    ),
  getAuditLog: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/audit-log`),
  getTenant: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}`),
};
