import { withPlatformContext, withTenant } from "@chat-agent/db";
import { fireWorkflowTrigger } from "@chat-agent/workflow-engine";
import type { WorkerContext } from "../context.js";
import { env } from "../env.js";

const ABANDONED_AFTER_MS = 30 * 60 * 1000; // 30 minutes of customer silence

/**
 * CONVERSATION_ABANDONED is the one workflow trigger that can't be
 * detected from inside a single turn (engine/agentLoop.ts fires
 * SENTIMENT_THRESHOLD_CROSSED and TOOL_FAILURE per-turn instead) — it's
 * the absence of a next turn, which only a time-based sweep can see. This
 * is the concrete implementation of CLAUDE.md's own example: "Conversation
 * abandoned (customer stops replying mid-flow) -> wait 1 hour -> send
 * follow-up email with a link back to the conversation." Marks the
 * conversation ABANDONED after firing so it's never re-processed.
 */
export async function runConversationTimeoutSweep(ctx: WorkerContext): Promise<void> {
  const cutoff = new Date(Date.now() - ABANDONED_AFTER_MS);

  const stale = await withPlatformContext(ctx.prisma, (tx) =>
    tx.conversation.findMany({
      where: { outcome: "IN_PROGRESS", startedAt: { lt: cutoff } },
      select: { id: true, tenantId: true, agentId: true, customerIdentityId: true },
    }),
  );
  if (stale.length === 0) return;

  // Filter to conversations whose most recent message is also older than
  // the cutoff — startedAt alone would misfire on a long-running but
  // still-active conversation.
  for (const conversation of stale) {
    await withTenant(ctx.prisma, { tenantId: conversation.tenantId, agentId: conversation.agentId }, async (tx) => {
      const lastMessage = await tx.message.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: "desc" },
      });
      if (lastMessage && lastMessage.createdAt > cutoff) return; // still active

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
    });
  }
}
