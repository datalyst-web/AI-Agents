import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import { AgentPersonalitySchema, ModelRoutingPreferenceSchema } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { processCustomerMessage } from "../engine/agentLoop.js";

const CreateAgentSchema = z.object({
  name: z.string().min(1).max(120),
  personality: AgentPersonalitySchema,
  modelRouting: ModelRoutingPreferenceSchema.optional(),
});

const TestMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  confirmToolCallId: z.string().optional(),
});

const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  personality: AgentPersonalitySchema.partial().optional(),
  modelRouting: ModelRoutingPreferenceSchema.partial().optional(),
  enabledToolIds: z.array(z.string().uuid()).optional(),
});

function nextVersion(current: string): string {
  const match = /^v(\d+)\.(\d+)$/.exec(current);
  if (!match) return "v1.0";
  const [, major, minor] = match;
  return `v${major}.${Number(minor) + 1}`;
}

export async function registerAgentRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get("/v1/tenants/:tenantId/agents", { preHandler: scoped }, async (request) => {
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) => tx.agent.findMany({ where: { tenantId: request.tenantCtx!.tenantId } }));
  });

  app.get("/v1/tenants/:tenantId/agents/:agentId", { preHandler: scoped }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } }),
    );
  });

  /**
   * Permanently removes an agent and everything scoped to it (knowledge,
   * conversations, usage records — see schema.prisma's onDelete: Cascade on
   * every Agent-scoped relation). Distinct from subscription-expiry
   * handling elsewhere, which suspends rather than deletes — this is an
   * explicit, client-initiated action on their own agent, not an
   * expiry-driven one, so a real delete (not a status flag) is correct
   * here. Never allowed on a LIVE agent — a client must consciously step
   * it back to Draft/Testing first so an active customer-facing surface
   * can never disappear out from under them by accident.
   */
  app.delete(
    "/v1/tenants/:tenantId/agents/:agentId",
    { preHandler: [...scoped, requirePermission("agent:write")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;

      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const agent = await tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } });
        if (agent.status === "LIVE") {
          throw Object.assign(new Error("Cannot delete a LIVE agent — publish it back to a prior version or take it out of Live first."), {
            statusCode: 409,
          });
        }
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId,
          action: "agent_deleted",
          metadata: { name: agent.name, status: agent.status },
        });
        await tx.agent.delete({ where: { id: agentId } });
      });
      reply.code(204).send();
    },
  );

  /**
   * Authenticated in-dashboard test chat, distinct from the public
   * /v1/chat/:agentId/messages surface (widget-token auth, LIVE agents
   * only). This is what backs the "Test Agent" tab so a client can
   * actually converse with their agent during the TESTING stage per
   * CLAUDE.md's Client Lifecycle — before it's ever LIVE, and without
   * minting a public widget token for a not-yet-published agent.
   * processCustomerMessage itself still only allows LIVE/TESTING status.
   */
  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/test-message",
    { preHandler: [...scoped, requirePermission("agent:write")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const body = TestMessageSchema.parse(request.body);
      try {
        const result = await processCustomerMessage(
          { prisma: ctx.prisma, router: ctx.router, secrets: ctx.secrets, queue: ctx.queue },
          {
            tenantId: request.tenantCtx!.tenantId,
            agentId,
            conversationId: body.conversationId,
            channel: "API",
            customerMessage: body.message,
            customerIdentifier: { type: "authenticated_account", value: `test:${request.authUser!.sub}` },
            confirmToolCallId: body.confirmToolCallId,
          },
        );
        reply.send(result);
      } catch (err) {
        request.log.error(err);
        const message = err instanceof Error ? err.message : "test_message_failed";
        reply.code(409).send({ error: "test_message_failed", message });
      }
    },
  );

  app.post(
    "/v1/tenants/:tenantId/agents",
    { preHandler: [...scoped, requirePermission("agent:write")] },
    async (request, reply) => {
      const body = CreateAgentSchema.parse(request.body);
      const actorSource = request.tenantCtx!.impersonation ? "STAFF_MANAGED_SETUP" : "CLIENT";
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;

      const agent = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.agent.create({
          data: {
            id: randomUUID(),
            tenantId: request.tenantCtx!.tenantId,
            name: body.name,
            status: "DRAFT",
            version: "v0.1",
            personality: body.personality,
            modelRouting: body.modelRouting ?? { failoverChain: ["anthropic", "openai", "gemini"], reasoningEffort: "medium" },
            enabledToolIds: [],
            crossAgentMemoryPeerIds: [],
            createdBySource: actorSource,
            createdByUserId: actorUserId,
            lastEditedBySource: actorSource,
            lastEditedByUserId: actorUserId,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId: created.id,
          action: "agent_instructions_edited",
          contentSource: actorSource === "STAFF_MANAGED_SETUP" ? "staff-created" : "client dashboard",
          metadata: { event: "agent_created" },
        });
        return created;
      });
      reply.code(201).send(agent);
    },
  );

  app.patch(
    "/v1/tenants/:tenantId/agents/:agentId",
    { preHandler: [...scoped, requirePermission("agent:write")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const body = UpdateAgentSchema.parse(request.body);
      const actorSource = request.tenantCtx!.impersonation ? "STAFF_MANAGED_SETUP" : "CLIENT";
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;

      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const existing = await tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } });
        const mergedPersonality = body.personality
          ? { ...(existing.personality as object), ...body.personality }
          : existing.personality;
        const mergedRouting = body.modelRouting
          ? { ...(existing.modelRouting as object), ...body.modelRouting }
          : existing.modelRouting;

        const result = await tx.agent.update({
          where: { id: agentId },
          data: {
            name: body.name ?? undefined,
            personality: mergedPersonality as object,
            modelRouting: mergedRouting as object,
            enabledToolIds: body.enabledToolIds ?? undefined,
            lastEditedBySource: actorSource,
            lastEditedByUserId: actorUserId,
            // Any edit invalidates a prior client approval — CLAUDE.md
            // requires explicit re-approval before a changed config can go LIVE.
            approvedByClientUserId: null,
            approvedAt: null,
          },
        });

        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId,
          action: "agent_instructions_edited",
          contentSource: actorSource === "STAFF_MANAGED_SETUP" ? "staff edit" : "client dashboard",
          metadata: { fieldsChanged: Object.keys(body) },
        });
        return result;
      });
      reply.send(updated);
    },
  );

  /**
   * Advances a newly-created agent into TESTING so the Test Agent tab (and
   * the eventual approve/publish steps) become reachable — CLAUDE.md's
   * agent status pipeline is DRAFT -> CONFIGURING -> KNOWLEDGE_PROCESSING
   * -> TESTING -> APPROVED -> LIVE, but nothing else in this codebase ever
   * moves an agent out of DRAFT. Deliberately simple (no CONFIGURING/
   * KNOWLEDGE_PROCESSING sub-gates) since nothing else in the app branches
   * on those two states.
   */
  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/start-testing",
    { preHandler: [...scoped, requirePermission("agent:write")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;

      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const agent = await tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } });
        if (!["DRAFT", "CONFIGURING", "KNOWLEDGE_PROCESSING"].includes(agent.status)) {
          throw Object.assign(new Error(`Agent is already past the draft stage (status: ${agent.status}).`), { statusCode: 409 });
        }
        const result = await tx.agent.update({ where: { id: agentId }, data: { status: "TESTING" } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId,
          action: "agent_moved_to_testing",
          metadata: {},
        });
        return result;
      });
      reply.send(updated);
    },
  );

  /** Client explicitly approves a Testing-stage agent before it can go LIVE. */
  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/approve",
    { preHandler: [...scoped, requirePermission("agent:publish")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      if (request.tenantCtx!.impersonation) {
        reply.code(403).send({ error: "staff_cannot_approve_on_clients_behalf" });
        return;
      }
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const agent = await tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } });
        if (agent.status !== "TESTING") {
          throw Object.assign(new Error("Agent must be in TESTING status to be approved."), { statusCode: 409 });
        }
        return tx.agent.update({
          where: { id: agentId },
          data: { status: "APPROVED", approvedByClientUserId: request.authUser!.sub, approvedAt: new Date() },
        });
      });
      reply.send(updated);
    },
  );

  /**
   * Publish to LIVE. Staff (Managed Setup) can only do this if the tenant
   * has explicitly delegated auto-publish authority, or if the client has
   * already approved (status === APPROVED) — never a unilateral staff
   * publish otherwise. See CLAUDE.md "Client-facing workflow" step 5.
   */
  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/publish",
    { preHandler: [...scoped, requirePermission("agent:publish")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const isStaff = Boolean(request.tenantCtx!.impersonation);

      const result = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const agent = await tx.agent.findFirstOrThrow({ where: { id: agentId, tenantId: request.tenantCtx!.tenantId } });
        const tenant = await tx.tenant.findFirstOrThrow({ where: { id: request.tenantCtx!.tenantId } });

        const clientApproved = agent.status === "APPROVED";
        const staffMayAutoPublish = isStaff && tenant.delegatesAutoPublish;

        if (isStaff && !clientApproved && !staffMayAutoPublish) {
          throw Object.assign(
            new Error("Staff cannot publish to LIVE without client approval unless auto-publish is delegated in the tenant's account settings."),
            { statusCode: 403 },
          );
        }
        if (!isStaff && !clientApproved) {
          throw Object.assign(new Error("Agent must be APPROVED (Testing-stage sign-off) before publishing to LIVE."), {
            statusCode: 409,
          });
        }

        const version = nextVersion(agent.version);
        const updated = await tx.agent.update({
          where: { id: agentId },
          data: { status: "LIVE", version },
        });

        await tx.agentVersionSnapshot.create({
          data: {
            id: randomUUID(),
            agentId,
            tenantId: request.tenantCtx!.tenantId,
            version,
            personality: updated.personality as object,
            modelRouting: updated.modelRouting as object,
            enabledToolIds: updated.enabledToolIds,
            knowledgeSnapshotId: randomUUID(),
            status: "LIVE",
            publishedAt: new Date(),
          },
        });

        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId,
          action: "agent_published_to_live",
          metadata: { version, autoPublishDelegated: staffMayAutoPublish },
        });

        return updated;
      });
      reply.send(result);
    },
  );

  app.get("/v1/tenants/:tenantId/agents/:agentId/versions", { preHandler: scoped }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.agentVersionSnapshot.findMany({
        where: { agentId, tenantId: request.tenantCtx!.tenantId },
        orderBy: { publishedAt: "desc" },
        select: { id: true, version: true, status: true, publishedAt: true },
      }),
    );
  });

  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/rollback",
    { preHandler: [...scoped, requirePermission("agent:rollback")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const { toVersion } = z.object({ toVersion: z.string() }).parse(request.body);

      const result = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const snapshot = await tx.agentVersionSnapshot.findFirstOrThrow({
          where: { agentId, tenantId: request.tenantCtx!.tenantId, version: toVersion },
        });
        const updated = await tx.agent.update({
          where: { id: agentId },
          data: {
            personality: snapshot.personality as object,
            modelRouting: snapshot.modelRouting as object,
            enabledToolIds: snapshot.enabledToolIds,
            version: `${snapshot.version}-rollback`,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId,
          action: "agent_rolled_back",
          metadata: { toVersion },
        });
        return updated;
      });
      reply.send(result);
    },
  );
}
