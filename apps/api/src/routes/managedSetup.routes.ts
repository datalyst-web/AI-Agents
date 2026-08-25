import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { writeAuditLog } from "../lib/audit.js";

const StartImpersonationSchema = z.object({
  tenantId: z.string().uuid(),
  reason: z.string().min(1).max(300),
  durationMinutes: z.number().int().min(5).max(240).default(60),
});

/**
 * The only way a setup_specialist ever gets tenant access — a fresh,
 * explicitly-scoped, time-boxed session (CLAUDE.md's "Internal roles &
 * access"). Once started, the returned token carries the impersonation
 * claim and every subsequent request goes through the exact same
 * tenant-scoped routes/RLS as a client would use — never a bypass path.
 */
export async function registerManagedSetupRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/managed-setup/impersonate/start", { preHandler: app.authenticate }, async (request, reply) => {
    if (request.authUser!.role !== "setup_specialist") {
      reply.code(403).send({ error: "not_a_setup_specialist" });
      return;
    }
    const body = StartImpersonationSchema.parse(request.body);
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + body.durationMinutes * 60_000);

    await withPlatformContext(ctx.prisma, async (tx) => {
      await tx.staffImpersonationSession.create({
        data: {
          id: sessionId,
          tenantId: body.tenantId,
          staffUserId: request.authUser!.sub,
          reason: body.reason,
          expiresAt,
        },
      });
    });

    await withTenant(ctx.prisma, { tenantId: body.tenantId }, (tx) =>
      writeAuditLog(tx, { tenantId: body.tenantId, impersonation: { staffUserId: request.authUser!.sub, sessionId, expiresAt: expiresAt.toISOString() } }, {
        actorUserId: request.authUser!.sub,
        action: "impersonation_session_started",
        metadata: { reason: body.reason, durationMinutes: body.durationMinutes },
      }),
    );

    const token = await reply.jwtSign({
      sub: request.authUser!.sub,
      role: "setup_specialist",
      impersonation: { staffUserId: request.authUser!.sub, sessionId, expiresAt: expiresAt.toISOString() },
    });

    reply.send({ token, sessionId, tenantId: body.tenantId, expiresAt: expiresAt.toISOString() });
  });

  app.post("/v1/managed-setup/impersonate/:sessionId/end", { preHandler: app.authenticate }, async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string };
    if (request.authUser!.role !== "setup_specialist") {
      reply.code(403).send({ error: "not_a_setup_specialist" });
      return;
    }

    const session = await withPlatformContext(ctx.prisma, (tx) =>
      tx.staffImpersonationSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } }),
    );

    await withTenant(ctx.prisma, { tenantId: session.tenantId }, (tx) =>
      writeAuditLog(tx, { tenantId: session.tenantId }, {
        actorUserId: request.authUser!.sub,
        action: "impersonation_session_ended",
        metadata: { sessionId },
      }),
    );

    reply.send({ ended: true });
  });

  /** Tenants currently in an Assisted/Fully-Managed setup tier — the staff worklist. */
  app.get("/v1/managed-setup/queue", { preHandler: app.authenticate }, async (request, reply) => {
    if (request.authUser!.role !== "setup_specialist" && request.authUser!.role !== "platform_admin") {
      reply.code(403).send({ error: "forbidden" });
      return;
    }
    const tenants = await withPlatformContext(ctx.prisma, (tx) =>
      tx.tenant.findMany({ where: { managedSetupTier: { in: ["ASSISTED_SETUP", "FULLY_MANAGED"] } }, orderBy: { updatedAt: "asc" } }),
    );
    reply.send(tenants);
  });
}
