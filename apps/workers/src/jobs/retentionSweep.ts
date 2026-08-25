import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { WorkerContext } from "../context.js";

/**
 * "Cross-conversation memory retention follows the tenant's configured
 * data retention policy — it doesn't get a silent exemption just because
 * it's 'memory' rather than 'conversation logs.'" (CLAUDE.md Memory
 * Engine). Runs on a recurring schedule (EventBridge Scheduler ->
 * SQS_FOLLOWUP_QUEUE_URL in production, a plain interval in dev — see
 * main.ts) and purges, per tenant, anything older than
 * Tenant.dataRetentionDays: expired memory facts, and conversations/
 * messages past retention. Never touches subscription/agent config —
 * only conversation-shaped data, matching CLAUDE.md's "never delete
 * client data" rule for account state (suspend, don't delete).
 */
export async function runRetentionSweep(ctx: WorkerContext): Promise<void> {
  const tenants = await withPlatformContext(ctx.prisma, (tx) => tx.tenant.findMany({ select: { id: true, dataRetentionDays: true } }));

  for (const tenant of tenants) {
    const cutoff = new Date(Date.now() - tenant.dataRetentionDays * 24 * 60 * 60 * 1000);

    await withTenant(ctx.prisma, { tenantId: tenant.id }, async (tx) => {
      // Expired memory facts (belt-and-braces — reads already filter these
      // out, this is what actually reclaims storage).
      await tx.crossConversationMemoryFact.deleteMany({
        where: { tenantId: tenant.id, expiresAt: { lt: new Date() } },
      });

      // Conversations older than the tenant's retention window. Messages
      // cascade-delete via the FK (see schema.prisma Message.conversation
      // onDelete: Cascade) so there's no orphaned transcript data left behind.
      const staleConversations = await tx.conversation.findMany({
        where: { tenantId: tenant.id, startedAt: { lt: cutoff } },
        select: { id: true },
      });
      if (staleConversations.length > 0) {
        await tx.conversation.deleteMany({ where: { id: { in: staleConversations.map((c) => c.id) } } });
      }

      // Audit log entries are compliance-relevant and deliberately kept
      // longer than conversation retention — see CLAUDE.md's "Required
      // audit trail"; no purge here.
    });
  }
}
