import { randomUUID, randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant, withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

// Never tenant_owner (exactly one, set at signup and never re-assigned via
// invite) or a staff role — a tenant can only invite people into its own
// tenant-side roles.
const InvitableRoleSchema = z.enum(["tenant_admin", "tenant_agent_editor", "tenant_viewer"]);
const CreateInviteSchema = z.object({ email: z.string().email(), role: InvitableRoleSchema });

const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Tenant-side team management (CLAUDE.md RBAC) — invite/remove teammates on
 * the client's own dashboard. Distinct from platformStaff.routes.ts, which
 * manages our internal staff, and from managedSetup.routes.ts impersonation,
 * which is staff acting temporarily on a tenant's behalf, not tenant
 * membership itself.
 */
export async function registerTeamRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get("/v1/tenants/:tenantId/team", { preHandler: scoped }, async (request) => {
    const [members, invites] = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
      const members = await tx.user.findMany({
        where: { tenantId: request.tenantCtx!.tenantId, isActive: true },
        select: { id: true, email: true, displayName: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });
      const invites = await tx.teamInvite.findMany({
        where: { tenantId: request.tenantCtx!.tenantId, acceptedAt: null, revokedAt: null },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      return [members, invites];
    });
    return {
      members,
      invites: invites.map((i) => ({ ...i, expired: i.expiresAt < new Date() })),
    };
  });

  app.post(
    "/v1/tenants/:tenantId/team/invites",
    { preHandler: [...scoped, requirePermission("team:invite")] },
    async (request, reply) => {
      const { email, role } = CreateInviteSchema.parse(request.body);
      const tenantId = request.tenantCtx!.tenantId;

      // Email uniqueness is global (User.email @unique) — checked via
      // platform context since a match could belong to any tenant, not
      // just this one.
      const existingUser = await withPlatformContext(ctx.prisma, (tx) => tx.user.findUnique({ where: { email } }));
      if (existingUser) {
        reply.code(409).send({ error: "email_already_registered" });
        return;
      }

      const rawToken = randomBytes(32).toString("hex");
      const invite = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.teamInvite.upsert({
          where: { tenantId_email: { tenantId, email } },
          create: {
            id: randomUUID(),
            tenantId,
            email,
            role,
            tokenHash: hashInviteToken(rawToken),
            invitedByUserId: request.authUser!.sub,
            expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
          },
          // Re-inviting (e.g. after the link expired) reuses the row and
          // issues a fresh token — same reasoning as the Telegram
          // reconnect-reuses-the-row pattern in channels.routes.ts.
          update: {
            role,
            tokenHash: hashInviteToken(rawToken),
            invitedByUserId: request.authUser!.sub,
            expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
            acceptedAt: null,
            revokedAt: null,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          action: "team_member_invited",
          metadata: { email, role },
        });
        return created;
      });

      const inviteUrl = `${env.DASHBOARD_BASE_URL}/accept-invite?token=${rawToken}`;
      const result = await ctx.email.send({
        to: email,
        subject: "You've been invited to join your team's AI Console",
        text: `You've been invited to join their AI Console dashboard as a ${role.replace(/^tenant_/, "")}. Accept the invite here (expires in 7 days): ${inviteUrl}\n\nIf you weren't expecting this, you can safely ignore this email.`,
        html: `<p>You've been invited to join their AI Console dashboard as a <strong>${role.replace(/^tenant_/, "")}</strong>.</p><p><a href="${inviteUrl}">Accept the invite</a> (expires in 7 days).</p><p>If you weren't expecting this, you can safely ignore this email.</p>`,
      });

      reply.send({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
        emailSent: result.sent,
      });
    },
  );

  app.delete(
    "/v1/tenants/:tenantId/team/invites/:inviteId",
    { preHandler: [...scoped, requirePermission("team:invite")] },
    async (request, reply) => {
      const { inviteId } = request.params as { inviteId: string };
      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const { count } = await tx.teamInvite.updateMany({
          where: { id: inviteId, tenantId: request.tenantCtx!.tenantId, acceptedAt: null },
          data: { revokedAt: new Date() },
        });
        if (count > 0) {
          await writeAuditLog(tx, request.tenantCtx!, {
            actorUserId: request.authUser!.sub,
            action: "team_invite_revoked",
            metadata: { inviteId },
          });
        }
      });
      reply.code(204).send();
    },
  );

  app.delete(
    "/v1/tenants/:tenantId/team/members/:userId",
    { preHandler: [...scoped, requirePermission("team:remove")] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const tenantId = request.tenantCtx!.tenantId;

      if (userId === request.authUser!.sub) {
        reply.code(400).send({ error: "cannot_remove_self" });
        return;
      }

      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const target = await tx.user.findFirst({ where: { id: userId, tenantId } });
        if (!target || !target.isActive) {
          reply.code(404).send({ error: "not_found" });
          return;
        }
        // A tenant must always keep at least one owner — otherwise nobody
        // left in it could ever grant/revoke access again.
        if (target.role === "tenant_owner") {
          const otherOwners = await tx.user.count({ where: { tenantId, role: "tenant_owner", isActive: true, NOT: { id: userId } } });
          if (otherOwners === 0) {
            reply.code(400).send({ error: "cannot_remove_last_owner" });
            return;
          }
        }
        // Soft removal (isActive: false), same as staff deactivation in
        // platformStaff.routes.ts — CLAUDE.md "never delete client data"
        // applies to a former teammate's own audit-trail attribution too,
        // not just tenant-owned business data.
        await tx.user.update({ where: { id: userId }, data: { isActive: false } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          action: "team_member_removed",
          metadata: { removedUserId: userId, removedEmail: target.email },
        });
        reply.code(204).send();
      });
    },
  );
}
