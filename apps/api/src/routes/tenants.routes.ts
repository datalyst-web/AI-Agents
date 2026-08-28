import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import { SubscriptionStateSchema, SubscriptionTierSchema, ManagedSetupTierSchema, DashboardThemeSchema } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requirePermission, resolveTenantContext, requireTenantMatch, requireStaff } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";

const UpdateTenantSchema = z.object({
  subscriptionState: SubscriptionStateSchema.optional(),
  subscriptionTier: SubscriptionTierSchema.optional(),
  managedSetupTier: ManagedSetupTierSchema.optional(),
  delegatesAutoPublish: z.boolean().optional(),
});

/**
 * platform_admin-only tenant management. On subscription expiry the
 * tenant is suspended, never deleted — see CLAUDE.md "On expiry, suspend
 * the agent — never delete client data." Suspension is a state change
 * here; the actual inbound-request fallback behavior lives in
 * chat.routes.ts, which checks subscriptionState before processing a turn.
 */
export async function registerTenantRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get(
    "/v1/platform/tenants",
    { preHandler: [app.authenticate, requirePermission("platform:manage_tenants")] },
    async () => {
      return withPlatformContext(ctx.prisma, (tx) => tx.tenant.findMany({ orderBy: { createdAt: "desc" } }));
    },
  );

  app.patch(
    "/v1/platform/tenants/:tenantId",
    { preHandler: [app.authenticate, requirePermission("platform:manage_tenants")] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const body = UpdateTenantSchema.parse(request.body);
      const updated = await withPlatformContext(ctx.prisma, (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: body }),
      );
      reply.send(updated);
    },
  );

  app.get("/v1/tenants/:tenantId", { preHandler: [app.authenticate] }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const requestCtx = resolveTenantContext(request, tenantId);
    if (!requestCtx) {
      reply.code(403).send({ error: "forbidden" });
      return;
    }
    const tenant = await withTenant(ctx.prisma, requestCtx, (tx) =>
      tx.tenant.findFirstOrThrow({ where: { id: tenantId } }),
    );
    // logoObjectKey is an internal S3 key — never leak it, expose the
    // servable route instead (or null when no logo is set).
    const { logoObjectKey, ...rest } = tenant;
    reply.send({ ...rest, logoUrl: logoObjectKey ? `/v1/tenants/${tenantId}/branding/logo` : null });
  });

  /**
   * Client-facing theme preference — deliberately separate from the
   * platform_admin-only PATCH above (billing/tier fields vs. a cosmetic
   * choice any tenant with agent:write can make for themselves). Drives
   * both the dashboard's own chrome and every one of this tenant's
   * widgets in one shot (see widgetConfig.routes.ts).
   */
  app.patch(
    "/v1/tenants/:tenantId/theme",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requirePermission("tenant:customize")] },
    async (request, reply) => {
      const { theme } = z.object({ theme: DashboardThemeSchema }).parse(request.body);
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const tenant = await tx.tenant.update({ where: { id: request.tenantCtx!.tenantId }, data: { theme } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          action: "tenant_theme_updated",
          metadata: { theme },
        });
        return tenant;
      });
      reply.send(updated);
    },
  );

  /**
   * White-label dashboard branding — staff-only (requireStaff, not any
   * tenant Permission) since this is explicitly something staff set up
   * for a client during onboarding, never client-editable. Distinct from
   * the theme route above, which any tenant user with tenant:customize
   * can change for themselves.
   */
  app.patch(
    "/v1/tenants/:tenantId/branding",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requireStaff()] },
    async (request, reply) => {
      const { brandName } = z.object({ brandName: z.string().trim().min(1).max(80).nullable() }).parse(request.body);
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const tenant = await tx.tenant.update({ where: { id: request.tenantCtx!.tenantId }, data: { brandName } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          action: "tenant_branding_updated",
          metadata: { brandName },
        });
        return tenant;
      });
      reply.send(updated);
    },
  );

  const LOGO_MIME_TO_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  const LOGO_EXT_TO_MIME = Object.fromEntries(Object.entries(LOGO_MIME_TO_EXT).map(([m, e]) => [e, m]));

  app.post(
    "/v1/tenants/:tenantId/branding/logo",
    { preHandler: [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma), requireStaff()] },
    async (request, reply) => {
      const file = await request.file();
      if (!file) {
        reply.code(400).send({ error: "no_file_uploaded" });
        return;
      }
      const ext = LOGO_MIME_TO_EXT[file.mimetype];
      if (!ext) {
        reply.code(400).send({ error: "unsupported_file_type", supported: Object.keys(LOGO_MIME_TO_EXT) });
        return;
      }
      const buffer = await file.toBuffer();
      const key = ctx.objectStore.tenantKey(request.tenantCtx!.tenantId, "branding", `logo-${Date.now()}.${ext}`);
      await ctx.objectStore.putObject(key, buffer, file.mimetype);
      const updated = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const tenant = await tx.tenant.update({ where: { id: request.tenantCtx!.tenantId }, data: { logoObjectKey: key } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.authUser!.sub,
          action: "tenant_branding_updated",
          metadata: { logoUploaded: true },
        });
        return tenant;
      });
      reply.send(updated);
    },
  );

  /**
   * Public, unauthenticated by design — a company logo is a non-sensitive
   * branding asset (same trust model as widget-config's public agent
   * fetch), and a plain <img src> can't carry an Authorization header.
   * Streamed through our own API rather than a public S3 URL/bucket
   * policy change, consistent with proxying all object storage access.
   */
  app.get("/v1/tenants/:tenantId/branding/logo", async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const tenant = await withPlatformContext(ctx.prisma, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { logoObjectKey: true } }),
    );
    if (!tenant?.logoObjectKey) {
      reply.code(404).send({ error: "no_logo" });
      return;
    }
    const buffer = await ctx.objectStore.getObject(tenant.logoObjectKey);
    const ext = tenant.logoObjectKey.split(".").pop()?.toLowerCase() ?? "";
    const contentType = LOGO_EXT_TO_MIME[ext] ?? "application/octet-stream";
    reply.header("cache-control", "public, max-age=3600").type(contentType).send(buffer);
  });
}
