import jwt from "jsonwebtoken";
import * as Sentry from "@sentry/node";
import Fastify, { type FastifyError, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import authPlugin from "./plugins/auth.js";
import { requirePermission } from "./lib/rbac.js";
import { buildAppContext, type AppContext } from "./lib/context.js";
import { env } from "./env.js";

/**
 * Buckets by tenant, not by client IP, whenever a request's Bearer token
 * names one — a dashboard JWT's `tenantId` claim, or a widget token's
 * (see lib/widgetToken.ts; both are plain JWTs signed with JWT_SECRET, so
 * one decode call handles either shape). jwt.decode() deliberately does
 * NOT verify the signature — this is only ever used to pick a rate-limit
 * bucket, never an authorization decision, so a forged/expired token
 * simply lands in its own (harmless) bucket; real auth still verifies it
 * properly downstream. Falls back to per-IP for anything with no
 * decodable tenantId — pre-auth routes (login, signup) and a staff
 * session's own JWT, which deliberately carries no tenantId while
 * impersonating (see auth.routes.ts's /me comment).
 */
export function rateLimitKey(request: FastifyRequest): string {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.decode(authHeader.slice(7)) as { tenantId?: string } | null;
      if (decoded?.tenantId) return `tenant:${decoded.tenantId}`;
    } catch {
      // Malformed token — fall through to IP.
    }
  }
  return `ip:${request.ip}`;
}

import { registerAuthRoutes } from "./routes/auth.routes.js";
import { registerTenantRoutes } from "./routes/tenants.routes.js";
import { registerAgentRoutes } from "./routes/agents.routes.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.routes.js";
import { registerChatRoutes } from "./routes/chat.routes.js";
import { registerConversationRoutes } from "./routes/conversations.routes.js";
import { registerToolRoutes } from "./routes/tools.routes.js";
import { registerWorkflowRoutes } from "./routes/workflows.routes.js";
import { registerManagedSetupRoutes } from "./routes/managedSetup.routes.js";
import { registerPlatformStaffRoutes } from "./routes/platformStaff.routes.js";
import { registerChannelRoutes } from "./routes/channels.routes.js";
import { registerIntegrationRoutes } from "./routes/integrations.routes.js";
import { registerWidgetConfigRoutes } from "./routes/widgetConfig.routes.js";
import { registerUsageRoutes } from "./routes/usage.routes.js";
import { registerApprovalRoutes } from "./routes/approvals.routes.js";
import { registerAuditRoutes } from "./routes/audit.routes.js";
import { registerTeamRoutes } from "./routes/team.routes.js";
import { registerWordpressConnectRoutes } from "./routes/wordpressConnect.routes.js";
import { registerFeatureFlagRoutes } from "./routes/featureFlags.routes.js";
import { registerPromptTemplateRoutes } from "./routes/promptTemplates.routes.js";
import { registerBrandingPresetRoutes } from "./routes/brandingPresets.routes.js";
import { registerIncidentRoutes } from "./routes/incidents.routes.js";
import { registerSupportTicketRoutes } from "./routes/supportTickets.routes.js";
import { registerSecurityFlagRoutes } from "./routes/securityFlags.routes.js";
import { registerPlatformAnalyticsRoutes } from "./routes/platformAnalytics.routes.js";
import { registerMemoryRoutes, registerPublicMemoryRoutes } from "./routes/memory.routes.js";
import { registerPaynowBillingRoutes } from "./routes/paynowBilling.routes.js";

export async function buildApp(ctx: AppContext = buildAppContext()) {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
  });

  // Uses Fastify's onError hook internally (not setErrorHandler), so this
  // coexists cleanly with the custom setErrorHandler below — Sentry just
  // observes/reports errors here, the custom handler still owns the actual
  // HTTP response. A no-op when SENTRY_DSN isn't set (see instrument.ts).
  Sentry.setupFastifyErrorHandler(app);

  // MUST be set before any route or plugin is registered: Fastify captures
  // the error handler into each route's context at registration time, so
  // this used to sit at the bottom of the function and applied to no route
  // at all. Every 500 went out through Fastify's default handler instead,
  // whose body carries the raw error message — a database outage handed
  // any anonymous caller the database host, port and vendor, and showed
  // the same text on the login page.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    // Prisma's "record required but not found" (findFirstOrThrow, a
    // delete/update targeting an id that's gone, etc.) has no .statusCode
    // of its own, so it would otherwise surface as a 500 — scary and wrong
    // for what's really just a 404, e.g. re-fetching an agent right after
    // deleting it.
    if ((err as { code?: string }).code === "P2025") {
      reply.code(404).send({ error: "not_found" });
      return;
    }
    // Schema.parse() on a request body throws a ZodError, which carries no
    // statusCode — it's the caller's bad input, so 400 with the first
    // issue's message (which describes their input, never our internals).
    if (err.name === "ZodError") {
      const issue = (err as unknown as { issues?: { message?: string }[] }).issues?.[0];
      reply.code(400).send({ error: "invalid_request", message: issue?.message ?? "Some of the details sent were invalid." });
      return;
    }
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error(err);
      // Never err.message here — the full error is in the log and Sentry.
      reply.code(statusCode).send({ error: "internal_error", message: "Something went wrong on our side. Please try again in a moment." });
      return;
    }
    reply.code(statusCode).send({ error: err.message });
  });

  // A single CORS registration, policy chosen per-request via the
  // `delegator` callback (registering @fastify/cors twice — once per route
  // group — collides: it installs one process-wide catch-all OPTIONS route
  // internally, so a second registration throws FST_ERR_DUPLICATED_ROUTE
  // at boot). The public widget surface (CLAUDE.md: "embed script
  // identifies tenant + agent securely") is reachable from ANY tenant's
  // website, so it gets an open origin — safe here because auth on that
  // surface is a Bearer widget token scoped to one agent, never a cookie,
  // so reflecting any origin can't leak a session. Everything else (the
  // cookie/JWT-authenticated dashboard) keeps the strict allowlist.
  const PUBLIC_PATH_PREFIXES = ["/v1/chat/", "/v1/widget-config/"];
  await app.register(cors, {
    delegator: (request, callback) => {
      const isPublic = PUBLIC_PATH_PREFIXES.some((prefix) => request.url.startsWith(prefix));
      callback(null, isPublic ? { origin: true, credentials: false } : { origin: env.API_CORS_ORIGINS, credentials: true });
    },
  });
  await app.register(rateLimit, {
    timeWindow: "1 minute",
    keyGenerator: rateLimitKey,
    max: (request) => (rateLimitKey(request).startsWith("tenant:") ? env.API_RATE_LIMIT_PER_TENANT_PER_MIN : env.API_RATE_LIMIT_PER_MIN),
  });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(authPlugin);

  app.get("/healthz", async () => ({ status: "ok", timestamp: new Date().toISOString() }));
  // Gated (unlike plain /healthz above, which stays public for load-balancer
  // liveness checks) — this one names actual AI vendors (Anthropic/OpenAI/
  // Gemini) in its response, which CLAUDE.md's white-label principle says
  // should never be reachable by anyone outside the platform team.
  app.get(
    "/healthz/providers",
    { preHandler: [app.authenticate, requirePermission("platform:manage_tenants")] },
    async () => ctx.router.healthCheckAll(),
  );

  await registerChatRoutes(app, ctx);
  await registerWidgetConfigRoutes(app, ctx);
  await registerPublicMemoryRoutes(app, ctx);

  await registerAuthRoutes(app, ctx);
  await registerTenantRoutes(app, ctx);
  await registerAgentRoutes(app, ctx);
  await registerKnowledgeRoutes(app, ctx);
  await registerConversationRoutes(app, ctx);
  await registerToolRoutes(app, ctx);
  await registerWorkflowRoutes(app, ctx);
  await registerManagedSetupRoutes(app, ctx);
  await registerPlatformStaffRoutes(app, ctx);
  await registerChannelRoutes(app, ctx);
  await registerIntegrationRoutes(app, ctx);
  await registerUsageRoutes(app, ctx);
  await registerApprovalRoutes(app, ctx);
  await registerAuditRoutes(app, ctx);
  await registerTeamRoutes(app, ctx);
  await registerWordpressConnectRoutes(app, ctx);
  await registerFeatureFlagRoutes(app, ctx);
  await registerPromptTemplateRoutes(app, ctx);
  await registerBrandingPresetRoutes(app, ctx);
  await registerIncidentRoutes(app, ctx);
  await registerSupportTicketRoutes(app, ctx);
  await registerSecurityFlagRoutes(app, ctx);
  await registerPlatformAnalyticsRoutes(app, ctx);
  await registerMemoryRoutes(app, ctx);
  await registerPaynowBillingRoutes(app, ctx); // includes a server-to-server webhook — CORS is moot there, no browser involved

  return app;
}
