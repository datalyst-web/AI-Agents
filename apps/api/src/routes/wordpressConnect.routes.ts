import bcrypt from "bcryptjs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";

const ConnectSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * A one-shot credential check + agent listing for the Datalyst AI Concierge
 * WordPress plugin (wordpress-plugin/datalyst-ai-concierge) — a
 * server-to-server PHP request (wp_remote_post), never a browser form, so
 * it deliberately skips Turnstile (that's an anti-bot gate for the public
 * login page specifically; this is a real credential check hit by a
 * legitimate site backend, same IP-based rate limiting as every other
 * pre-auth route still applies). No token is issued or stored — the
 * plugin only ever persists a chosen agentId + widget position, both
 * non-secret, exactly like the manual embed snippet.
 */
export async function registerWordpressConnectRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/integrations/wordpress/connect", async (request, reply) => {
    const body = ConnectSchema.parse(request.body);

    const user = await withPlatformContext(ctx.prisma, (tx) => tx.user.findUnique({ where: { email: body.email } }));
    if (!user || !user.isActive) {
      reply.code(401).send({ error: "invalid_credentials" });
      return;
    }
    const valid = await bcrypt.compare(body.password, user.passwordHash);
    if (!valid) {
      reply.code(401).send({ error: "invalid_credentials" });
      return;
    }
    // Staff (platform_admin/setup_specialist) have no single tenant's own
    // agents to list — this flow is for a client connecting their own
    // site, not staff managing one on a client's behalf.
    if (!user.tenantId) {
      reply.code(403).send({ error: "not_a_client_account" });
      return;
    }

    const { tenant, agents } = await withTenant(ctx.prisma, { tenantId: user.tenantId }, async (tx) => {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId! } });
      const agents = await tx.agent.findMany({
        where: { tenantId: user.tenantId! },
        select: { id: true, name: true, status: true },
        orderBy: { name: "asc" },
      });
      return { tenant, agents };
    });

    reply.send({ tenantName: tenant.name, agents });
  });
}
