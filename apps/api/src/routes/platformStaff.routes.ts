import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireStaff } from "../lib/rbac.js";

const StaffRoleSchema = z.enum(["setup_specialist", "platform_admin"]);
const CreateStaffSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120),
  role: StaffRoleSchema.default("setup_specialist"),
});

/**
 * Internal staff account management (CLAUDE.md "Internal roles &
 * access"). requireStaff() rather than platform_admin-only: this
 * deployment's only staff account today is a setup_specialist, and
 * gating new-staff creation to a role nobody has yet would make the
 * feature unusable. New staff default to setup_specialist — the role
 * that already carries full Managed Setup / impersonation authority —
 * so "same authority to modify the page" is satisfied by default; a
 * platform_admin account can still be chosen explicitly when needed.
 */
export async function registerPlatformStaffRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/v1/platform/staff", { preHandler: [app.authenticate, requireStaff()] }, async () => {
    return withPlatformContext(ctx.prisma, (tx) =>
      tx.user.findMany({
        where: { role: { in: ["setup_specialist", "platform_admin"] } },
        select: { id: true, email: true, displayName: true, role: true, isActive: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    );
  });

  app.post("/v1/platform/staff", { preHandler: [app.authenticate, requireStaff()] }, async (request, reply) => {
    const body = CreateStaffSchema.parse(request.body);
    const existing = await withPlatformContext(ctx.prisma, (tx) => tx.user.findUnique({ where: { email: body.email } }));
    if (existing) {
      reply.code(409).send({ error: "email_already_registered" });
      return;
    }
    const passwordHash = await bcrypt.hash(body.password, 12);
    // Staff users are never tenant-scoped — they only ever touch a
    // tenant through a logged, time-boxed impersonation session.
    const user = await withPlatformContext(ctx.prisma, (tx) =>
      tx.user.create({
        data: {
          id: randomUUID(),
          tenantId: null,
          email: body.email,
          passwordHash,
          role: body.role,
          displayName: body.displayName,
        },
      }),
    );
    reply.send({ id: user.id, email: user.email, displayName: user.displayName, role: user.role });
  });

  /**
   * "Remove" a staff account = deactivate (isActive: false, login.routes
   * already rejects inactive users), never a hard delete — same
   * never-delete reasoning as client removal, plus a deactivated staff
   * user's past audit log rows stay attributable. A staff member can't
   * deactivate their own account (would lock them out with no one able
   * to undo it if they're the only admin left).
   */
  app.post("/v1/platform/staff/:staffId/deactivate", { preHandler: [app.authenticate, requireStaff()] }, async (request, reply) => {
    const { staffId } = request.params as { staffId: string };
    if (staffId === request.authUser!.sub) {
      reply.code(400).send({ error: "cannot_deactivate_self" });
      return;
    }
    const user = await withPlatformContext(ctx.prisma, (tx) => tx.user.update({ where: { id: staffId }, data: { isActive: false } }));
    reply.send({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, isActive: user.isActive });
  });

  app.post("/v1/platform/staff/:staffId/reactivate", { preHandler: [app.authenticate, requireStaff()] }, async (request, reply) => {
    const { staffId } = request.params as { staffId: string };
    const user = await withPlatformContext(ctx.prisma, (tx) => tx.user.update({ where: { id: staffId }, data: { isActive: true } }));
    reply.send({ id: user.id, email: user.email, displayName: user.displayName, role: user.role, isActive: user.isActive });
  });
}
