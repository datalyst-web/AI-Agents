import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requireStaff } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";

const CreateTicketSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
});

/**
 * A client's own request to the platform team — distinct from the
 * "Ticketing" tool an AGENT uses to create tickets in a client's own
 * external helpdesk on the AI's behalf. This is the client contacting us.
 */
export async function registerSupportTicketRoutes(app: FastifyInstance, ctx: AppContext) {
  const tenantScoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get("/v1/tenants/:tenantId/support-tickets", { preHandler: tenantScoped }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.supportTicket.findMany({ where: { tenantId: request.tenantCtx!.tenantId }, orderBy: { createdAt: "desc" } }),
    );
  });

  app.post("/v1/tenants/:tenantId/support-tickets", { preHandler: tenantScoped }, async (request, reply) => {
    const body = CreateTicketSchema.parse(request.body);
    const ticket = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.supportTicket.create({
        data: { id: randomUUID(), tenantId: request.tenantCtx!.tenantId, ...body, createdByUserId: request.authUser!.sub },
      }),
    );
    reply.send(ticket);
  });

  // Staff-facing cross-tenant queue — every open ticket regardless of
  // which tenant filed it, since a support rep triaging the queue needs
  // to see all of them at once, not one tenant at a time.
  app.get("/v1/platform/support-tickets", { preHandler: [app.authenticate, requireStaff()] }, async () => {
    const tickets = await withPlatformContext(ctx.prisma, (tx) =>
      tx.supportTicket.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { tenant: { select: { name: true } } } }),
    );
    return tickets;
  });

  app.patch(
    "/v1/platform/support-tickets/:id",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = z.object({ status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]) }).parse(request.body);
      const existing = await withPlatformContext(ctx.prisma, (tx) => tx.supportTicket.findUniqueOrThrow({ where: { id } }));
      const ticket = await withTenant(ctx.prisma, { tenantId: existing.tenantId }, (tx) =>
        tx.supportTicket.update({
          where: { id },
          data: {
            status: body.status,
            resolvedAt: body.status === "RESOLVED" || body.status === "CLOSED" ? new Date() : null,
            assignedToStaffUserId: request.authUser!.sub,
          },
        }),
      );
      reply.send(ticket);
    },
  );
}
