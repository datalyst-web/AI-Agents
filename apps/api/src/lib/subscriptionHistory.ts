import { randomUUID } from "node:crypto";
import type { Prisma, SubscriptionState } from "@chat-agent/db";

/**
 * Records one subscriptionState transition — the append-only log that lets
 * platform analytics compute a real cohort-based churn rate instead of a
 * current-snapshot approximation. Called right alongside every
 * Tenant.subscriptionState update, in the same transaction, so the two can
 * never drift apart.
 */
export async function recordSubscriptionStateChange(
  tx: Prisma.TransactionClient,
  tenantId: string,
  fromState: SubscriptionState | null,
  toState: SubscriptionState,
): Promise<void> {
  if (fromState === toState) return;
  await tx.subscriptionStateChange.create({
    data: { id: randomUUID(), tenantId, fromState, toState },
  });
}
