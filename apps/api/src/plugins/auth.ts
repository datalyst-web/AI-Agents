import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@chat-agent/shared-types";
import { withTenant, type PrismaClient } from "@chat-agent/db";
import { env } from "../env.js";
import { isRouteOpenWhileLapsed, isSubscriptionLapsed, SUBSCRIPTION_REQUIRED_MESSAGE } from "../lib/subscriptionAccess.js";

export interface JwtPayload {
  sub: string; // user id
  tenantId?: string;
  role: Role;
  impersonation?: { staffUserId: string; sessionId: string; expiresAt: string };
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    authUser?: JwtPayload;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/**
 * Auth boundary for the whole API. Every route that reaches tenant data
 * must go through `fastify.authenticate` first — routes that skip it
 * (widget public endpoints) derive their TenantContext a different way
 * (signed agent embed token), never from an unauthenticated request body.
 */
export default fp(async function authPlugin(fastify: FastifyInstance, opts: { prisma?: PrismaClient }) {
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { iss: env.JWT_ISSUER, expiresIn: env.JWT_EXPIRY },
  });

  fastify.decorate("authenticate", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      request.authUser = request.user;

      // A staff impersonation claim that has expired must not silently be
      // treated as staff-with-no-tenant-access — reject outright so the
      // caller re-establishes a fresh, audited session (CLAUDE.md:
      // "time-boxed" impersonation).
      const imp = request.authUser.impersonation;
      if (imp && new Date(imp.expiresAt).getTime() < Date.now()) {
        reply.code(401).send({ error: "impersonation_session_expired" });
        return;
      }
    } catch {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }

    // A client whose trial ended or who stopped paying can still sign in,
    // but only reach Billing (to pay), Usage and Support — enforced here,
    // on every authenticated route, rather than by hiding dashboard pages.
    // Staff are exempt, including while managing that client, so the team
    // can still help them. The dashboard reads the same rule from /me.
    const { role, tenantId } = request.authUser;
    const isStaff = role === "platform_admin" || role === "setup_specialist";
    if (!opts.prisma || isStaff || !tenantId || isRouteOpenWhileLapsed(request.routeOptions.url)) return;
    try {
      const tenant = await withTenant(opts.prisma, { tenantId }, (tx) =>
        tx.tenant.findUnique({ where: { id: tenantId }, select: { subscriptionState: true, trialEndsAt: true } }),
      );
      if (tenant && isSubscriptionLapsed(tenant)) {
        reply.code(402).send({ error: "subscription_required", message: SUBSCRIPTION_REQUIRED_MESSAGE });
      }
    } catch (err) {
      // Fail open: wrongly locking a paying client out of their dashboard
      // is worse than letting a lapsed one through during a DB blip — the
      // same rule checkUsageAllowance follows.
      request.log.error({ err }, "subscription check failed; allowing request");
    }
  });
});
