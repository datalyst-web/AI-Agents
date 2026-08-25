import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "@chat-agent/db";

/**
 * Verifies a setup_specialist's JWT impersonation claim against a live,
 * unexpired StaffImpersonationSession row for the target tenant — the JWT
 * claim alone is a hint, this DB check is the actual authorization
 * (CLAUDE.md: "gate it behind its own role/permission, log every action,
 * and time-box each session"). Call this AFTER requireTenantMatch().
 */
export function verifyActiveImpersonation(prisma: PrismaClient) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.authUser;
    if (!user || user.role !== "setup_specialist") return; // not staff — nothing to verify

    const ctx = request.tenantCtx;
    if (!ctx?.impersonation) {
      reply.code(403).send({ error: "no_active_impersonation_session" });
      return;
    }

    const session = await prisma.staffImpersonationSession.findFirst({
      where: {
        id: ctx.impersonation.sessionId,
        tenantId: ctx.tenantId,
        staffUserId: ctx.impersonation.staffUserId,
        endedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      reply.code(403).send({ error: "impersonation_session_not_active" });
      return;
    }
  };
}
