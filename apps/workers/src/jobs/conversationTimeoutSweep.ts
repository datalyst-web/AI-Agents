import { withPlatformContext, withTenant } from "@chat-agent/db";
import { fireWorkflowTrigger } from "@chat-agent/workflow-engine";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

const NO_REPLY_AFTER_MS = 10 * 60 * 1000; // 10 minutes of customer silence — a nudge, conversation stays open
const ABANDONED_AFTER_MS = 30 * 60 * 1000; // 30 minutes of customer silence — give up, close it out

/**
 * The two workflow triggers that can't be detected from inside a single
 * turn (engine/agentLoop.ts fires SENTIMENT_THRESHOLD_CROSSED and
 * TOOL_FAILURE per-turn instead) — both are the absence of a next turn,
 * which only a time-based sweep can see. NO_REPLY_TIMEOUT fires once at
 * the shorter threshold as a still-open nudge (CLAUDE.md: "no-reply
 * timeout on an open conversation"); CONVERSATION_ABANDONED fires once at
 * the longer threshold and closes the conversation out — the concrete
 * implementation of CLAUDE.md's own example: "Conversation abandoned
 * (customer stops replying mid-flow) -> wait 1 hour -> send follow-up
 * email with a link back to the conversation."
 */
export async function runConversationTimeoutSweep(ctx: WorkerContext): Promise<void> {
  const noReplyCutoff = new Date(Date.now() - NO_REPLY_AFTER_MS);
  const abandonedCutoff = new Date(Date.now() - ABANDONED_AFTER_MS);

  const stale = await withPlatformContext(ctx.prisma, (tx) =>
    tx.conversation.findMany({
      where: { outcome: "IN_PROGRESS", startedAt: { lt: noReplyCutoff } },
      select: { id: true, tenantId: true, agentId: true, customerIdentityId: true, noReplyNotifiedAt: true, startedAt: true },
    }),
  );
  if (stale.length === 0) return;

  for (const conversation of stale) {
    await withTenant(ctx.prisma, { tenantId: conversation.tenantId, agentId: conversation.agentId }, async (tx) => {
      const lastMessage = await tx.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
      });
      // Filter to conversations whose most recent message is also older
      // than the shorter cutoff — startedAt alone would misfire on a
      // long-running but still-active conversation.
      if (lastMessage && lastMessage.createdAt > noReplyCutoff) return;
      const lastActivityAt = lastMessage?.createdAt ?? conversation.startedAt;

      if (lastActivityAt <= abandonedCutoff) {
        await fireWorkflowTrigger(tx, ctx.queue, {
          tenantId: conversation.tenantId,
          agentId: conversation.agentId,
          triggerType: "CONVERSATION_ABANDONED",
          payload: {
            conversationId: conversation.id,
            customerIdentityId: conversation.customerIdentityId,
            lastMessageAt: lastMessage?.createdAt.toISOString(),
          },
          queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { outcome: "ABANDONED", endedAt: new Date() },
        });
      } else if (!conversation.noReplyNotifiedAt) {
        await fireWorkflowTrigger(tx, ctx.queue, {
          tenantId: conversation.tenantId,
          agentId: conversation.agentId,
          triggerType: "NO_REPLY_TIMEOUT",
          payload: {
            conversationId: conversation.id,
            customerIdentityId: conversation.customerIdentityId,
            lastMessageAt: lastMessage?.createdAt.toISOString(),
          },
          queueTarget: env.SQS_WORKFLOW_RUN_QUEUE_URL,
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { noReplyNotifiedAt: new Date() },
        });
      }
    });
  }
}
