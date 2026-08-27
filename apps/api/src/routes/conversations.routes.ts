import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import { fireWorkflowTrigger } from "@chat-agent/workflow-engine";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

export async function registerConversationRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("conversation:read")];

  app.get("/v1/tenants/:tenantId/agents/:agentId/conversations", { preHandler: scoped }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    const { limit, outcome } = request.query as { limit?: string; outcome?: string };
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.conversation.findMany({
        where: {
          tenantId: request.tenantCtx!.tenantId,
          agentId,
          outcome: outcome ? (outcome as never) : undefined,
        },
        orderBy: { startedAt: "desc" },
        take: limit ? Number(limit) : 50,
      }),
    );
  });

  app.get("/v1/tenants/:tenantId/conversations/:conversationId", { preHandler: scoped }, async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const conversation = await tx.conversation.findFirstOrThrow({
        where: { id: conversationId, tenantId: request.tenantCtx!.tenantId },
      });
      const messages = await tx.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } });
      return { conversation, messages };
    });
  });

  /**
   * Staff-facing "this conversation is done" call — the only code path
   * that ever sets outcome=RESOLVED (the agent loop itself never
   * self-declares resolution; CLAUDE.md's anti-hallucination principle
   * applies here too — resolution is a human judgment call, not an
   * inference). Also the only thing that fires CONVERSATION_ENDED, since
   * nothing else in the system currently produces that trigger.
   */
  app.post(
    "/v1/tenants/:tenantId/conversations/:conversationId/resolve",
    { preHandler: [...scoped, requirePermission("conversation:write")] },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const conversation = await tx.conversation.findFirstOrThrow({
          where: { id: conversationId, tenantId: request.tenantCtx!.tenantId },
        });
        if (conversation.outcome !== "IN_PROGRESS") {
          throw Object.assign(new Error("Only an in-progress conversation can be marked resolved."), { statusCode: 409 });
        }
        const result = await tx.conversation.update({
          where: { id: conversationId },
          data: { outcome: "RESOLVED", endedAt: new Date() },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          agentId: conversation.agentId,
          action: "conversation_marked_resolved",
          metadata: { conversationId },
        });
        await fireWorkflowTrigger(tx, ctx.queue, {
          tenantId: request.tenantCtx!.tenantId,
          agentId: conversation.agentId,
          triggerType: "CONVERSATION_ENDED",
          payload: { conversationId, customerIdentityId: conversation.customerIdentityId },
          queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
        });
        return result;
      });
      reply.send(updated);
    },
  );

  app.get(
    "/v1/tenants/:tenantId/conversations/:conversationId/export",
    { preHandler: [...scoped, requirePermission("conversation:export")] },
    async (request, reply) => {
      const { conversationId } = request.params as { conversationId: string };
      const { conversation, messages } = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => ({
        conversation: await tx.conversation.findFirstOrThrow({ where: { id: conversationId, tenantId: request.tenantCtx!.tenantId } }),
        messages: await tx.message.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" } }),
      }));
      reply.header("content-disposition", `attachment; filename="conversation-${conversationId}.json"`);
      reply.send({ conversation, messages });
    },
  );

  /** Aggregate analytics per CLAUDE.md's Conversation Analytics & Quality section. */
  app.get(
    "/v1/tenants/:tenantId/agents/:agentId/analytics",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("analytics:read")] },
    async (request) => {
      const { agentId } = request.params as { agentId: string };
      return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const conversations = await tx.conversation.findMany({ where: { tenantId: request.tenantCtx!.tenantId, agentId } });
        const total = conversations.length;
        const byOutcome = conversations.reduce<Record<string, number>>((acc, c) => {
          acc[c.outcome] = (acc[c.outcome] ?? 0) + 1;
          return acc;
        }, {});
        const byDropOff = conversations.reduce<Record<string, number>>((acc, c) => {
          acc[c.dropOffPoint] = (acc[c.dropOffPoint] ?? 0) + 1;
          return acc;
        }, {});
        const avgSentiment =
          conversations.flatMap((c) => c.sentimentTrend).reduce((a, b) => a + b, 0) /
          Math.max(1, conversations.flatMap((c) => c.sentimentTrend).length);
        return { total, byOutcome, byDropOff, avgSentiment };
      });
    },
  );

  /** Daily conversation volume + average sentiment for the last N days, for the analytics trend chart. */
  app.get(
    "/v1/tenants/:tenantId/agents/:agentId/analytics/daily",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("analytics:read")] },
    async (request) => {
      const { agentId } = request.params as { agentId: string };
      const { days } = request.query as { days?: string };
      const windowDays = Math.min(90, Math.max(1, Number(days) || 14));
      const since = new Date();
      since.setDate(since.getDate() - (windowDays - 1));
      since.setHours(0, 0, 0, 0);

      return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const conversations = await tx.conversation.findMany({
          where: { tenantId: request.tenantCtx!.tenantId, agentId, startedAt: { gte: since } },
          select: { startedAt: true, sentimentTrend: true },
        });

        const byDay = new Map<string, { conversations: number; sentimentSum: number; sentimentCount: number }>();
        for (let i = 0; i < windowDays; i++) {
          const d = new Date(since);
          d.setDate(d.getDate() + i);
          byDay.set(d.toISOString().slice(0, 10), { conversations: 0, sentimentSum: 0, sentimentCount: 0 });
        }
        for (const c of conversations) {
          const key = c.startedAt.toISOString().slice(0, 10);
          const entry = byDay.get(key);
          if (!entry) continue;
          entry.conversations += 1;
          for (const s of c.sentimentTrend) {
            entry.sentimentSum += s;
            entry.sentimentCount += 1;
          }
        }
        return Array.from(byDay.entries()).map(([date, d]) => ({
          date,
          conversations: d.conversations,
          avgSentiment: d.sentimentCount > 0 ? d.sentimentSum / d.sentimentCount : null,
        }));
      });
    },
  );
}
