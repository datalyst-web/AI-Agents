import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireStaff } from "../lib/rbac.js";

/**
 * Platform-wide view of everything agentLoop.ts's heuristic
 * prompt-injection check has flagged, across every tenant — CLAUDE.md's
 * "Abuse/prompt-injection/jailbreak attempt flagging," for staff triage,
 * never an automatic block on the conversation itself.
 */
export async function registerSecurityFlagRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireStaff()];

  app.get("/v1/platform/security-flags", { preHandler: scoped }, async (request) => {
    const { reviewed } = request.query as { reviewed?: string };
    const flags = await withPlatformContext(ctx.prisma, (tx) =>
      tx.promptInjectionFlag.findMany({
        where: reviewed !== undefined ? { reviewed: reviewed === "true" } : undefined,
        orderBy: { flaggedAt: "desc" },
        take: 200,
        include: { tenant: { select: { name: true } } },
      }),
    );
    return flags;
  });

  app.patch("/v1/platform/security-flags/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    z.object({ reviewed: z.literal(true) }).parse(request.body);
    const existing = await withPlatformContext(ctx.prisma, (tx) => tx.promptInjectionFlag.findUniqueOrThrow({ where: { id } }));
    const flag = await withTenant(ctx.prisma, { tenantId: existing.tenantId }, (tx) =>
      tx.promptInjectionFlag.update({
        where: { id },
        data: { reviewed: true, reviewedByUserId: request.authUser!.sub, reviewedAt: new Date() },
      }),
    );
    reply.send(flag);
  });
}
