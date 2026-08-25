import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch } from "../lib/rbac.js";

/**
 * Tenant-visible audit log — this is what backs the dashboard's "added by
 * AI Setup Team" distinction and gives a tenant_owner/admin full
 * visibility into every staff action taken on their behalf (CLAUDE.md
 * "Required audit trail"). Deliberately available to tenant_admin/owner
 * without a separate permission flag — hiding staff activity from the
 * client would defeat the purpose of the audit trail.
 */
export async function registerAuditRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/v1/tenants/:tenantId/audit-log",
    { preHandler: [app.authenticate, requireTenantMatch()] },
    async (request) => {
      const { limit, agentId } = request.query as { limit?: string; agentId?: string };
      return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.auditLogEntry.findMany({
          where: { tenantId: request.tenantCtx!.tenantId, agentId },
          orderBy: { timestamp: "desc" },
          take: limit ? Number(limit) : 100,
        }),
      );
    },
  );
}
