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

  app.get("/v1/platform/analytics/business", { preHandler: scoped }, async (request) => {
    const { churnWindowDays } = request.query as { churnWindowDays?: string };
    const windowDays = Math.min(365, Math.max(1, Number(churnWindowDays) || 30));
    const since = new Date();
    since.setDate(since.getDate() - windowDays);

    const [tenants, changes] = await withPlatformContext(ctx.prisma, (tx) =>
      Promise.all([
        tx.tenant.findMany({ select: { id: true, subscriptionTier: true, subscriptionState: true, createdAt: true } }),
        tx.subscriptionStateChange.findMany({
          orderBy: { changedAt: "asc" },
          select: { tenantId: true, toState: true, changedAt: true },
        }),
      ]),
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

    // Real cohort-based churn, computed from SubscriptionStateChange
    // (subscriptionHistory.ts) instead of a current-state snapshot:
    // ACTIVE tenants as of `since` who transitioned to CANCELLED at some
    // point between `since` and now, divided by how many were ACTIVE as
    // of `since` in the first place. For a tenant with no recorded change
    // at or before `since` (either it's newer than the window, or it
    // predates this history table entirely), fall back to its earliest
    // known state as a proxy for "what it was doing back then" — the only
    // information available for tenants that existed before this table
    // was introduced.
    const changesByTenant = new Map<string, { toState: string; changedAt: Date }[]>();
    for (const c of changes) {
      const list = changesByTenant.get(c.tenantId) ?? [];
      list.push(c);
      changesByTenant.set(c.tenantId, list);
    }
    function stateAsOf(tenantId: string, currentState: string, createdAt: Date, cutoff: Date): string | undefined {
      const list = changesByTenant.get(tenantId) ?? [];
      let atCutoff: string | undefined;
      for (const c of list) {
        if (c.changedAt <= cutoff) atCutoff = c.toState;
        else break;
      }
      if (atCutoff !== undefined) return atCutoff;
      if (createdAt > cutoff) return undefined; // didn't exist yet as of cutoff
      return list[0]?.toState ?? currentState; // predates tracking — best available proxy
    }
    let activeAtStart = 0;
    let churnedInWindow = 0;
    for (const t of tenants) {
      const wasActive = stateAsOf(t.id, t.subscriptionState, t.createdAt, since) === "ACTIVE";
      if (!wasActive) continue;
      activeAtStart += 1;
      const cancelledInWindow = (changesByTenant.get(t.id) ?? []).some((c) => c.toState === "CANCELLED" && c.changedAt > since);
      if (cancelledInWindow) churnedInWindow += 1;
    }
    const churnRate = activeAtStart > 0 ? churnedInWindow / activeAtStart : 0;

    return { totalTenants: tenants.length, mrr, churnRate, churnWindowDays: windowDays, byTier, byState };
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
