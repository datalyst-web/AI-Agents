import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import { SubscriptionStateSchema, SubscriptionTierSchema, ManagedSetupTierSchema, DashboardThemeSchema } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requirePermission, resolveTenantContext, requireTenantMatch } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";

const UpdateTenantSchema = z.object({
  subscriptionState: SubscriptionStateSchema.optional(),
  subscriptionTier: SubscriptionTierSchema.optional(),
  managedSetupTier: ManagedSetupTierSchema.optional(),
  delegatesAutoPublish: z.boolean().optional(),
});

/**
 * platform_admin-only tenant management. On subscription expiry the
 * tenant is suspended, never deleted — see CLAUDE.md "On expiry, suspend
 * the agent — never delete client data." Suspension is a state change
 * here; the actual inbound-request fallback behavior lives in
 * chat.routes.ts, which checks subscriptionState before processing a turn.
 */
export async function registerTenantRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/v1/platform/tenants",
    { preHandler: [app.authenticate, requirePermission("platform:manage_tenants")] },
    async () => {
      return withPlatformContext(ctx.prisma, (tx) => tx.tenant.findMany({ orderBy: { createdAt: "desc" } }));
    },
  );

  app.patch(
    "/v1/platform/tenants/:tenantId",
    { preHandler: [app.authenticate, requirePermission("platform:manage_tenants")] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const body = UpdateTenantSchema.parse(request.body);
      const updated = await withPlatformContext(ctx.prisma, (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: body }),
      );
      reply.send(updated);
    },
  );

  app.get("/v1/tenants/:tenantId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const requestCtx = resolveTenantContext(request, tenantId);
    if (!requestCtx) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }
    const tenant = await withTenant(ctx.prisma, requestCtx, (tx) =>
      tx.tenant.findFirstOrThrow({ where: { id: tenantId } }),
    );
    reply.send(tenant);
  });

  /**
   * Client-facing theme preference — deliberately separate from the
   * platform_admin-only PATCH above (billing/tier fields vs. a cosmetic
   * choice any tenant with agent:write can make for themselves). Drives
   * both the dashboard's own chrome and every one of this tenant's
   * widgets in one shot (see widgetConfig.routes.ts).
   */
  app.patch(
    "/v1/tenants/:tenantId/theme",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("agent:write")] },
    async (request, reply) => {
      const { theme } = z.object({ theme: DashboardThemeSchema }).parse(request.body);
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const tenant = await tx.tenant.update({ where: { id: request.tenantCtx!.tenantId }, data: { theme } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          action: "tenant_theme_updated",
          metadata: { theme },
        });
        return tenant;
      });
      reply.send(updated);
    },
  );
}
