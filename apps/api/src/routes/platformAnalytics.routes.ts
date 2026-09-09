import type { FastifyInstance } from "fastify";
import { withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requirePermission } from "../lib/rbac.js";

// Same as billing.routes' plan pricing table — kept in sync by hand since
// there's no shared source of truth for plan price yet (see
// paynowBilling.routes.ts's own PLAN_PRICE_USD constant).
const PLAN_PRICE_USD: Record<string, number> = { STARTER: 49, GROWTH: 149, SCALE: 399, ENTERPRISE: 0 };

/**
 * Platform-wide business metrics — every tenant at once, not one at a
 * time. Distinct from usage.routes.ts (per-tenant) and System Health
 * (provider uptime, not cost/revenue).
 */
export async function registerPlatformAnalyticsRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requirePermission("platform:manage_tenants")];

  app.get("/v1/platform/analytics/business", { preHandler: scoped }, async () => {
    const tenants = await withPlatformContext(ctx.prisma, (tx) =>
      tx.tenant.findMany({ select: { subscriptionTier: true, subscriptionState: true, createdAt: true } }),
    );

    const byTier: Record<string, number> = {};
    const byState: Record<string, number> = {};
    let mrr = 0;
    for (const t of tenants) {
      byTier[t.subscriptionTier] = (byTier[t.subscriptionTier] ?? 0) + 1;
      byState[t.subscriptionState] = (byState[t.subscriptionState] ?? 0) + 1;
      // MRR counts only ACTIVE subscriptions — a TRIAL/SUSPENDED/CANCELLED
      // tenant isn't recurring revenue yet (or anymore), even though it's
      // still "on" a paid tier value.
      if (t.subscriptionState === "ACTIVE") mrr += PLAN_PRICE_USD[t.subscriptionTier] ?? 0;
    }

    // Simple month-over-month churn: tenants that are CANCELLED right now,
    // as a fraction of everyone ever seen. A true cohort-based churn rate
    // needs a subscription-state history table this schema doesn't have
    // yet — this is the honest approximation available from current state.
    const total = tenants.length;
    const cancelled = byState.CANCELLED ?? 0;
    const churnRate = total > 0 ? cancelled / total : 0;

    return { totalTenants: total, mrr, churnRate, byTier, byState };
  });

  /** Aggregate token usage + cost across every tenant, broken down by AI provider — for comparing cost/volume across Anthropic/OpenAI/Gemini. */
  app.get("/v1/platform/analytics/usage", { preHandler: scoped }, async (request) => {
    const { days } = request.query as { days?: string };
    const windowDays = Math.min(90, Math.max(1, Number(days) || 30));
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const records = await withPlatformContext(ctx.prisma, (tx) =>
      tx.usageRecord.findMany({
        where: { timestamp: { gte: since } },
        select: { provider: true, inputTokens: true, outputTokens: true, estimatedCostUsd: true },
      }),
    );

    const byProvider: Record<string, { inputTokens: number; outputTokens: number; requests: number; estimatedCostUsd: number }> = {};
    let totalTokens = 0;
    let totalCostUsd = 0;
    for (const r of records) {
      const entry = (byProvider[r.provider] ??= { inputTokens: 0, outputTokens: 0, requests: 0, estimatedCostUsd: 0 });
      entry.inputTokens += r.inputTokens;
      entry.outputTokens += r.outputTokens;
      entry.requests += 1;
      entry.estimatedCostUsd += Number(r.estimatedCostUsd ?? 0);
      totalTokens += r.inputTokens + r.outputTokens;
      totalCostUsd += Number(r.estimatedCostUsd ?? 0);
    }

    return { windowDays, totalTokens, totalCostUsd, byProvider };
  });
}
