import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../lib/context.js";
import { requirePermission } from "../lib/rbac.js";

const TierSchema = z.enum(["STARTER", "GROWTH", "SCALE", "ENTERPRISE"]);
const CreateFlagSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/, "lowercase letters, numbers, underscores only"),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  enabledTiers: z.array(TierSchema).default([]),
});
const UpdateFlagSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  enabledTiers: z.array(TierSchema).optional(),
});

/**
 * Platform-level (no tenant scope) — which plan tiers get which features.
 * Management only; nothing in the product actually reads these yet to
 * gate a real code path (that's a separate, larger change per touched
 * feature) — this ships the control surface staff need first.
 */
export async function registerFeatureFlagRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requirePermission("platform:manage_tenants")];

  app.get("/v1/platform/feature-flags", { preHandler: scoped }, async () => {
    return ctx.prisma.featureFlag.findMany({ orderBy: { key: "asc" } });
  });

  app.post("/v1/platform/feature-flags", { preHandler: scoped }, async (request, reply) => {
    const body = CreateFlagSchema.parse(request.body);
    const existing = await ctx.prisma.featureFlag.findUnique({ where: { key: body.key } });
    if (existing) {
      reply.code(409).send({ error: "key_already_exists" });
      return;
    }
    const flag = await ctx.prisma.featureFlag.create({ data: { id: randomUUID(), ...body } });
    reply.send(flag);
  });

  app.patch("/v1/platform/feature-flags/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateFlagSchema.parse(request.body);
    const flag = await ctx.prisma.featureFlag.update({ where: { id }, data: body });
    reply.send(flag);
  });

  app.delete("/v1/platform/feature-flags/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.prisma.featureFlag.delete({ where: { id } });
    reply.code(204).send();
  });
}
