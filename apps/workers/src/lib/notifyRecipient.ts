import { withTenant, withPlatformContext, type PrismaClient } from "@chat-agent/db";

/**
 * Resolves a workflow notify target ("tenant_owner" / "tenant_admin" /
 * "staff_fallback") to a real email address to send to. tenant_owner/
 * tenant_admin picks the first active user with that role on the tenant;
 * staff_fallback — no specific staff contact is configured per-tenant
 * today — goes to the platform's own admin distribution so a workflow
 * failure never has nobody to land on, then falls back further to the
 * tenant owner if even that's empty (a brand-new platform with no
 * platform_admin seeded yet shouldn't leave the tenant owner in the
 * dark). Takes the raw client rather than an already-scoped tx: the
 * staff_fallback branch needs platform context (platform_admin users
 * have tenantId=null, which a tenant-scoped RLS session can't see —
 * same class of bug fixed earlier in verifyActiveImpersonation), while
 * the tenant_owner/tenant_admin branches need tenant context, so this
 * has to pick its own scope per branch rather than trust the caller's.
 */
export async function resolveNotifyRecipientEmail(
  prisma: PrismaClient,
  tenantId: string,
  target: "tenant_owner" | "tenant_admin" | "staff_fallback",
): Promise<string | undefined> {
  if (target === "staff_fallback") {
    const staff = await withPlatformContext(prisma, (tx) =>
      tx.user.findFirst({ where: { role: "platform_admin", isActive: true }, orderBy: { createdAt: "asc" } }),
    );
    if (staff) return staff.email;
    return resolveNotifyRecipientEmail(prisma, tenantId, "tenant_owner");
  }

  const user = await withTenant(prisma, { tenantId }, (tx) =>
    tx.user.findFirst({ where: { tenantId, role: target, isActive: true }, orderBy: { createdAt: "asc" } }),
  );
  if (user) return user.email;
  if (target === "tenant_admin") return resolveNotifyRecipientEmail(prisma, tenantId, "tenant_owner");
  return undefined;
}
