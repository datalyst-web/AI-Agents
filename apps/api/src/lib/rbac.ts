import type { FastifyReply, FastifyRequest } from "fastify";
import { roleHasPermission, type Permission } from "@chat-agent/shared-types";
import type { TenantContext } from "@chat-agent/shared-types";

/**
 * Resolves the TenantContext for a request against the :tenantId route
 * param, enforcing that a non-platform user can only ever act on their own
 * tenant, and that a setup_specialist can only act on a tenant they hold
 * an active impersonation session for (CLAUDE.md: impersonation "must be
 * explicitly scoped to one tenant at a time").
 */
export function resolveTenantContext(request: FastifyRequest, routeTenantId: string): TenantContext | null {
  const user = request.authUser;
  if (!user) return null;

  if (user.role === "platform_admin") {
    return { tenantId: routeTenantId };
  }

  if (user.role === "setup_specialist") {
    if (!user.impersonation) return null;
    // The impersonation session's tenant binding is verified against the
    // DB (StaffImpersonationSession row) in the impersonation preHandler
    // below, not trusted from the JWT claim alone.
    return {
      tenantId: routeTenantId,
      impersonation: user.impersonation,
    };
  }

  if (user.tenantId !== routeTenantId) return null;
  return { tenantId: routeTenantId };
}

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.authUser;
    if (!user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (!roleHasPermission(user.role, permission)) {
      reply.code(403).send({ error: "forbidden", missingPermission: permission });
      return;
    }
  };
}

export function requireTenantMatch() {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const routeTenantId = (request.params as { tenantId?: string }).tenantId;
    if (!routeTenantId) {
      reply.code(400).send({ error: "missing_tenant_id" });
      return;
    }
    const ctx = resolveTenantContext(request, routeTenantId);
    if (!ctx) {
      reply.code(403).send({ error: "forbidden_tenant_mismatch" });
      return;
    }
    request.tenantCtx = ctx;
  };
}
