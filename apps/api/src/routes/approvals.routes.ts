import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import { retrieveKnowledge } from "@chat-agent/rag";
import { fireWorkflowTrigger } from "@chat-agent/workflow-engine";
import { ToolExecutionDenied } from "@chat-agent/tool-sdk";
import type { ToolExecutionResult } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { buildToolRegistryForAgent } from "../engine/toolRegistryForAgent.js";
import { EMBEDDING_MODEL } from "../engine/agentLoop.js";
import { env } from "../env.js";

const RejectBodySchema = z.object({ reason: z.string().max(500).optional() }).default({});

/**
 * Staff-facing queue for `human_approval`-tier tool calls (CLAUDE.md
 * principle 5 / Tool & Action Engine — "never auto-executed", staff
 * approval required). Gated behind `tool:execute_high_risk`, the same
 * permission that gates any other high-risk tool action, and every
 * approve/reject is written through the standard writeAuditLog pipeline
 * (CLAUDE.md "Required audit trail").
 */
export async function registerApprovalRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [
    app.authenticate,
    requireTenantMatch(),
    verifyActiveImpersonation(ctx.prisma),
    requirePermission("tool:execute_high_risk"),
  ];

  app.get("/v1/tenants/:tenantId/approvals", { preHandler: scoped }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.pendingHumanApproval.findMany({
        where: { tenantId: request.tenantCtx!.tenantId, status: "PENDING" },
        orderBy: { requestedAt: "asc" },
      }),
    );
  });

  app.post("/v1/tenants/:tenantId/approvals/:approvalId/approve", { preHandler: scoped }, async (request, reply) => {
    const { approvalId } = request.params as { approvalId: string };
    const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;

    const result = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const approval = await tx.pendingHumanApproval.findFirstOrThrow({
        where: { id: approvalId, tenantId: request.tenantCtx!.tenantId, status: "PENDING" },
      });

      const agent = await tx.agent.findFirstOrThrow({
        where: { id: approval.agentId, tenantId: approval.tenantId },
      });

      const toolRegistry = await buildToolRegistryForAgent(tx, ctx.secrets, {
        tenantId: approval.tenantId,
        agentId: approval.agentId,
        enabledToolIds: agent.enabledToolIds,
        googleCalendar:
          env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET
            ? { clientId: env.GOOGLE_CALENDAR_CLIENT_ID, clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET }
            : undefined,
        retrieve: async (query) => {
          const results = await retrieveKnowledge(tx, ctx.router, {
            tenantId: approval.tenantId,
            agentId: approval.agentId,
            query,
            embeddingModel: EMBEDDING_MODEL,
          });
          return results.map((r) => ({
            chunkId: r.chunkId,
            documentId: r.documentId,
            knowledgeSourceId: r.knowledgeSourceId,
            score: r.score,
            text: r.textSnippet,
          }));
        },
      });

      // The bypass here is exclusive to this staff-only, permission-gated,
      // audited route — nothing else may pass staffApproved: true (see
      // packages/tool-sdk/src/registry.ts execute()).
      let execResult: ToolExecutionResult;
      try {
        execResult = await toolRegistry.execute(
          approval.toolName,
          approval.input,
          {
            tenantId: approval.tenantId,
            agentId: approval.agentId,
            conversationId: approval.conversationId,
            invokedByRole: "staff",
          },
          { staffApproved: true },
        );
      } catch (err) {
        // Never fail silently or fail open (CLAUDE.md): record the denial
        // as a failed invocation instead of letting it propagate uncaught.
        execResult = {
          succeeded: false,
          errorMessage: err instanceof ToolExecutionDenied || err instanceof Error ? err.message : String(err),
          confirmedByProvider: false,
          durationMs: 0,
        };
      }

      await tx.pendingHumanApproval.update({
        where: { id: approval.id },
        data: { status: "APPROVED", resolvedAt: new Date(), resolvedByUserId: actorUserId },
      });

      // Gives the agent loop a way to tell the customer the outcome — the
      // next turn (or the transcript itself) reflects a real "agent" message
      // rather than leaving the customer with no follow-up at all.
      await tx.message.create({
        data: {
          id: randomUUID(),
          tenantId: approval.tenantId,
          agentId: approval.agentId,
          conversationId: approval.conversationId,
          role: "agent",
          content: execResult.succeeded
            ? `Update: after review, we went ahead with your request and it's been completed.`
            : `Update: after review, we weren't able to complete your request. Our team will follow up if any further action is needed.`,
        },
      });

      if (!execResult.succeeded) {
        // Reuse the same TOOL_FAILURE notification path agentLoop.ts uses —
        // never invent a second failure-notification mechanism.
        await fireWorkflowTrigger(tx, ctx.queue, {
          tenantId: approval.tenantId,
          agentId: approval.agentId,
          triggerType: "TOOL_FAILURE",
          payload: {
            conversationId: approval.conversationId,
            toolName: approval.toolName,
            errorMessage: execResult.errorMessage,
          },
        });
      }

      await writeAuditLog(tx, request.tenantCtx!, {
        actorUserId,
        agentId: approval.agentId,
        action: "human_approval_approved",
        metadata: {
          approvalId: approval.id,
          toolName: approval.toolName,
          conversationId: approval.conversationId,
          succeeded: execResult.succeeded,
        },
      });

      return { approvalId: approval.id, succeeded: execResult.succeeded };
    });

    reply.send(result);
  });

  app.post("/v1/tenants/:tenantId/approvals/:approvalId/reject", { preHandler: scoped }, async (request, reply) => {
    const { approvalId } = request.params as { approvalId: string };
    const body = RejectBodySchema.parse(request.body ?? {});
    const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;

    const result = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const approval = await tx.pendingHumanApproval.findFirstOrThrow({
        where: { id: approvalId, tenantId: request.tenantCtx!.tenantId, status: "PENDING" },
      });

      await tx.pendingHumanApproval.update({
        where: { id: approval.id },
        data: { status: "REJECTED", resolvedAt: new Date(), resolvedByUserId: actorUserId },
      });

      // Never auto-executed and never silently dropped — the customer gets
      // a real follow-up message, never left assuming the action is still pending.
      await tx.message.create({
        data: {
          id: randomUUID(),
          tenantId: approval.tenantId,
          agentId: approval.agentId,
          conversationId: approval.conversationId,
          role: "agent",
          content: `Update: after review, we're not able to go ahead with that request${
            body.reason ? ` (${body.reason})` : ""
          }. Let us know if there's anything else we can help with.`,
        },
      });

      await writeAuditLog(tx, request.tenantCtx!, {
        actorUserId,
        agentId: approval.agentId,
        action: "human_approval_rejected",
        metadata: {
          approvalId: approval.id,
          toolName: approval.toolName,
          conversationId: approval.conversationId,
          reason: body.reason,
        },
      });

      return { approvalId: approval.id };
    });

    reply.send(result);
  });
}
