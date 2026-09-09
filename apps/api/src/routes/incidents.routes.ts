import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../lib/context.js";
import { requireStaff } from "../lib/rbac.js";

const SeveritySchema = z.enum(["MINOR", "MAJOR", "CRITICAL"]);
const CreateIncidentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  severity: SeveritySchema.default("MINOR"),
});

/**
 * Platform-level (no tenant scope — an AI provider outage or infra issue
 * affects the whole platform, not one client). Staff can log one by hand;
 * System Health's own provider-unhealthy state isn't auto-logged here yet
 * — that's a natural next step, not done in this pass.
 */
export async function registerIncidentRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireStaff()];

  app.get("/v1/platform/incidents", { preHandler: scoped }, async () => {
    return ctx.prisma.incidentLogEntry.findMany({ orderBy: { startedAt: "desc" }, take: 100 });
  });

  app.post("/v1/platform/incidents", { preHandler: scoped }, async (request, reply) => {
    const body = CreateIncidentSchema.parse(request.body);
    const incident = await ctx.prisma.incidentLogEntry.create({
      data: { id: randomUUID(), ...body, createdByUserId: request.authUser!.sub },
    });
    reply.send(incident);
  });

  app.patch("/v1/platform/incidents/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z.object({ status: z.enum(["OPEN", "MONITORING", "RESOLVED"]) }).parse(request.body);
    const incident = await ctx.prisma.incidentLogEntry.update({
      where: { id },
      data: { status: body.status, resolvedAt: body.status === "RESOLVED" ? new Date() : null },
    });
    reply.send(incident);
  });
}
