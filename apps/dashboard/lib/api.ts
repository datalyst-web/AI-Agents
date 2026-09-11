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
  login: (email: string, password: string, turnstileToken?: string) =>
    apiFetch<{ token: string; user: { id: string; tenantId: string; role: string } }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, turnstileToken }),
    }),
  googleLogin: (credential: string, turnstileToken?: string) =>
    apiFetch<{ token: string; user: { id: string; tenantId: string; role: string } }>("/v1/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential, turnstileToken }),
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
  lookupInvite: (token: string) =>
    apiFetch<{ email: string; role: string; tenantName: string }>(`/v1/auth/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, displayName: string, password: string) =>
    apiFetch<{ token: string; tenant: { id: string; slug: string; name: string } }>("/v1/auth/accept-invite", {
      method: "POST",
      body: JSON.stringify({ token, displayName, password }),
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
      trialEndsAt: string | null;
      trialDaysRemaining: number | null;
      brandName: string | null;
      logoUrl: string | null;
      platformBrandName: string | null;
      platformLogoUrl: string | null;
      notifyEscalationEmail: boolean;
      notifyEscalationSms: boolean;
      notifyEscalationPush: boolean;
      phoneNumber: string | null;
    }>("/v1/auth/me"),
  updateTenantTheme: (tenantId: string, theme: "DARK" | "LIGHT") =>
    apiFetch(`/v1/tenants/${tenantId}/theme`, { method: "PATCH", body: JSON.stringify({ theme }) }),
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
  // Per-client white-label branding — staff-only, edited directly from the
  // Managed Setup queue (no impersonation session required).
  updateClientBranding: (tenantId: string, brandName: string | null) =>
    apiFetch(`/v1/platform/tenants/${tenantId}/branding`, { method: "PATCH", body: JSON.stringify({ brandName }) }),
  uploadClientLogo: (tenantId: string, file: File) => uploadLogo(`/v1/platform/tenants/${tenantId}/branding/logo`, file),

  listStaff: () =>
    apiFetch<{ id: string; email: string; displayName: string; role: string; isActive: boolean; createdAt: string }[]>(
      "/v1/platform/staff",
    ),
  createStaff: (email: string, password: string, displayName: string, role: "setup_specialist" | "platform_admin") =>
    apiFetch<{ id: string; email: string; displayName: string; role: string }>("/v1/platform/staff", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName, role }),
    }),
  deactivateStaff: (staffId: string) => apiFetch(`/v1/platform/staff/${staffId}/deactivate`, { method: "POST" }),
  reactivateStaff: (staffId: string) => apiFetch(`/v1/platform/staff/${staffId}/reactivate`, { method: "POST" }),

  getProviderHealth: () =>
    apiFetch<Record<"anthropic" | "openai" | "gemini", { healthy: boolean; latencyMs?: number; error?: string; checkedAt: string }>>(
      "/healthz/providers",
    ),

  listManagedSetupQueue: () =>
    apiFetch<
      {
        id: string;
        name: string;
        managedSetupTier: string;
        subscriptionState: string;
        updatedAt: string;
        brandName: string | null;
        logoUrl: string | null;
        dataResidencyRegion: string | null;
        agents: { id: string; name: string; status: "DRAFT" | "CONFIGURING" | "KNOWLEDGE_PROCESSING" | "TESTING" | "APPROVED" | "LIVE" }[];
      }[]
    >(
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
  /**
   * Uploads one document into an agent's knowledge base. Multipart, so it
   * can't go through apiFetch (which sets a JSON content-type) — the
   * browser has to set its own boundary. Returns 202: the row exists
   * immediately as PENDING and the worker ingests it asynchronously.
   */
  uploadKnowledgeFile: async (tenantId: string, agentId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    const token = getToken();
    const resp = await fetch(`${API_BASE}/v1/tenants/${tenantId}/agents/${agentId}/knowledge/upload`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: resp.statusText }));
      const supported = Array.isArray(body.supported) ? ` Supported: ${body.supported.join(", ")}.` : "";
      throw new ApiError(resp.status, (body.message ?? body.error ?? resp.statusText) + supported);
    }
    return resp.json() as Promise<{ id: string; originalFilename: string; status: string }>;
  },
  addFaq: (tenantId: string, agentId: string, entries: { question: string; answer: string }[]) =>
    apiFetch(`/v1/tenants/${tenantId}/knowledge/faq`, { method: "POST", body: JSON.stringify({ agentId, entries }) }),
  crawlWebsite: (tenantId: string, agentId: string, startUrls: string[]) =>
    apiFetch(`/v1/tenants/${tenantId}/knowledge/crawl`, { method: "POST", body: JSON.stringify({ agentId, startUrls }) }),
  deleteKnowledge: (tenantId: string, knowledgeSourceId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/knowledge/${knowledgeSourceId}`, { method: "DELETE" }),

  listLeads: (tenantId: string) =>
    apiFetch<
      {
        id: string;
        startedAt: string;
        channel: string;
        outcome: string;
        businessResult: string;
        agent: { name: string };
      }[]
    >(`/v1/tenants/${tenantId}/leads`),
  listConversations: (
    tenantId: string,
    agentId: string,
    filters?: { outcome?: string; channel?: string; since?: string; until?: string },
  ) => {
    const params = new URLSearchParams();
    if (filters?.outcome) params.set("outcome", filters.outcome);
    if (filters?.channel) params.set("channel", filters.channel);
    if (filters?.since) params.set("since", filters.since);
    if (filters?.until) params.set("until", filters.until);
    const qs = params.toString();
    return apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/conversations${qs ? `?${qs}` : ""}`);
  },
  getConversation: (tenantId: string, conversationId: string) => apiFetch(`/v1/tenants/${tenantId}/conversations/${conversationId}`),
  resolveConversation: (tenantId: string, conversationId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/conversations/${conversationId}/resolve`, { method: "POST" }),
  getAnalytics: (tenantId: string, agentId: string) => apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/analytics`),
  getGapReport: (tenantId: string, agentId: string) =>
    apiFetch<{ conversationId: string; askedAt: string; question: string | null; agentReply: string }[]>(
      `/v1/tenants/${tenantId}/agents/${agentId}/gap-report`,
    ),
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

  listChannels: (tenantId: string, agentId: string) =>
    apiFetch<
      {
        id: string;
        channel: "TELEGRAM" | "WHATSAPP" | "FACEBOOK_MESSENGER" | "INSTAGRAM";
        status: "PENDING" | "CONNECTED" | "DISCONNECTED" | "ERROR";
        externalLabel: string | null;
        errorMessage: string | null;
        connectedAt: string | null;
      }[]
    >(`/v1/tenants/${tenantId}/agents/${agentId}/channels`),
  connectTelegram: (tenantId: string, agentId: string, botToken: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/channels/telegram/connect`, {
      method: "POST",
      body: JSON.stringify({ botToken }),
    }),
  connectWhatsapp: (tenantId: string, agentId: string, externalId: string, accessToken: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/channels/whatsapp/connect`, {
      method: "POST",
      body: JSON.stringify({ externalId, accessToken }),
    }),
  connectMessenger: (tenantId: string, agentId: string, externalId: string, accessToken: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/channels/messenger/connect`, {
      method: "POST",
      body: JSON.stringify({ externalId, accessToken }),
    }),
  connectInstagram: (tenantId: string, agentId: string, externalId: string, accessToken: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/channels/instagram/connect`, {
      method: "POST",
      body: JSON.stringify({ externalId, accessToken }),
    }),
  disconnectChannel: (tenantId: string, agentId: string, channel: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/channels/${channel.toLowerCase()}/disconnect`, { method: "POST" }),

  listBusinessIntegrations: (tenantId: string, agentId: string) =>
    apiFetch<{ vendor: "hubspot" | "zendesk" | "google_calendar"; connected: boolean; label?: string }[]>(
      `/v1/tenants/${tenantId}/agents/${agentId}/integrations`,
    ),
  connectHubspot: (tenantId: string, agentId: string, accessToken: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/integrations/hubspot/connect`, {
      method: "POST",
      body: JSON.stringify({ accessToken }),
    }),
  connectZendesk: (tenantId: string, agentId: string, subdomain: string, email: string, apiToken: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/integrations/zendesk/connect`, {
      method: "POST",
      body: JSON.stringify({ subdomain, email, apiToken }),
    }),
  startGoogleCalendarConnect: (tenantId: string, agentId: string) =>
    apiFetch<{ authUrl: string }>(`/v1/tenants/${tenantId}/agents/${agentId}/integrations/google-calendar/connect/start`, {
      method: "POST",
    }),
  disconnectBusinessIntegration: (tenantId: string, agentId: string, vendor: string) =>
    apiFetch(`/v1/tenants/${tenantId}/agents/${agentId}/integrations/${vendor}/disconnect`, { method: "POST" }),

  getBillingPlans: (tenantId: string) =>
    apiFetch<{
      currentTier: "STARTER" | "GROWTH" | "SCALE" | "ENTERPRISE";
      currentState: "ACTIVE" | "TRIAL" | "PAST_DUE" | "SUSPENDED" | "CANCELLED";
      plans: { tier: "STARTER" | "GROWTH" | "SCALE"; priceUsd: string }[];
      paynowConfigured: boolean;
    }>(`/v1/tenants/${tenantId}/billing/plans`),
  listPaynowPayments: (tenantId: string) =>
    apiFetch<
      { id: string; reference: string; description: string; amountUsd: string; status: "PENDING" | "PAID" | "CANCELLED" | "FAILED"; createdAt: string }[]
    >(`/v1/tenants/${tenantId}/billing/payments`),
  getPaynowPayment: (tenantId: string, reference: string) =>
    apiFetch<{ reference: string; status: "PENDING" | "PAID" | "CANCELLED" | "FAILED"; amountUsd: string; description: string }>(
      `/v1/tenants/${tenantId}/billing/payments/${reference}`,
    ),
  startPaynowCheckout: (tenantId: string, tier: "STARTER" | "GROWTH" | "SCALE") =>
    apiFetch<{ reference: string; redirectUrl: string }>(`/v1/tenants/${tenantId}/billing/checkout`, {
      method: "POST",
      body: JSON.stringify({ tier }),
    }),
  startPaynowMobileCheckout: (tenantId: string, tier: "STARTER" | "GROWTH" | "SCALE", phone: string, method: "ecocash" | "onemoney") =>
    apiFetch<{ reference: string; instructions: string }>(`/v1/tenants/${tenantId}/billing/checkout/mobile`, {
      method: "POST",
      body: JSON.stringify({ tier, phone, method }),
    }),

  getUsageSummary: (tenantId: string) =>
    apiFetch<{
      periodStart: string;
      totalInputTokens: number;
      totalOutputTokens: number;
      totalTokens: number;
      byProvider: Record<string, { inputTokens: number; outputTokens: number; requests: number }>;
      limits: {
        includedConversationsPerMonth: number;
        includedTokensPerMonth: number;
        overageRatePerThousandTokensUsd: string;
        hardCapTokensPerMonth: number | null;
      } | null;
      overageTokens: number;
      estimatedOverageUsd: number;
      percentOfIncludedUsed: number | null;
      hardCapTokens: number | null;
      overHardCap: boolean;
    }>(`/v1/tenants/${tenantId}/usage/summary`),
  getUsageDaily: (tenantId: string, days = 14) =>
    apiFetch<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }[]>(
      `/v1/tenants/${tenantId}/usage/daily?days=${days}`,
    ),
  getAuditLog: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}/audit-log`),
  getTenant: (tenantId: string) => apiFetch(`/v1/tenants/${tenantId}`),

  getTeam: (tenantId: string) =>
    apiFetch<{
      members: { id: string; email: string; displayName: string; role: string; createdAt: string }[];
      invites: { id: string; email: string; role: string; expiresAt: string; createdAt: string; expired: boolean }[];
    }>(`/v1/tenants/${tenantId}/team`),
  inviteTeamMember: (tenantId: string, email: string, role: "tenant_admin" | "tenant_agent_editor" | "tenant_viewer") =>
    apiFetch(`/v1/tenants/${tenantId}/team/invites`, { method: "POST", body: JSON.stringify({ email, role }) }),
  revokeInvite: (tenantId: string, inviteId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/team/invites/${inviteId}`, { method: "DELETE" }),
  removeTeamMember: (tenantId: string, userId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/team/members/${userId}`, { method: "DELETE" }),

  // --- Live inbox / human takeover ---
  getLiveInbox: (tenantId: string) =>
    apiFetch<
      {
        id: string;
        agentId: string;
        agentName: string;
        channel: string;
        startedAt: string;
        handoffRequested: boolean;
        humanTakeoverActive: boolean;
        takenOverByUserId: string | null;
        lastMessage: { role: string; content: string; createdAt: string } | null;
      }[]
    >(`/v1/tenants/${tenantId}/live-inbox`),
  takeoverConversation: (tenantId: string, conversationId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/conversations/${conversationId}/takeover`, { method: "POST" }),
  releaseConversation: (tenantId: string, conversationId: string) =>
    apiFetch(`/v1/tenants/${tenantId}/conversations/${conversationId}/release`, { method: "POST" }),
  sendStaffReply: (tenantId: string, conversationId: string, message: string) =>
    apiFetch<{ id: string; externalDeliveryError?: string }>(`/v1/tenants/${tenantId}/conversations/${conversationId}/staff-reply`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  // Reuses the conversation-detail endpoint, which already returns the full
  // message list — there is no separate .../messages route on the
  // tenant-scoped surface (the /v1/chat/... one is widget-token auth, for
  // customers, not staff).
  getConversationMessages: (tenantId: string, conversationId: string) =>
    apiFetch<{ messages: { id: string; role: string; content: string; createdAt: string }[] }>(
      `/v1/tenants/${tenantId}/conversations/${conversationId}`,
    ).then((r) => r.messages),

  // --- Notification preferences (self-service) ---
  updateNotificationPreferences: (body: {
    notifyEscalationEmail?: boolean;
    notifyEscalationSms?: boolean;
    notifyEscalationPush?: boolean;
    phoneNumber?: string | null;
  }) =>
    apiFetch<{ notifyEscalationEmail: boolean; notifyEscalationSms: boolean; notifyEscalationPush: boolean; phoneNumber: string | null }>(
      "/v1/auth/me/notification-preferences",
      { method: "PATCH", body: JSON.stringify(body) },
    ),
  getPushPublicKey: () => apiFetch<{ publicKey: string | null }>("/v1/auth/me/push-public-key"),
  savePushSubscription: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
    apiFetch("/v1/auth/me/push-subscription", { method: "POST", body: JSON.stringify(subscription) }),
  deletePushSubscription: (endpoint: string) =>
    apiFetch("/v1/auth/me/push-subscription", { method: "DELETE", body: JSON.stringify({ endpoint }) }),

  // --- Data residency (staff-only, disclosure) ---
  updateDataResidency: (tenantId: string, dataResidencyRegion: string | null) =>
    apiFetch(`/v1/platform/tenants/${tenantId}/data-residency`, {
      method: "PATCH",
      body: JSON.stringify({ dataResidencyRegion }),
    }),

  // --- Support tickets ---
  listSupportTickets: (tenantId: string) =>
    apiFetch<
      { id: string; subject: string; description: string; priority: string; status: string; createdAt: string; resolvedAt: string | null }[]
    >(`/v1/tenants/${tenantId}/support-tickets`),
  createSupportTicket: (tenantId: string, body: { subject: string; description: string; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT" }) =>
    apiFetch(`/v1/tenants/${tenantId}/support-tickets`, { method: "POST", body: JSON.stringify(body) }),
  listAllSupportTickets: () =>
    apiFetch<
      {
        id: string;
        tenantId: string;
        tenant: { name: string };
        subject: string;
        description: string;
        priority: string;
        status: string;
        createdAt: string;
        resolvedAt: string | null;
      }[]
    >("/v1/platform/support-tickets"),
  updateSupportTicketStatus: (id: string, status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED") =>
    apiFetch(`/v1/platform/support-tickets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  // --- Security flags (prompt injection triage) ---
  listSecurityFlags: (reviewed?: boolean) =>
    apiFetch<
      {
        id: string;
        tenantId: string;
        tenant: { name: string };
        matchedPhrase: string;
        content: string;
        flaggedAt: string;
        reviewed: boolean;
        reviewedAt: string | null;
      }[]
    >(`/v1/platform/security-flags${reviewed !== undefined ? `?reviewed=${reviewed}` : ""}`),
  markSecurityFlagReviewed: (id: string) =>
    apiFetch(`/v1/platform/security-flags/${id}`, { method: "PATCH", body: JSON.stringify({ reviewed: true }) }),

  // --- Incidents ---
  listIncidents: () =>
    apiFetch<
      { id: string; title: string; description: string; severity: string; status: string; startedAt: string; resolvedAt: string | null }[]
    >("/v1/platform/incidents"),
  createIncident: (body: { title: string; description: string; severity?: "MINOR" | "MAJOR" | "CRITICAL" }) =>
    apiFetch("/v1/platform/incidents", { method: "POST", body: JSON.stringify(body) }),
  updateIncidentStatus: (id: string, status: "OPEN" | "MONITORING" | "RESOLVED") =>
    apiFetch(`/v1/platform/incidents/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),

  // --- Feature flags ---
  listFeatureFlags: () =>
    apiFetch<
      { id: string; key: string; name: string; description: string; enabledTiers: string[] }[]
    >("/v1/platform/feature-flags"),
  createFeatureFlag: (body: { key: string; name: string; description?: string; enabledTiers?: string[] }) =>
    apiFetch("/v1/platform/feature-flags", { method: "POST", body: JSON.stringify(body) }),
  updateFeatureFlag: (id: string, body: { name?: string; description?: string; enabledTiers?: string[] }) =>
    apiFetch(`/v1/platform/feature-flags/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteFeatureFlag: (id: string) => apiFetch(`/v1/platform/feature-flags/${id}`, { method: "DELETE" }),

  // --- Prompt templates ---
  listPromptTemplates: () =>
    apiFetch<
      { id: string; name: string; description: string; systemInstructions: string; guardrailPolicy: string; isDefault: boolean }[]
    >("/v1/platform/prompt-templates"),
  createPromptTemplate: (body: { name: string; description?: string; systemInstructions: string; guardrailPolicy?: string; isDefault?: boolean }) =>
    apiFetch("/v1/platform/prompt-templates", { method: "POST", body: JSON.stringify(body) }),
  updatePromptTemplate: (id: string, body: Partial<{ name: string; description: string; systemInstructions: string; guardrailPolicy: string; isDefault: boolean }>) =>
    apiFetch(`/v1/platform/prompt-templates/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deletePromptTemplate: (id: string) => apiFetch(`/v1/platform/prompt-templates/${id}`, { method: "DELETE" }),

  // --- Branding presets ---
  listBrandingPresets: () =>
    apiFetch<{ id: string; name: string; brandName: string; logoUrl: string | null }[]>("/v1/platform/branding-presets"),
  createBrandingPreset: (name: string, brandName: string) =>
    apiFetch<{ id: string }>("/v1/platform/branding-presets", { method: "POST", body: JSON.stringify({ name, brandName }) }),
  uploadBrandingPresetLogo: (id: string, file: File) => uploadLogo(`/v1/platform/branding-presets/${id}/logo`, file),
  deleteBrandingPreset: (id: string) => apiFetch(`/v1/platform/branding-presets/${id}`, { method: "DELETE" }),
  applyBrandingPreset: (tenantId: string, presetId: string) =>
    apiFetch(`/v1/platform/tenants/${tenantId}/branding/apply-preset`, { method: "POST", body: JSON.stringify({ presetId }) }),

  // --- Platform analytics ---
  getPlatformBusinessAnalytics: (churnWindowDays = 30) =>
    apiFetch<{
      totalTenants: number;
      mrr: number;
      churnRate: number;
      churnWindowDays: number;
      byTier: Record<string, number>;
      byState: Record<string, number>;
    }>(`/v1/platform/analytics/business?churnWindowDays=${churnWindowDays}`),
  getPlatformUsageAnalytics: (days = 30) =>
    apiFetch<{
      windowDays: number;
      totalTokens: number;
      totalCostUsd: number;
      byProvider: Record<string, { inputTokens: number; outputTokens: number; requests: number; estimatedCostUsd: number }>;
    }>(`/v1/platform/analytics/usage?days=${days}`),
};
