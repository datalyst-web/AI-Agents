import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const SignupSchema = z.object({
  tenantName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
});

/**
 * Self-serve entry point (CLAUDE.md Client Lifecycle: "the client
 * configures their own agent... through the client dashboard"). Managed
 * Setup ("staff acting on a client's behalf") never authenticates here —
 * see routes/managedSetup.routes.ts for the impersonation-session flow.
 */
export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post("/v1/auth/signup", async (request, reply) => {
    const body = SignupSchema.parse(request.body);

    // No tenant exists yet for a signing-up user, so this — and the tenant/
    // user creation below — must use the platform-context escape hatch
    // (packages/db/src/client.ts) rather than withTenant(): RLS is FORCEd
    // on `users`/`tenants`, so a query with no session context set returns
    // nothing and an INSERT is rejected outright.
    const existing = await withPlatformContext(ctx.prisma, (tx) => tx.user.findUnique({ where: { email: body.email } }));
    if (existing) {
      reply.code(409).send({ error: "email_already_registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.password, 12);
    const slug = body.tenantName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60);

    const { tenant, user } = await withPlatformContext(ctx.prisma, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: randomUUID(),
          name: body.tenantName,
          slug: `${slug}-${randomUUID().slice(0, 6)}`,
          subscriptionState: "TRIAL",
          subscriptionTier: "STARTER",
          managedSetupTier: "SELF_SERVE",
        },
      });
      const user = await tx.user.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          email: body.email,
          passwordHash,
          role: "tenant_owner",
          displayName: body.tenantName,
        },
      });
      return { tenant, user };
    });

    const token = await reply.jwtSign({ sub: user.id, tenantId: tenant.id, role: "tenant_owner" });
    reply.send({ token, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name } });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = LoginSchema.parse(request.body);
    // The caller's tenant isn't known until we've looked the user up by
    // email — same platform-context reasoning as signup above.
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
    const token = await reply.jwtSign({
      sub: user.id,
      tenantId: user.tenantId ?? undefined,
      role: user.role,
    });
    reply.send({ token, user: { id: user.id, email: user.email, role: user.role, tenantId: user.tenantId } });
  });

  app.get("/v1/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const authUser = request.authUser!;
    // Tenant-scoped users go through withTenant with the tenant the JWT
    // already vouches for; a platform_admin's token carries no tenantId
    // (they aren't scoped to one), so that case alone uses platform context.
    const user = authUser.tenantId
      ? await withTenant(ctx.prisma, { tenantId: authUser.tenantId }, (tx) => tx.user.findUniqueOrThrow({ where: { id: authUser.sub } }))
      : await withPlatformContext(ctx.prisma, (tx) => tx.user.findUniqueOrThrow({ where: { id: authUser.sub } }));
    reply.send({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId, displayName: user.displayName });
  });
}
