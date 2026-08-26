import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, type Prisma } from "@chat-agent/db";
import { WorkflowTriggerTypeSchema } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";

const WorkflowActionSchema = z.object({
  id: z.string(),
  type: z.enum([
    "CREATE_CRM_RECORD",
    "SEND_EMAIL",
    "SEND_NOTIFICATION",
    "CALL_WEBHOOK",
    "CREATE_TICKET",
    "SCORE_LEAD",
    "WAIT",
    "TRIGGER_TOOL",
  ]),
  config: z.record(z.string(), z.unknown()),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(10), backoffSeconds: z.number().int().min(0) }),
  onFailureNotify: z.object({
    target: z.enum(["tenant_owner", "tenant_admin", "staff_fallback"]),
    channel: z.enum(["email", "dashboard", "sms"]),
  }),
  nextOnSuccess: z.string().optional(),
  nextOnFailure: z.string().optional(),
});

const CreateWorkflowSchema = z.object({
  agentId: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  triggerType: WorkflowTriggerTypeSchema,
  triggerFilter: z.record(z.string(), z.unknown()).optional(),
  actions: z.array(WorkflowActionSchema).min(1),
});

export async function registerWorkflowRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get("/v1/tenants/:tenantId/workflows", { preHandler: [...scoped, requirePermission("workflow:read")] }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) => tx.workflowDefinition.findMany({ where: { tenantId: request.tenantCtx!.tenantId } }));
  });

  app.post(
    "/v1/tenants/:tenantId/workflows",
    { preHandler: [...scoped, requirePermission("workflow:write")] },
    async (request, reply) => {
      const body = CreateWorkflowSchema.parse(request.body);
      const workflow = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.workflowDefinition.create({
          data: {
            id: randomUUID(),
            tenantId: request.tenantCtx!.tenantId,
            agentId: body.agentId,
            name: body.name,
            version: 1,
            enabled: true,
            triggerType: body.triggerType,
            triggerFilter: body.triggerFilter as Prisma.InputJsonValue | undefined,
            actions: body.actions as unknown as Prisma.InputJsonValue,
            createdByUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId: body.agentId,
          action: "workflow_created",
          metadata: { workflowId: created.id, triggerType: body.triggerType },
        });
        return created;
      });
      reply.code(201).send(workflow);
    },
  );

  app.patch(
    "/v1/tenants/:tenantId/workflows/:workflowId",
    { preHandler: [...scoped, requirePermission("workflow:write")] },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      const body = CreateWorkflowSchema.partial().parse(request.body);
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const existing = await tx.workflowDefinition.findFirstOrThrow({ where: { id: workflowId, tenantId: request.tenantCtx!.tenantId } });
        const result = await tx.workflowDefinition.update({
          where: { id: workflowId },
          data: {
            name: body.name,
            triggerType: body.triggerType,
            triggerFilter: body.triggerFilter as Prisma.InputJsonValue | undefined,
            actions: body.actions as unknown as Prisma.InputJsonValue | undefined,
            version: existing.version + 1,
            enabled: (request.body as { enabled?: boolean }).enabled,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId: existing.agentId ?? undefined,
          action: "workflow_edited",
          metadata: { workflowId, newVersion: result.version },
        });
        return result;
      });
      reply.send(updated);
    },
  );

  app.delete(
    "/v1/tenants/:tenantId/workflows/:workflowId",
    { preHandler: [...scoped, requirePermission("workflow:write")] },
    async (request, reply) => {
      const { workflowId } = request.params as { workflowId: string };
      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const existing = await tx.workflowDefinition.findFirstOrThrow({ where: { id: workflowId, tenantId: request.tenantCtx!.tenantId } });
        await tx.workflowDefinition.delete({ where: { id: workflowId } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId: existing.agentId ?? undefined,
          action: "workflow_deleted",
          metadata: { workflowId, name: existing.name },
        });
      });
      reply.code(204).send();
    },
  );

  app.get(
    "/v1/tenants/:tenantId/workflows/:workflowId/runs",
    { preHandler: [...scoped, requirePermission("workflow:read")] },
    async (request) => {
      const { workflowId } = request.params as { workflowId: string };
      return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
        tx.workflowRun.findMany({ where: { tenantId: request.tenantCtx!.tenantId, workflowId }, orderBy: { startedAt: "desc" }, take: 50 }),
      );
    },
  );
}
