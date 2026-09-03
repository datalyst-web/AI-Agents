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
    const { limit, outcome, channel, since, until } = request.query as {
      limit?: string;
      outcome?: string;
      channel?: string;
      since?: string;
      until?: string;
    };
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.conversation.findMany({
        where: {
          tenantId: request.tenantCtx!.tenantId,
          agentId,
          outcome: outcome ? (outcome as never) : undefined,
          channel: channel ? (channel as never) : undefined,
          // `until` is a date picker's end-of-range day, not a timestamp —
          // bump to the START of the NEXT day so that day's own
          // conversations are included, not silently excluded by an
          // implicit 00:00:00 cutoff.
          startedAt:
            since || until
              ? {
                  gte: since ? new Date(since) : undefined,
                  lt: until ? new Date(new Date(until).getTime() + 24 * 60 * 60 * 1000) : undefined,
                }
              : undefined,
        },
        orderBy: { startedAt: "desc" },
        take: limit ? Number(limit) : 50,
      }),
    );
  });

  /**
   * Cross-agent lead/business-result list — every conversation with a
   * businessResult set (lead qualified, sale, ticket created, ...),
   * regardless of which agent it belongs to. The per-agent conversations
   * endpoint above can't answer "show me every lead across my whole
   * business," only one agent at a time.
   */
  app.get("/v1/tenants/:tenantId/leads", { preHandler: scoped }, async (request) => {
    const { limit } = request.query as { limit?: string };
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.conversation.findMany({
        where: { tenantId: request.tenantCtx!.tenantId, businessResult: { not: null } },
        include: { agent: { select: { name: true } } },
        orderBy: { startedAt: "desc" },
        take: limit ? Number(limit) : 200,
      }),
    );
  });

  // No LLM output carries a fixed "I don't know" marker — the guardrail
  // policy (PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING, see
  // shared-types/agent.ts) only instructs the model to say so in its own
  // words, so this is a heuristic phrase match, not an exact signal. Good
  // enough for a "here's roughly what your KB is missing" report — CLAUDE.md
  // calls this "gold for improving the KB" — not a claim of perfect recall.
  const UNCERTAINTY_PHRASES = [
    "i don't know",
    "i do not know",
    "i'm not sure",
    "i am not sure",
    "i don't have that information",
    "i don't have access to",
    "i can't verify",
    "i cannot verify",
    "i'm unable to",
    "i am unable to",
    "i don't have information",
    "unfortunately, i don't",
    "i wasn't able to find",
  ];

  /**
   * "Couldn't answer" gap report — every customer question that was
   * followed by an agent reply matching one of the phrases above, newest
   * first. Correlated in-memory (fetch every message in the matched
   * conversations once, not one query per match) since the matched set is
   * naturally small — an agent that's actually working shouldn't have many.
   */
  app.get("/v1/tenants/:tenantId/agents/:agentId/gap-report", { preHandler: scoped }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    const { limit } = request.query as { limit?: string };

    return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const uncertainReplies = await tx.message.findMany({
        where: {
          tenantId: request.tenantCtx!.tenantId,
          agentId,
          role: "agent",
          OR: UNCERTAINTY_PHRASES.map((phrase) => ({ content: { contains: phrase, mode: "insensitive" as const } })),
        },
        orderBy: { createdAt: "desc" },
        take: limit ? Number(limit) : 100,
      });
      if (uncertainReplies.length === 0) return [];

      const conversationIds = [...new Set(uncertainReplies.map((m) => m.conversationId))];
      const allMessages = await tx.message.findMany({
        where: { conversationId: { in: conversationIds }, role: { in: ["customer", "agent"] } },
        orderBy: { createdAt: "asc" },
        select: { id: true, conversationId: true, role: true, content: true, createdAt: true },
      });
      const byConversation = new Map<string, typeof allMessages>();
      for (const m of allMessages) {
        const list = byConversation.get(m.conversationId) ?? [];
        list.push(m);
        byConversation.set(m.conversationId, list);
      }

      return uncertainReplies.map((reply) => {
        const thread = byConversation.get(reply.conversationId) ?? [];
        const replyIndex = thread.findIndex((m) => m.id === reply.id);
        const precedingQuestion = [...thread.slice(0, replyIndex)].reverse().find((m) => m.role === "customer");
        return {
          conversationId: reply.conversationId,
          askedAt: precedingQuestion?.createdAt ?? reply.createdAt,
          question: precedingQuestion?.content ?? null,
          agentReply: reply.content,
        };
      });
    });
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

  /**
   * Aggregate analytics per CLAUDE.md's Conversation Analytics & Quality
   * section — "did the conversation actually work," not just usage/cost.
   * Every figure here is computed straight from real Conversation/Message
   * rows (never estimated or invented) — resolutionRate/escalationRate/
   * abandonmentRate/handoffRate read directly off ConversationOutcome and
   * the handoffRequested flag; byChannel and byBusinessResult surface two
   * fields (channel, businessResult) that were being written on every
   * conversation but never actually surfaced anywhere until now.
   */
  app.get(
    "/v1/tenants/:tenantId/agents/:agentId/analytics",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("analytics:read")] },
    async (request) => {
      const { agentId } = request.params as { agentId: string };
      return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const conversations = await tx.conversation.findMany({
          where: { tenantId: request.tenantCtx!.tenantId, agentId },
          include: { _count: { select: { messages: true } } },
        });
        const total = conversations.length;
        const byOutcome = conversations.reduce<Record<string, number>>((acc, c) => {
          acc[c.outcome] = (acc[c.outcome] ?? 0) + 1;
          return acc;
        }, {});
        const byDropOff = conversations.reduce<Record<string, number>>((acc, c) => {
          acc[c.dropOffPoint] = (acc[c.dropOffPoint] ?? 0) + 1;
          return acc;
        }, {});
        const byChannel = conversations.reduce<Record<string, number>>((acc, c) => {
          acc[c.channel] = (acc[c.channel] ?? 0) + 1;
          return acc;
        }, {});
        const byBusinessResult = conversations.reduce<Record<string, number>>((acc, c) => {
          if (!c.businessResult) return acc;
          acc[c.businessResult] = (acc[c.businessResult] ?? 0) + 1;
          return acc;
        }, {});
        const allSentiment = conversations.flatMap((c) => c.sentimentTrend);
        const avgSentiment = allSentiment.reduce((a, b) => a + b, 0) / Math.max(1, allSentiment.length);

        // Rates are of TOTAL conversations (including still-IN_PROGRESS
        // ones) rather than only ended ones — an agent that never resolves
        // anything should show a low resolution rate, not an artificially
        // inflated one from excluding its own failures.
        const resolutionRate = total > 0 ? (byOutcome.RESOLVED ?? 0) / total : 0;
        const escalationRate = total > 0 ? (byOutcome.ESCALATED_TO_HUMAN ?? 0) / total : 0;
        const abandonmentRate = total > 0 ? (byOutcome.ABANDONED ?? 0) / total : 0;
        const handoffRequestedCount = conversations.filter((c) => c.handoffRequested).length;
        const handoffRate = total > 0 ? handoffRequestedCount / total : 0;

        const avgMessagesPerConversation = total > 0 ? conversations.reduce((sum, c) => sum + c._count.messages, 0) / total : 0;

        const ended = conversations.filter((c) => c.endedAt);
        const avgDurationSeconds =
          ended.length > 0
            ? ended.reduce((sum, c) => sum + (c.endedAt!.getTime() - c.startedAt.getTime()) / 1000, 0) / ended.length
            : null;

        return {
          total,
          byOutcome,
          byDropOff,
          byChannel,
          byBusinessResult,
          avgSentiment,
          resolutionRate,
          escalationRate,
          abandonmentRate,
          handoffRate,
          avgMessagesPerConversation,
          avgDurationSeconds,
        };
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
