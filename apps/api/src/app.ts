import Fastify, { type FastifyError } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import authPlugin from "./plugins/auth.js";
import { buildAppContext, type AppContext } from "./lib/context.js";
import { env } from "./env.js";

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
import { registerWidgetConfigRoutes } from "./routes/widgetConfig.routes.js";
import { registerUsageRoutes } from "./routes/usage.routes.js";
import { registerApprovalRoutes } from "./routes/approvals.routes.js";
import { registerAuditRoutes } from "./routes/audit.routes.js";
import { registerMemoryRoutes, registerPublicMemoryRoutes } from "./routes/memory.routes.js";
import { registerBillingRoutes } from "./routes/billing.routes.js";

export async function buildApp(ctx: AppContext = buildAppContext()) {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    trustProxy: true,
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
  await app.register(rateLimit, { max: env.API_RATE_LIMIT_PER_MIN, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
  await app.register(authPlugin);

  app.get("/healthz", async () => ({ status: "ok", timestamp: new Date().toISOString() }));
  app.get("/healthz/providers", async () => ctx.router.healthCheckAll());

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
  await registerUsageRoutes(app, ctx);
  await registerApprovalRoutes(app, ctx);
  await registerAuditRoutes(app, ctx);
  await registerMemoryRoutes(app, ctx);
  await registerBillingRoutes(app, ctx); // server-to-server webhook — CORS is moot, no browser involved

  app.setErrorHandler((err: FastifyError, request, reply) => {
    request.log.error(err);
    // Prisma's "record required but not found" (findFirstOrThrow, a
    // delete/update targeting an id that's gone, etc.) has no .statusCode
    // of its own, so it fell through to a raw 500 "internal_error" —
    // scary and wrong for what's really just a 404, e.g. re-fetching an
    // agent right after deleting it. Every findFirstOrThrow across the
    // app benefits from this, not just one route.
    const isPrismaNotFound = (err as { code?: string }).code === "P2025";
    const statusCode = isPrismaNotFound ? 404 : (err.statusCode ?? 500);
    reply.code(statusCode).send({
      error: isPrismaNotFound ? "not_found" : statusCode >= 500 ? "internal_error" : err.message,
    });
  });

  return app;
}
