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
    const [tenants, agents] = await withPlatformContext(ctx.prisma, async (tx) => {
      const tenants = await tx.tenant.findMany({
        where: { managedSetupTier: { in: ["ASSISTED_SETUP", "FULLY_MANAGED"] } },
        orderBy: { updatedAt: "asc" },
      });
      // Onboarding-pipeline visibility (CLAUDE.md Managed Setup Service) —
      // which stage each managed client's own agent(s) are actually at,
      // not just the tenant-level tier/subscription badges the queue
      // already showed. A staff member picking up their queue needs to
      // see "still on DRAFT" vs "sitting in TESTING waiting on client
      // approval" without opening every single tenant first.
      const agents = await tx.agent.findMany({
        where: { tenantId: { in: tenants.map((t) => t.id) } },
        select: { tenantId: true, id: true, name: true, status: true },
      });
      return [tenants, agents] as const;
    });

    const agentsByTenant = new Map<string, typeof agents>();
    for (const agent of agents) {
      const list = agentsByTenant.get(agent.tenantId) ?? [];
      list.push(agent);
      agentsByTenant.set(agent.tenantId, list);
    }

    // logoObjectKey is an internal S3 key — never leak it, expose the
    // servable route instead (same transform as GET /v1/tenants/:tenantId).
    reply.send(
      tenants.map(({ logoObjectKey, ...rest }) => ({
        ...rest,
        logoUrl: logoObjectKey ? `/v1/tenants/${rest.id}/branding/logo` : null,
        agents: (agentsByTenant.get(rest.id) ?? []).map(({ tenantId: _tenantId, ...a }) => a),
      })),
    );
  });
}
