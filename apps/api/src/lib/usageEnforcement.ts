import type { PrismaClient } from "@chat-agent/db";
import { withTenant } from "@chat-agent/db";
import { provisionUsageLimits } from "./planLimits.js";

/** Start of the current calendar month, midnight — the window every usage allowance is measured over. */
export function currentPeriodStart(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export interface UsageAllowanceStatus {
  /** True when this tenant has burned through its hard cap and its agents must stop answering. */
  overHardCap: boolean;
  tokensUsed: number;
  includedTokens: number | null;
  hardCapTokens: number | null;
}

/**
 * Month-to-date token usage against the tenant's plan allowance. Called on
 * the inbound customer-message path (chat.routes.ts, channels.routes.ts)
 * before any model call, so a tenant that's blown past its hard cap costs
 * nothing further rather than running up an unbounded provider bill.
 *
 * Deliberately only blocks at the HARD CAP, never at the included
 * allowance: going over the included amount is a billing event (overage,
 * see workers' overageBillingSweep), not an outage. A tenant with no
 * UsageLimits row is treated as unlimited rather than blocked — failing
 * open is right here, since wrongly cutting off a paying client's agent is
 * far worse than briefly under-billing one.
 */
export async function checkUsageAllowance(prisma: PrismaClient, tenantId: string): Promise<UsageAllowanceStatus> {
  return withTenant(prisma, { tenantId }, async (tx) => {
    let limits = await tx.usageLimits.findUnique({ where: { tenantId } });

    // Tenants created before limits were provisioned anywhere have no row
    // at all. Rather than a one-off backfill script that gets lost, fill it
    // in from the tenant's own plan the first time one of its agents is
    // used — this runs at most once per tenant, ever, and keeps every
    // tenant's limits consistent with the table in planLimits.ts.
    if (!limits) {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { subscriptionTier: true, subscriptionState: true } });
      if (!tenant) return { overHardCap: false, tokensUsed: 0, includedTokens: null, hardCapTokens: null };
      await provisionUsageLimits(tx, tenantId, tenant.subscriptionTier, tenant.subscriptionState);
      limits = await tx.usageLimits.findUnique({ where: { tenantId } });
    }
    if (!limits) return { overHardCap: false, tokensUsed: 0, includedTokens: null, hardCapTokens: null };

    const aggregate = await tx.usageRecord.aggregate({
      where: { tenantId, timestamp: { gte: currentPeriodStart() } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const tokensUsed = (aggregate._sum.inputTokens ?? 0) + (aggregate._sum.outputTokens ?? 0);

    return {
      overHardCap: limits.hardCapTokensPerMonth !== null && tokensUsed >= limits.hardCapTokensPerMonth,
      tokensUsed,
      includedTokens: limits.includedTokensPerMonth,
      hardCapTokens: limits.hardCapTokensPerMonth,
    };
  });
}
