import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
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

const CreateClientSchema = z.object({
  tenantName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
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

  /**
   * Staff-initiated client creation — the "we add all the information
   * ourselves" onboarding path (CLAUDE.md Managed Setup Service): staff
   * create the tenant + its owner login here, then continue setup via
   * the normal impersonation flow. Deliberately requireStaff(), not the
   * platform:manage_tenants used above — this is routine day-to-day staff
   * work, not a rarer platform-admin action. Mirrors auth.routes.ts
   * signup's tenant+user creation exactly, just staff-initiated and
   * defaulted to FULLY_MANAGED instead of SELF_SERVE.
   */
  app.post(
    "/v1/platform/clients",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const body = CreateClientSchema.parse(request.body);
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

      const tenant = await withPlatformContext(ctx.prisma, async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            id: randomUUID(),
            name: body.tenantName,
            slug: `${slug}-${randomUUID().slice(0, 6)}`,
            subscriptionState: "ACTIVE",
            subscriptionTier: "STARTER",
            managedSetupTier: "FULLY_MANAGED",
          },
        });
        await tx.user.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            email: body.email,
            passwordHash,
            role: "tenant_owner",
            displayName: body.tenantName,
          },
        });
        return tenant;
      });
      await withTenant(ctx.prisma, { tenantId: tenant.id }, (tx) =>
        writeAuditLog(tx, { tenantId: tenant.id }, {
          actorUserId: request.authUser!.sub,
          action: "tenant_created_by_staff",
          metadata: { ownerEmail: body.email },
        }),
      );
      reply.send(tenant);
    },
  );

  /**
   * "Remove" a client = cancel, never a hard delete — CLAUDE.md "On
   * expiry, suspend the agent — never delete client data." A dedicated,
   * narrow action (not the broad PATCH above, which stays
   * platform_admin-only) so day-to-day staff can do this without also
   * getting billing-tier-edit rights.
   */
  app.post(
    "/v1/platform/tenants/:tenantId/cancel",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const updated = await withPlatformContext(ctx.prisma, (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: { subscriptionState: "CANCELLED" } }),
      );
      await withTenant(ctx.prisma, { tenantId }, (tx) =>
        writeAuditLog(tx, { tenantId }, { actorUserId: request.authUser!.sub, action: "tenant_cancelled_by_staff" }),
      );
      reply.send(updated);
    },
  );

  app.post(
    "/v1/platform/tenants/:tenantId/reactivate",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const updated = await withPlatformContext(ctx.prisma, (tx) =>
        tx.tenant.update({ where: { id: tenantId }, data: { subscriptionState: "ACTIVE" } }),
      );
      await withTenant(ctx.prisma, { tenantId }, (tx) =>
        writeAuditLog(tx, { tenantId }, { actorUserId: request.authUser!.sub, action: "tenant_reactivated_by_staff" }),
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

  const LOGO_MIME_TO_EXT: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "image/webp": "webp",
  };
  const LOGO_EXT_TO_MIME = Object.fromEntries(Object.entries(LOGO_MIME_TO_EXT).map(([m, e]) => [e, m]));

  /**
   * White-label per-client branding — lives under /v1/platform/tenants,
   * not /v1/tenants, and uses requireStaff() + withPlatformContext
   * rather than requireTenantMatch()/impersonation: staff manage a
   * client's branding directly from the Managed Setup queue, without
   * first starting a full "act as tenant" session for it (that
   * architecture — setup_specialist's resolveTenantContext always
   * requires an active impersonation to resolve *any* tenant context —
   * is exactly why this couldn't be a tenant-scoped route). Distinct
   * from the theme route above, which the tenant itself controls.
   */
  app.patch(
    "/v1/platform/tenants/:tenantId/branding",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
      const { brandName } = z.object({ brandName: z.string().trim().min(1).max(80).nullable() }).parse(request.body);
      const updated = await withPlatformContext(ctx.prisma, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { brandName } }));
      await withTenant(ctx.prisma, { tenantId }, (tx) =>
        writeAuditLog(tx, { tenantId }, { actorUserId: request.authUser!.sub, action: "tenant_branding_updated", metadata: { brandName } }),
      );
      reply.send(updated);
    },
  );

  app.post(
    "/v1/platform/tenants/:tenantId/branding/logo",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };
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
      const key = ctx.objectStore.tenantKey(tenantId, "branding", `logo-${Date.now()}.${ext}`);
      await ctx.objectStore.putObject(key, buffer, file.mimetype);
      const updated = await withPlatformContext(ctx.prisma, (tx) => tx.tenant.update({ where: { id: tenantId }, data: { logoObjectKey: key } }));
      await withTenant(ctx.prisma, { tenantId }, (tx) =>
        writeAuditLog(tx, { tenantId }, { actorUserId: request.authUser!.sub, action: "tenant_branding_updated", metadata: { logoUploaded: true } }),
      );
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

  // ---------------------------------------------------------------------
  // Platform branding — the platform operator's OWN identity (e.g.
  // "Datalyst Africa"), not a specific client's. Shown on staff's own
  // unscoped dashboard view and as the fallback for any tenant with no
  // white-label branding of its own yet. Not tenant-scoped, so this uses
  // requireStaff() directly rather than requireTenantMatch().
  // ---------------------------------------------------------------------
  app.patch(
    "/v1/platform/branding",
    { preHandler: [app.authenticate, requireStaff()] },
    async (request, reply) => {
      const { brandName } = z.object({ brandName: z.string().trim().min(1).max(80).nullable() }).parse(request.body);
      const updated = await ctx.prisma.platformSettings.upsert({
        where: { id: "global" },
        create: { id: "global", brandName },
        update: { brandName },
      });
      reply.send(updated);
    },
  );

  app.post(
    "/v1/platform/branding/logo",
    { preHandler: [app.authenticate, requireStaff()] },
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
      const key = `platform/branding/logo-${Date.now()}.${ext}`;
      await ctx.objectStore.putObject(key, buffer, file.mimetype);
      const updated = await ctx.prisma.platformSettings.upsert({
        where: { id: "global" },
        create: { id: "global", logoObjectKey: key },
        update: { logoObjectKey: key },
      });
      reply.send(updated);
    },
  );

  app.get("/v1/platform/branding/logo", async (_request, reply) => {
    const settings = await ctx.prisma.platformSettings.findUnique({ where: { id: "global" } });
    if (!settings?.logoObjectKey) {
      reply.code(404).send({ error: "no_logo" });
      return;
    }
    const buffer = await ctx.objectStore.getObject(settings.logoObjectKey);
    const ext = settings.logoObjectKey.split(".").pop()?.toLowerCase() ?? "";
    const contentType = LOGO_EXT_TO_MIME[ext] ?? "application/octet-stream";
    reply.header("cache-control", "public, max-age=3600").type(contentType).send(buffer);
  });
}
