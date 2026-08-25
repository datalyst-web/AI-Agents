import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { processCustomerMessage } from "../engine/agentLoop.js";
import { verifyWidgetToken } from "../lib/widgetToken.js";

const SendMessageSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(4000),
  customerIdentifier: z
    .object({
      type: z.enum(["authenticated_account", "email", "widget_session_cookie"]),
      value: z.string().min(1),
    })
    .optional(),
  /** The toolCallId from a previous PendingConfirmationResponse — echoed back verbatim to confirm it. */
  confirmToolCallId: z.string().optional(),
});

/**
 * The customer-facing surface — widget, standalone URL, and third-party
 * API integrations all funnel through here. Auth is a signed per-agent
 * widget token (see lib/widgetToken.ts), never the staff/dashboard JWT —
 * a customer's browser must never be able to mint a request for an
 * arbitrary tenantId, only for the one agent the embed script was
 * configured with (CLAUDE.md: "embed script identifies tenant + agent
 * securely").
 */
export async function registerChatRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/chat/:agentId/messages", async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const claim = bearer ? verifyWidgetToken(bearer) : undefined;
    if (!claim || claim.agentId !== agentId) {
      reply.code(401).send({ error: "invalid_or_missing_widget_token" });
      return;
    }

    const body = SendMessageSchema.parse(request.body);

    // claim.tenantId comes from a signed widget token, so — unlike the
    // pre-auth lookups elsewhere — the tenant is already known and trusted
    // here; withTenant (not the platform escape hatch) is the correct,
    // narrower scoping.
    const tenant = await withTenant(ctx.prisma, { tenantId: claim.tenantId }, (tx) => tx.tenant.findUniqueOrThrow({ where: { id: claim.tenantId } }));
    if (tenant.subscriptionState === "SUSPENDED" || tenant.subscriptionState === "CANCELLED") {
      // Never delete data on expiry — route to a graceful fallback instead (CLAUDE.md Client Lifecycle).
      reply.code(503).send({
        error: "agent_unavailable",
        message: "This assistant is temporarily unavailable. Please contact the business directly.",
      });
      return;
    }

    try {
      const result = await processCustomerMessage(
        { prisma: ctx.prisma, router: ctx.router, secrets: ctx.secrets, queue: ctx.queue },
        {
          tenantId: claim.tenantId,
          agentId,
          conversationId: body.conversationId,
          channel: "WIDGET",
          customerMessage: body.message,
          customerIdentifier: body.customerIdentifier,
          confirmToolCallId: body.confirmToolCallId,
        },
      );
      reply.send(result);
    } catch (err) {
      request.log.error(err);
      reply.code(502).send({
        error: "agent_temporarily_unavailable",
        message: "Sorry, I'm having trouble responding right now. Please try again in a moment.",
      });
    }
  });

  app.get("/v1/chat/:agentId/conversations/:conversationId/messages", async (request, reply) => {
    const { agentId, conversationId } = request.params as { agentId: string; conversationId: string };
    const bearer = request.headers.authorization?.replace(/^Bearer\s+/i, "");
    const claim = bearer ? verifyWidgetToken(bearer) : undefined;
    if (!claim || claim.agentId !== agentId) {
      reply.code(401).send({ error: "invalid_or_missing_widget_token" });
      return;
    }
    const messages = await withTenant(ctx.prisma, { tenantId: claim.tenantId }, (tx) =>
      tx.message.findMany({
        where: { tenantId: claim.tenantId, agentId, conversationId },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, content: true, createdAt: true },
      }),
    );
    reply.send(messages);
  });
}
