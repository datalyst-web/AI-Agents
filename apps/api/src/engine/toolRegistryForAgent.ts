import {
  ToolRegistry,
  createWebhookTool,
  createApiTool,
  createEmailTool,
  createCrmCreateRecordTool,
  createHubspotCrmTool,
  createCalendarBookTool,
  createCalendarCancelTool,
  createGoogleCalendarBookTool,
  createGoogleCalendarCancelTool,
  createTicketingTool,
  createZendeskTicketingTool,
  createSearchKnowledgeTool,
  type RetrieveFn,
  type ToolHandler,
} from "@chat-agent/tool-sdk";
import type { SecretsProvider } from "@chat-agent/secrets";
import type { Prisma } from "@chat-agent/db";
import type { ExecutionTier } from "@chat-agent/shared-types";

const TIER_RANK: Record<ExecutionTier, number> = {
  automatic: 0,
  confirmation_required: 1,
  human_approval: 2,
};

/**
 * Built-in tools whose factory-hardcoded tier is a safety floor, not just a
 * default — tenant config may raise the tier (e.g. to human_approval) but
 * must never be able to lower it. Only `cancel_appointment` is called out
 * explicitly in CLAUDE.md ("cancelling appointments ... must never be
 * auto-executed"); every other built-in's `defaultExecutionTier` is just
 * the fallback used when a tenant hasn't configured a ToolDefinition row
 * for it, and is otherwise fully overridable in either direction.
 */
const EXECUTION_TIER_FLOORS: Partial<Record<string, ExecutionTier>> = {
  cancel_appointment: "confirmation_required",
};

/**
 * Resolves the tier a built-in handler actually runs at: the tenant's
 * configured ToolDefinition.executionTier (set via the dashboard, POST
 * /v1/tenants/:tenantId/tools) when one exists, clamped up to the tool's
 * safety floor if any; otherwise the factory's own documented default.
 * Without this, a tenant's configured tier had zero effect at runtime —
 * every built-in tool ran at whatever tier its factory hardcoded,
 * regardless of dashboard config (CLAUDE.md principle 5).
 */
function resolveExecutionTier(handler: ToolHandler, configured: ExecutionTier | undefined): ExecutionTier {
  if (!configured) return handler.defaultExecutionTier;
  const floor = EXECUTION_TIER_FLOORS[handler.name];
  if (floor && TIER_RANK[configured] < TIER_RANK[floor]) return floor;
  return configured;
}

/**
 * Builds a ToolRegistry scoped to exactly the ToolDefinition rows a given
 * agent has enabled — the AI must only ever see tools it is authorized to
 * use for that tenant/agent (CLAUDE.md Tool & Action Engine). Each
 * category maps to a tool-sdk handler factory; `config` on the row
 * supplies the vendor-specific wiring (base URL, header names, ...).
 */
export async function buildToolRegistryForAgent(
  tx: Prisma.TransactionClient,
  secrets: SecretsProvider,
  params: {
    tenantId: string;
    agentId: string;
    enabledToolIds: string[];
    retrieve: RetrieveFn;
    // Threaded in from the caller (which already has env access) rather
    // than imported directly here — this file is otherwise fully
    // env-agnostic and its own test exercises it with zero environment
    // setup (a fake Prisma tx, no real DB/config needed); importing env.js
    // directly would make merely IMPORTING this file require a fully
    // valid app configuration (DATABASE_URL, JWT_SECRET, ...), breaking
    // that isolation for two optional Google Calendar values.
    googleCalendar?: { clientId: string; clientSecret: string };
  },
): Promise<ToolRegistry> {
  const registry = new ToolRegistry(secrets);

  // search_knowledge is always available — it's how the agent grounds
  // itself in the tenant's knowledge base rather than guessing.
  registry.register({
    toolId: "builtin:search_knowledge",
    handler: createSearchKnowledgeTool(params.retrieve),
    enabled: true,
  });

  if (params.enabledToolIds.length === 0) return registry;

  const definitions = await tx.toolDefinition.findMany({
    where: {
      tenantId: params.tenantId,
      id: { in: params.enabledToolIds },
      enabled: true,
      OR: [{ agentId: params.agentId }, { agentId: null }],
    },
  });

  for (const def of definitions) {
    const config = (def.config ?? {}) as Record<string, string>;
    const handler = (() => {
      switch (def.category) {
        case "webhook":
          return createWebhookTool({ url: config.url ?? "", headers: parseHeaders(config.headers) });
        case "api":
          return createApiTool({
            baseUrl: config.baseUrl ?? "",
            authHeaderName: config.authHeaderName ?? "Authorization",
          });
        case "email":
          return createEmailTool({
            sendUrl: config.sendUrl ?? "",
            authHeaderName: config.authHeaderName ?? "Authorization",
            fromAddress: config.fromAddress ?? "",
          });
        case "crm":
          if (config.vendor === "hubspot") return createHubspotCrmTool();
          return createCrmCreateRecordTool({
            baseUrl: config.baseUrl ?? "",
            authHeaderName: config.authHeaderName ?? "Authorization",
            objectTypeToPath: parseHeaders(config.objectTypeToPath),
          });
        case "calendar":
          if (config.vendor === "google_calendar") {
            const gcalConfig = {
              clientId: params.googleCalendar?.clientId ?? "",
              clientSecret: params.googleCalendar?.clientSecret ?? "",
              calendarId: config.calendarId ?? "primary",
            };
            return config.action === "cancel" ? createGoogleCalendarCancelTool(gcalConfig) : createGoogleCalendarBookTool(gcalConfig);
          }
          return config.action === "cancel"
            ? createCalendarCancelTool({ baseUrl: config.baseUrl ?? "", authHeaderName: config.authHeaderName ?? "Authorization" })
            : createCalendarBookTool({ baseUrl: config.baseUrl ?? "", authHeaderName: config.authHeaderName ?? "Authorization" });
        case "ticketing":
          if (config.vendor === "zendesk") return createZendeskTicketingTool({ subdomain: config.subdomain ?? "" });
          return createTicketingTool({ baseUrl: config.baseUrl ?? "", authHeaderName: config.authHeaderName ?? "Authorization" });
        default:
          return undefined;
      }
    })();

    if (!handler) continue; // search_database / inventory / orders / custom handled via a future adapter or the generic api/webhook tool.

    registry.register({
      toolId: def.id,
      // Thread the tenant's configured tier into the handler actually
      // consulted by ToolRegistry.execute() — see resolveExecutionTier().
      handler: { ...handler, defaultExecutionTier: resolveExecutionTier(handler, def.executionTier) },
      credentialRef: def.credentialRef ?? undefined,
      enabled: def.enabled,
    });
  }

  return registry;
}

function parseHeaders(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  return raw as Record<string, string>;
}
