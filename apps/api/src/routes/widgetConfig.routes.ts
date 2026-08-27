import type { FastifyInstance } from "fastify";
import { AgentPersonalitySchema } from "@chat-agent/shared-types";
import { withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { signWidgetToken } from "../lib/widgetToken.js";

/**
 * Public, unauthenticated — this is what `<script data-agent-id="...">`
 * calls on page load (CLAUDE.md Deployment Surfaces: "embed script
 * identifies tenant + agent securely"). Only ever returns config for a
 * LIVE agent belonging to a non-suspended tenant, and never leaks which
 * model/provider is behind it (principle 6/white-label).
 */
export async function registerWidgetConfigRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/v1/widget-config/:agentId", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };

    // The embed script only knows an agentId, not a tenantId, so the tenant
    // isn't known until the agent row resolves it — platform context, same
    // as auth.routes.ts's pre-authentication lookups.
    const resolved = await withPlatformContext(ctx.prisma, async (tx) => {
      const agent = await tx.agent.findFirst({ where: { id: agentId, status: "LIVE" } });
      if (!agent) return null;
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: agent.tenantId } });
      return { agent, tenant };
    });
    if (!resolved) {
      reply.code(404).send({ error: "agent_not_found_or_not_live" });
      return;
    }
    const { agent, tenant } = resolved;
    if (tenant.subscriptionState === "SUSPENDED" || tenant.subscriptionState === "CANCELLED") {
      reply.code(404).send({ error: "agent_not_found_or_not_live" });
      return;
    }

    const personality = AgentPersonalitySchema.parse(agent.personality);
    const token = signWidgetToken({ tenantId: agent.tenantId, agentId: agent.id });

    reply.send({
      agentId: agent.id,
      name: personality.name,
      greeting: personality.greeting,
      avatarUrl: personality.avatarUrl,
      tone: personality.tone,
      // Same value the dashboard's own chrome uses for this tenant — one
      // setting, two surfaces (CLAUDE.md: white-label-safe, no infra
      // leaked, purely a client-facing cosmetic choice).
      theme: tenant.theme,
      widgetToken: token,
    });
  });
}
