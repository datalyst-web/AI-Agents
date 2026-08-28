import { randomUUID, randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const SignupSchema = z.object({
  tenantName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
});
const ForgotPasswordSchema = z.object({ email: z.string().email() });
const ResetPasswordSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
function hashResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

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

  /**
   * Always returns the same generic response whether or not the email is
   * registered — an "email not found" response would let an attacker
   * enumerate real accounts. The one exception is when SMTP genuinely
   * isn't configured at all (a system-level fact, not account-specific),
   * where we say so plainly rather than silently pretending an email went
   * out that never will — CLAUDE.md's anti-hallucination principle
   * applies to our own product just as much as the AI agent's answers.
   */
  app.post("/v1/auth/forgot-password", async (request, reply) => {
    const body = ForgotPasswordSchema.parse(request.body);
    const genericResponse = { message: "If that email is registered, a reset link is on its way." };

    const user = await withPlatformContext(ctx.prisma, (tx) => tx.user.findUnique({ where: { email: body.email } }));
    if (!user || !user.isActive) {
      reply.send(genericResponse);
      return;
    }

    const rawToken = randomBytes(32).toString("hex");
    await withPlatformContext(ctx.prisma, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { passwordResetTokenHash: hashResetToken(rawToken), passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
      }),
    );

    const resetUrl = `${env.DASHBOARD_BASE_URL}/reset-password?token=${rawToken}`;
    const result = await ctx.email.send({
      to: user.email,
      subject: "Reset your password",
      text: `We received a request to reset your password. Reset it here (expires in 1 hour): ${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`,
      html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Reset your password</a> (expires in 1 hour).</p><p>If you didn't request this, you can safely ignore this email.</p>`,
    });

    if (user.tenantId) {
      await withTenant(ctx.prisma, { tenantId: user.tenantId }, (tx) =>
        writeAuditLog(tx, { tenantId: user.tenantId! }, {
          actorUserId: user.id,
          action: "password_reset_requested",
          metadata: { emailSent: result.sent },
        }),
      );
    }

    if (!result.sent && result.error === "smtp_not_configured") {
      reply.send({ message: "Password reset isn't fully set up yet on this platform — contact support directly for now." });
      return;
    }
    reply.send(genericResponse);
  });

  app.post("/v1/auth/reset-password", async (request, reply) => {
    const body = ResetPasswordSchema.parse(request.body);
    const tokenHash = hashResetToken(body.token);

    const user = await withPlatformContext(ctx.prisma, (tx) =>
      tx.user.findFirst({ where: { passwordResetTokenHash: tokenHash } }),
    );
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      reply.code(400).send({ error: "invalid_or_expired_token" });
      return;
    }

    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await withPlatformContext(ctx.prisma, (tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordResetTokenHash: null, passwordResetExpiresAt: null },
      }),
    );

    if (user.tenantId) {
      await withTenant(ctx.prisma, { tenantId: user.tenantId }, (tx) =>
        writeAuditLog(tx, { tenantId: user.tenantId! }, { actorUserId: user.id, action: "password_reset_completed" }),
      );
    }

    reply.send({ message: "Password updated — you can now log in with your new password." });
  });

  app.get("/v1/auth/me", { preHandler: app.authenticate }, async (request, reply) => {
    const authUser = request.authUser!;
    // Tenant-scoped users go through withTenant with the tenant the JWT
    // already vouches for; a platform_admin's token carries no tenantId
    // (they aren't scoped to one), so that case alone uses platform context.
    const { user, theme, subscriptionTier, subscriptionState, brandName, logoUrl } = authUser.tenantId
      ? await withTenant(ctx.prisma, { tenantId: authUser.tenantId }, async (tx) => {
          const [user, tenant] = await Promise.all([
            tx.user.findUniqueOrThrow({ where: { id: authUser.sub } }),
            tx.tenant.findUniqueOrThrow({ where: { id: authUser.tenantId! } }),
          ]);
          return {
            user,
            theme: tenant.theme,
            subscriptionTier: tenant.subscriptionTier,
            subscriptionState: tenant.subscriptionState,
            brandName: tenant.brandName,
            logoUrl: tenant.logoObjectKey ? `/v1/tenants/${tenant.id}/branding/logo` : null,
          };
        })
      : await withPlatformContext(ctx.prisma, async (tx) => ({
          user: await tx.user.findUniqueOrThrow({ where: { id: authUser.sub } }),
          // A staff account with no tenant in scope yet (pre-impersonation)
          // has no tenant theme/plan/branding to inherit — the dashboard
          // chrome just stays on the default until an impersonation
          // session picks one.
          theme: "DARK" as const,
          subscriptionTier: null,
          subscriptionState: null,
          brandName: null,
          logoUrl: null,
        }));
    // Platform operator's own brand — always fetched regardless of tenant
    // scope, since it's the fallback the dashboard sidebar falls back to
    // whenever a tenant hasn't been given its own white-label branding
    // (or there's no tenant in scope at all, e.g. staff pre-impersonation).
    const platformSettings = await ctx.prisma.platformSettings.findUnique({ where: { id: "global" } });
    reply.send({
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      displayName: user.displayName,
      theme,
      subscriptionTier,
      subscriptionState,
      brandName,
      logoUrl,
      platformBrandName: platformSettings?.brandName ?? null,
      platformLogoUrl: platformSettings?.logoObjectKey ? "/v1/platform/branding/logo" : null,
    });
  });
}
