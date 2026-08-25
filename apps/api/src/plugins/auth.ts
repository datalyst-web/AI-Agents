import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Role } from "@chat-agent/shared-types";
import { env } from "../env.js";

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
export default fp(async function authPlugin(fastify: FastifyInstance) {
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
    }
  });
});
