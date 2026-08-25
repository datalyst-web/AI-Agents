import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import { resolveCustomerIdentity, createForgetRequest, fulfillForgetRequest } from "@chat-agent/memory-engine";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { verifyWidgetToken } from "../lib/widgetToken.js";

const ForgetRequestSchema = z.object({
  identifierType: z.enum(["authenticated_account", "email", "widget_session_cookie"]),
  identifierValue: z.string().min(1),
});

/**
 * "A customer can request their memory be reset or forgotten; this must be
 * a supported, auditable action ... not a manual database operation" —
 * CLAUDE.md Memory Engine. Widget-token authenticated and self-fulfilling
 * (no staff needed) — registered under app.ts's public/open-CORS route
 * group alongside chat.routes.ts, since it's called from the same
 * arbitrary client-website context as the rest of the widget.
 */
export async function registerPublicMemoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/chat/:agentId/memory/forget", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const claim = bearer ? verifyWidgetToken(bearer) : undefined;
    if (!claim || claim.agentId !== agentId) {
      reply.code(401).send({ error: "invalid_or_missing_widget_token" });
      return;
    }
    const body = ForgetRequestSchema.parse(request.body);

    await withTenant(ctx.prisma, { tenantId: claim.tenantId, agentId }, async (tx) => {
      const identity = await resolveCustomerIdentity(tx, {
        tenantId: claim.tenantId,
        agentId,
        identifierType: body.identifierType,
        identifierValue: body.identifierValue,
      });
      const req = await createForgetRequest(tx, { tenantId: claim.tenantId, agentId, customerIdentityId: identity.id });
      await fulfillForgetRequest(tx, { requestId: req.id, tenantId: claim.tenantId });
    });

    reply.send({ forgotten: true });
  });
}

/** Tenant-dashboard-facing: cases raised through support instead of the widget directly. */
export async function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/v1/tenants/:tenantId/memory/forget-requests",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("conversation:read")] },
    async (request) => {
      return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.memoryForgetRequest.findMany({ where: { tenantId: request.tenantCtx!.tenantId }, orderBy: { requestedAt: "desc" }, take: 100 }),
      );
    },
  );
}
