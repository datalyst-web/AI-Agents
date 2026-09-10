import type { Prisma, SubscriptionState, SubscriptionTier } from "@chat-agent/db";

/**
 * The included-usage allowances behind each plan — the business half of
 * CLAUDE.md's "included-usage → limit → overage billing logic." This is
 * the ONE place these numbers live; changing a plan's allowance means
 * editing this table, never a migration or a per-tenant edit.
 *
 * `hardCapTokensPerMonth` is the point where a tenant's agents stop
 * answering rather than run up an unbounded provider bill (set well above
 * the included allowance, so normal overage still bills rather than
 * blocks). ENTERPRISE deliberately has no cap — those are negotiated
 * contracts and must never be auto-cut off; their spend is watched via
 * Platform Analytics instead.
 *
 * Prices these correspond to live in paynowBilling.routes.ts's
 * SUBSCRIPTION_PRICING_USD ($49 / $149 / $399 / custom).
 */
interface PlanAllowance {
  includedConversationsPerMonth: number;
  includedTokensPerMonth: number;
  overageRatePerThousandTokensUsd: string;
  hardCapTokensPerMonth: number | null;
}

const PLAN_ALLOWANCES: Record<SubscriptionTier, PlanAllowance> = {
  STARTER: {
    includedConversationsPerMonth: 500,
    includedTokensPerMonth: 500_000,
    overageRatePerThousandTokensUsd: "0.0500",
    hardCapTokensPerMonth: 1_500_000,
  },
  GROWTH: {
    includedConversationsPerMonth: 2_500,
    includedTokensPerMonth: 2_000_000,
    overageRatePerThousandTokensUsd: "0.0400",
    hardCapTokensPerMonth: 6_000_000,
  },
  SCALE: {
    includedConversationsPerMonth: 10_000,
    includedTokensPerMonth: 6_000_000,
    overageRatePerThousandTokensUsd: "0.0300",
    hardCapTokensPerMonth: 18_000_000,
  },
  ENTERPRISE: {
    includedConversationsPerMonth: 50_000,
    includedTokensPerMonth: 25_000_000,
    overageRatePerThousandTokensUsd: "0.0200",
    hardCapTokensPerMonth: null,
  },
};

/**
 * A trial gets a much smaller allowance than the paid plan it's trialling,
 * and is hard-capped at exactly that allowance — a trial should stop when
 * it's used up rather than quietly accrue overage nobody agreed to pay.
 */
const TRIAL_ALLOWANCE: PlanAllowance = {
  includedConversationsPerMonth: 100,
  includedTokensPerMonth: 100_000,
  overageRatePerThousandTokensUsd: "0.0500",
  hardCapTokensPerMonth: 100_000,
};

export function allowanceFor(tier: SubscriptionTier, state: SubscriptionState): PlanAllowance {
  return state === "TRIAL" ? TRIAL_ALLOWANCE : PLAN_ALLOWANCES[tier];
}

/**
 * Creates or updates a tenant's UsageLimits row to match its plan. Must be
 * called anywhere a tenant is created or its tier/state changes —
 * otherwise the tenant has no limits row at all, which reads as "unlimited
 * and zero overage" everywhere downstream.
 */
export async function provisionUsageLimits(
  tx: Prisma.TransactionClient,
  tenantId: string,
  tier: SubscriptionTier,
  state: SubscriptionState,
): Promise<void> {
  const allowance = allowanceFor(tier, state);
  await tx.usageLimits.upsert({
    where: { tenantId },
    update: allowance,
    create: { tenantId, ...allowance },
  });
}
