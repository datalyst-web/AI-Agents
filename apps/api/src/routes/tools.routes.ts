import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, type Prisma } from "@chat-agent/db";
import { ExecutionTierSchema, ToolCategorySchema } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";

const CreateToolSchema = z.object({
  agentId: z.string().uuid().optional(),
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  category: ToolCategorySchema,
  inputSchema: z.record(z.string(), z.unknown()),
  outputSchema: z.record(z.string(), z.unknown()),
  executionTier: ExecutionTierSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  /** Raw secret value to store via packages/secrets — never persisted in the row itself. */
  credentialValue: z.string().optional(),
});

export async function registerToolRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get("/v1/tenants/:tenantId/tools", { preHandler: scoped }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) => tx.toolDefinition.findMany({ where: { tenantId: request.tenantCtx!.tenantId } }));
  });

  app.post(
    "/v1/tenants/:tenantId/tools",
    { preHandler: [...scoped, requirePermission("tool:configure")] },
    async (request, reply) => {
      const body = CreateToolSchema.parse(request.body);
      const toolId = randomUUID();
      const credentialRef = body.credentialValue ? `tenant/${request.tenantCtx!.tenantId}/tool/${toolId}` : undefined;

      if (credentialRef && body.credentialValue) {
        await ctx.secrets.setSecret(credentialRef, body.credentialValue);
      }

      const tool = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.toolDefinition.create({
          data: {
            id: toolId,
            tenantId: request.tenantCtx!.tenantId,
            agentId: body.agentId,
            name: body.name,
            description: body.description,
            category: body.category,
            inputSchema: body.inputSchema as Prisma.InputJsonValue,
            outputSchema: body.outputSchema as Prisma.InputJsonValue,
            executionTier: body.executionTier,
            config: body.config as Prisma.InputJsonValue,
            credentialRef,
            enabled: true,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId: body.agentId,
          action: "tool_configured",
          metadata: { toolId, category: body.category },
        });
        return created;
      });
      reply.code(201).send(tool);
    },
  );

  app.patch(
    "/v1/tenants/:tenantId/tools/:toolId",
    { preHandler: [...scoped, requirePermission("tool:configure")] },
    async (request, reply) => {
      const { toolId } = request.params as { toolId: string };
      const body = CreateToolSchema.partial().parse(request.body);
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.toolDefinition.update({
          where: { id: toolId },
          data: {
            name: body.name,
            description: body.description,
            executionTier: body.executionTier,
            config: body.config as Prisma.InputJsonValue | undefined,
            enabled: (request.body as { enabled?: boolean }).enabled,
          },
        }),
      );
      reply.send(updated);
    },
  );

  app.delete(
    "/v1/tenants/:tenantId/tools/:toolId",
    { preHandler: [...scoped, requirePermission("tool:configure")] },
    async (request, reply) => {
      const { toolId } = request.params as { toolId: string };
      await withTenant(ctx.prisma, request.tenantCtx!, (tx) => tx.toolDefinition.delete({ where: { id: toolId } }));
      reply.code(204).send();
    },
  );
}
