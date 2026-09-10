import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { WorkerContext } from "../context.js";

/**
 * Turns last month's over-allowance token usage into an invoiceable
 * BillingLineItem — the billing half of CLAUDE.md's "included-usage →
 * limit → overage billing logic" (the limit half is enforced live in
 * apps/api/src/lib/usageEnforcement.ts).
 *
 * Always bills the PREVIOUS calendar month, never the in-progress one, so
 * a line item is only ever written against a closed, final period.
 * Idempotent by (tenant, period, sku): re-running finds the existing row
 * and does nothing, so running this daily — rather than trying to fire it
 * exactly once at a month boundary — is safe and self-healing if the
 * worker was down when the month rolled over.
 */
export async function runOverageBillingSweep(ctx: WorkerContext): Promise<void> {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const tenants = await withPlatformContext(ctx.prisma, (tx) =>
    tx.tenant.findMany({ select: { id: true, name: true }, where: { subscriptionState: { in: ["ACTIVE", "PAST_DUE"] } } }),
  );

  for (const tenant of tenants) {
    await withTenant(ctx.prisma, { tenantId: tenant.id }, async (tx) => {
      const limits = await tx.usageLimits.findUnique({ where: { tenantId: tenant.id } });
      if (!limits) return;

      const existing = await tx.billingLineItem.findFirst({
        where: { tenantId: tenant.id, skuType: "AI_INFERENCE_OVERAGE", periodStart, periodEnd },
      });
      if (existing) return;

      const aggregate = await tx.usageRecord.aggregate({
        where: { tenantId: tenant.id, timestamp: { gte: periodStart, lt: periodEnd } },
        _sum: { inputTokens: true, outputTokens: true },
      });
      const totalTokens = (aggregate._sum.inputTokens ?? 0) + (aggregate._sum.outputTokens ?? 0);
      const overageTokens = Math.max(0, totalTokens - limits.includedTokensPerMonth);
      if (overageTokens === 0) return;

      const amountUsd = (overageTokens / 1000) * Number(limits.overageRatePerThousandTokensUsd);
      await tx.billingLineItem.create({
        data: {
          tenantId: tenant.id,
          skuType: "AI_INFERENCE_OVERAGE",
          description: `AI usage over plan allowance — ${overageTokens.toLocaleString()} tokens`,
          amountUsd: amountUsd.toFixed(2),
          periodStart,
          periodEnd,
        },
      });
    });
  }
}
