import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";

/** Backs the included-usage -> limit -> overage billing logic (CLAUDE.md "Usage & Cost Tracking"). */
export async function registerUsageRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("billing:read")];

  app.get("/v1/tenants/:tenantId/usage/summary", { preHandler: scoped }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const since = new Date();
      since.setDate(1); // month-to-date
      const records = await tx.usageRecord.findMany({ where: { tenantId: request.tenantCtx!.tenantId, timestamp: { gte: since } } });
      const limits = await tx.usageLimits.findUnique({ where: { tenantId: request.tenantCtx!.tenantId } });

      const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
      const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
      const byProvider = records.reduce<Record<string, { inputTokens: number; outputTokens: number; requests: number }>>((acc, r) => {
        const entry = (acc[r.provider] ??= { inputTokens: 0, outputTokens: 0, requests: 0 });
        entry.inputTokens += r.inputTokens;
        entry.outputTokens += r.outputTokens;
        entry.requests += 1;
        return acc;
      }, {});

      const totalTokens = totalInputTokens + totalOutputTokens;
      const overageTokens = limits ? Math.max(0, totalTokens - limits.includedTokensPerMonth) : 0;

      return {
        periodStart: since.toISOString(),
        totalInputTokens,
        totalOutputTokens,
        totalTokens,
        byProvider,
        limits,
        overageTokens,
        estimatedOverageUsd: limits ? overageTokens * (Number(limits.overageRatePerThousandTokensUsd) / 1000) : 0,
      };
    });
  });

  app.get("/v1/tenants/:tenantId/billing/line-items", { preHandler: scoped }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.billingLineItem.findMany({ where: { tenantId: request.tenantCtx!.tenantId }, orderBy: { createdAt: "desc" }, take: 100 }),
    );
  });

  /** Daily token usage for the last N days, for the dashboard's usage trend chart. */
  app.get("/v1/tenants/:tenantId/usage/daily", { preHandler: scoped }, async (request) => {
    const { days } = request.query as { days?: string };
    const windowDays = Math.min(90, Math.max(1, Number(days) || 14));
    const since = new Date();
    since.setDate(since.getDate() - (windowDays - 1));
    since.setHours(0, 0, 0, 0);

    return withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const records = await tx.usageRecord.findMany({
        where: { tenantId: request.tenantCtx!.tenantId, timestamp: { gte: since } },
        select: { timestamp: true, inputTokens: true, outputTokens: true },
      });

      const byDay = new Map<string, { inputTokens: number; outputTokens: number }>();
      for (let i = 0; i < windowDays; i++) {
        const d = new Date(since);
        d.setDate(d.getDate() + i);
        byDay.set(d.toISOString().slice(0, 10), { inputTokens: 0, outputTokens: 0 });
      }
      for (const r of records) {
        const key = r.timestamp.toISOString().slice(0, 10);
        const entry = byDay.get(key);
        if (entry) {
          entry.inputTokens += r.inputTokens;
          entry.outputTokens += r.outputTokens;
        }
      }
      return Array.from(byDay.entries()).map(([date, tokens]) => ({
        date,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        totalTokens: tokens.inputTokens + tokens.outputTokens,
      }));
    });
  });
}
