import jwt from "jsonwebtoken";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, type Prisma } from "@chat-agent/db";
import type { TenantContext } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

interface GoogleCalendarOAuthState {
  purpose: "google_calendar_oauth";
  tenantId: string;
  agentId: string;
  actorUserId: string;
}

function signOAuthState(payload: GoogleCalendarOAuthState): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: "10m" });
}

function verifyOAuthState(token: string): GoogleCalendarOAuthState {
  const decoded = jwt.verify(token, env.JWT_SECRET) as GoogleCalendarOAuthState;
  if (decoded.purpose !== "google_calendar_oauth") throw new Error("wrong token purpose");
  return decoded;
}

const ConnectHubspotSchema = z.object({ accessToken: z.string().min(10) });
const ConnectZendeskSchema = z.object({
  subdomain: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, "Subdomain only (e.g. \"acme\", not the full zendesk.com URL)."),
  email: z.string().email(),
  apiToken: z.string().min(5),
});

const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_CALENDAR_TOOL_NAMES = { book: "Google Calendar — Book appointment", cancel: "Google Calendar — Cancel appointment" };

function googleCalendarRedirectUri(): string {
  return `${env.API_PUBLIC_BASE_URL}/v1/integrations/google-calendar/oauth/callback`;
}

/**
 * Business-tool integrations (HubSpot CRM, Zendesk ticketing, Google
 * Calendar) — deliberately client-actionable (integration:connect, see
 * shared-types/rbac.ts) rather than folded into the staff-only Tools page,
 * for the same reason as channels.routes.ts: connecting one hands over
 * the client's own account, which staff never has.
 */
export async function registerIntegrationRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get(
    "/v1/tenants/:tenantId/agents/:agentId/integrations",
    { preHandler: [...scoped, requirePermission("agent:read")] },
    async (request) => {
      const { agentId } = request.params as { agentId: string };
      const definitions = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.toolDefinition.findMany({
          where: { tenantId: request.tenantCtx!.tenantId, OR: [{ agentId }, { agentId: null }], enabled: true },
        }),
      );
      const vendors = ["hubspot", "zendesk", "google_calendar"] as const;
      return vendors.map((vendor) => {
        const match = definitions.find((d) => (d.config as Record<string, unknown>)?.vendor === vendor);
        return {
          vendor,
          connected: Boolean(match),
          label: vendor === "zendesk" && match ? ((match.config as Record<string, unknown>).subdomain as string) : undefined,
        };
      });
    },
  );

  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/integrations/hubspot/connect",
    { preHandler: [...scoped, requirePermission("integration:connect")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const { accessToken } = ConnectHubspotSchema.parse(request.body);

      try {
        const resp = await fetch("https://api.hubapi.com/crm/v3/objects/contacts?limit=1", {
          headers: { authorization: `Bearer ${accessToken}` },
        });
        if (!resp.ok) throw new Error(`HubSpot rejected this token (HTTP ${resp.status}).`);
      } catch (err) {
        reply.code(400).send({ error: "invalid_hubspot_token", message: err instanceof Error ? err.message : "Could not verify this token with HubSpot." });
        return;
      }

      const toolId = await upsertVendorTool(ctx, request.tenantCtx!, {
        agentId,
        name: "HubSpot CRM",
        category: "crm",
        config: { vendor: "hubspot" },
        credentialValue: accessToken,
        executionTier: "automatic",
        actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
      });
      reply.send({ vendor: "hubspot", connected: true, toolId });
    },
  );

  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/integrations/zendesk/connect",
    { preHandler: [...scoped, requirePermission("integration:connect")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const { subdomain, email, apiToken } = ConnectZendeskSchema.parse(request.body);

      try {
        const basicAuth = Buffer.from(`${email}/token:${apiToken}`).toString("base64");
        const resp = await fetch(`https://${subdomain}.zendesk.com/api/v2/users/me.json`, {
          headers: { authorization: `Basic ${basicAuth}` },
        });
        if (!resp.ok) throw new Error(`Zendesk rejected these credentials (HTTP ${resp.status}).`);
      } catch (err) {
        reply.code(400).send({ error: "invalid_zendesk_credentials", message: err instanceof Error ? err.message : "Could not verify these credentials with Zendesk." });
        return;
      }

      const toolId = await upsertVendorTool(ctx, request.tenantCtx!, {
        agentId,
        name: `Zendesk (${subdomain})`,
        category: "ticketing",
        config: { vendor: "zendesk", subdomain },
        credentialValue: JSON.stringify({ email, apiToken }),
        executionTier: "automatic",
        actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
      });
      reply.send({ vendor: "zendesk", connected: true, toolId });
    },
  );

  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/integrations/:vendor/disconnect",
    { preHandler: [...scoped, requirePermission("integration:connect")] },
    async (request, reply) => {
      const { agentId, vendor } = request.params as { agentId: string; vendor: string };
      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const matches = await tx.toolDefinition.findMany({
          where: { tenantId: request.tenantCtx!.tenantId, OR: [{ agentId }, { agentId: null }] },
        });
        const toRemove = matches.filter((d) => (d.config as Record<string, unknown>)?.vendor === vendor);
        for (const tool of toRemove) {
          await tx.toolDefinition.delete({ where: { id: tool.id } });
        }
        if (toRemove.length > 0) {
          const agent = await tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } });
          const removedIds = new Set(toRemove.map((t) => t.id));
          await tx.agent.update({
            where: { id: agentId },
            data: { enabledToolIds: agent.enabledToolIds.filter((id) => !removedIds.has(id)) },
          });
          await writeAuditLog(tx, request.tenantCtx!, {
            actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
            agentId,
            action: "integration_disconnected",
            metadata: { vendor },
          });
        }
      });
      reply.send({ disconnected: true });
    },
  );

  /**
   * Google Calendar needs a real browser redirect to Google's own consent
   * screen (only the account owner can approve that, not an API call) —
   * this route hands back the URL to redirect to rather than redirecting
   * itself, so the dashboard's `fetch()` can still carry the normal Bearer
   * auth header; only the follow-up full-page navigation to Google itself
   * is unauthenticated (as it must be — Google can't send our header).
   */
  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/integrations/google-calendar/connect/start",
    { preHandler: [...scoped, requirePermission("integration:connect")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      if (!env.GOOGLE_CALENDAR_CLIENT_ID) {
        reply.code(501).send({ error: "google_calendar_not_configured" });
        return;
      }
      const state = signOAuthState({
        purpose: "google_calendar_oauth",
        tenantId: request.tenantCtx!.tenantId,
        agentId,
        actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
      });
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.searchParams.set("client_id", env.GOOGLE_CALENDAR_CLIENT_ID);
      url.searchParams.set("redirect_uri", googleCalendarRedirectUri());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("state", state);
      reply.send({ authUrl: url.toString() });
    },
  );

  /** Public — Google redirects the customer's own browser here after consent, with no way to carry our Bearer token. */
  app.get("/v1/integrations/google-calendar/oauth/callback", async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    const dashboardUrl = new URL("/integrations", env.DASHBOARD_BASE_URL);

    if (query.error || !query.code || !query.state) {
      dashboardUrl.searchParams.set("integration_error", query.error ?? "missing_code");
      reply.redirect(dashboardUrl.toString());
      return;
    }

    let statePayload: GoogleCalendarOAuthState;
    try {
      statePayload = verifyOAuthState(query.state);
    } catch {
      dashboardUrl.searchParams.set("integration_error", "invalid_or_expired_state");
      reply.redirect(dashboardUrl.toString());
      return;
    }

    try {
      const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: query.code,
          client_id: env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
          client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
          redirect_uri: googleCalendarRedirectUri(),
          grant_type: "authorization_code",
        }),
      });
      const tokenJson = (await tokenResp.json().catch(() => ({}))) as { refresh_token?: string; error_description?: string };
      if (!tokenResp.ok || !tokenJson.refresh_token) {
        // No refresh_token usually means the user has connected before and
        // Google didn't re-issue one — access_type=offline + prompt=consent
        // above should prevent this, but if it still happens the fix is
        // just reconnecting.
        throw new Error(tokenJson.error_description ?? "Google didn't return a refresh token — try connecting again.");
      }

      const credentialRef = `tenant/${statePayload.tenantId}/tool/google-calendar/${statePayload.agentId}`;
      await ctx.secrets.setSecret(credentialRef, JSON.stringify({ refreshToken: tokenJson.refresh_token }));

      await withTenant(ctx.prisma, { tenantId: statePayload.tenantId }, async (tx) => {
        const bookId = await upsertToolRow(tx, {
          tenantId: statePayload.tenantId,
          agentId: statePayload.agentId,
          name: GOOGLE_CALENDAR_TOOL_NAMES.book,
          category: "calendar",
          config: { vendor: "google_calendar", action: "book", calendarId: "primary" },
          credentialRef,
          executionTier: "confirmation_required",
        });
        const cancelId = await upsertToolRow(tx, {
          tenantId: statePayload.tenantId,
          agentId: statePayload.agentId,
          name: GOOGLE_CALENDAR_TOOL_NAMES.cancel,
          category: "calendar",
          config: { vendor: "google_calendar", action: "cancel", calendarId: "primary" },
          credentialRef,
          executionTier: "confirmation_required",
        });
        await enableToolsForAgent(tx, statePayload.agentId, [bookId, cancelId]);
        await writeAuditLog(tx, { tenantId: statePayload.tenantId }, {
          actorUserId: statePayload.actorUserId,
          agentId: statePayload.agentId,
          action: "integration_connected",
          metadata: { vendor: "google_calendar" },
        });
      });

      dashboardUrl.searchParams.set("connected", "google_calendar");
      reply.redirect(dashboardUrl.toString());
    } catch (err) {
      dashboardUrl.searchParams.set("integration_error", err instanceof Error ? err.message : "google_calendar_connect_failed");
      reply.redirect(dashboardUrl.toString());
    }
  });
}

async function upsertVendorTool(
  ctx: AppContext,
  tenantCtx: TenantContext,
  params: {
    agentId: string;
    name: string;
    category: "crm" | "ticketing";
    config: Record<string, unknown>;
    credentialValue: string;
    executionTier: "automatic" | "confirmation_required" | "human_approval";
    actorUserId: string;
  },
): Promise<string> {
  return withTenant(ctx.prisma, tenantCtx, async (tx) => {
    const credentialRef = `tenant/${tenantCtx.tenantId}/tool/${params.category}-${(params.config.vendor as string)}-${params.agentId}`;
    await ctx.secrets.setSecret(credentialRef, params.credentialValue);
    const toolId = await upsertToolRow(tx, {
      tenantId: tenantCtx.tenantId,
      agentId: params.agentId,
      name: params.name,
      category: params.category,
      config: params.config,
      credentialRef,
      executionTier: params.executionTier,
    });
    await enableToolsForAgent(tx, params.agentId, [toolId]);
    await writeAuditLog(tx, tenantCtx, {
      actorUserId: params.actorUserId,
      agentId: params.agentId,
      action: "integration_connected",
      metadata: { vendor: params.config.vendor },
    });
    return toolId;
  });
}

/** Find-then-create-or-update by (tenantId, agentId, name) — no DB-level unique constraint for this, kept idempotent here so reconnecting never accumulates duplicate rows. */
async function upsertToolRow(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    agentId: string;
    name: string;
    category: "crm" | "ticketing" | "calendar";
    config: Record<string, unknown>;
    credentialRef: string;
    executionTier: "automatic" | "confirmation_required" | "human_approval";
  },
): Promise<string> {
  const existing = await tx.toolDefinition.findFirst({ where: { tenantId: params.tenantId, agentId: params.agentId, name: params.name } });
  if (existing) {
    await tx.toolDefinition.update({
      where: { id: existing.id },
      data: { config: params.config as Prisma.InputJsonValue, credentialRef: params.credentialRef, enabled: true },
    });
    return existing.id;
  }
  const created = await tx.toolDefinition.create({
    data: {
      tenantId: params.tenantId,
      agentId: params.agentId,
      name: params.name,
      description: `${params.name} — connected integration.`,
      category: params.category,
      inputSchema: {},
      outputSchema: {},
      executionTier: params.executionTier,
      config: params.config as Prisma.InputJsonValue,
      credentialRef: params.credentialRef,
      enabled: true,
    },
  });
  return created.id;
}

async function enableToolsForAgent(tx: Prisma.TransactionClient, agentId: string, toolIds: string[]): Promise<void> {
  const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
  const missing = toolIds.filter((id) => !agent.enabledToolIds.includes(id));
  if (missing.length === 0) return;
  await tx.agent.update({ where: { id: agentId }, data: { enabledToolIds: [...agent.enabledToolIds, ...missing] } });
}
