import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withPlatformContext, withTenant } from "@chat-agent/db";
import type { AppContext } from "../lib/context.js";
import { requireStaff } from "../lib/rbac.js";
import { writeAuditLog } from "../lib/audit.js";

const LOGO_MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};
const LOGO_EXT_TO_MIME = Object.fromEntries(Object.entries(LOGO_MIME_TO_EXT).map(([m, e]) => [e, m]));

/**
 * A reusable white-label identity staff can apply to a tenant in one
 * click — e.g. an agency reseller's own consistent brand across many of
 * their own sub-clients — instead of re-uploading the same logo by hand
 * on every one of that reseller's tenants.
 */
export async function registerBrandingPresetRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireStaff()];

  app.get("/v1/platform/branding-presets", { preHandler: scoped }, async () => {
    const presets = await ctx.prisma.brandingPreset.findMany({ orderBy: { name: "asc" } });
    return presets.map(({ logoObjectKey, ...rest }) => ({
      ...rest,
      logoUrl: logoObjectKey ? `/v1/platform/branding-presets/${rest.id}/logo` : null,
    }));
  });

  app.post("/v1/platform/branding-presets", { preHandler: scoped }, async (request, reply) => {
    const body = z.object({ name: z.string().min(1).max(120), brandName: z.string().min(1).max(80) }).parse(request.body);
    const preset = await ctx.prisma.brandingPreset.create({ data: { id: randomUUID(), ...body } });
    reply.send(preset);
  });

  app.post("/v1/platform/branding-presets/:id/logo", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
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
    const key = ctx.objectStore.tenantKey("platform", "branding-presets", `${id}-${Date.now()}.${ext}`);
    await ctx.objectStore.putObject(key, buffer, file.mimetype);
    const preset = await ctx.prisma.brandingPreset.update({ where: { id }, data: { logoObjectKey: key } });
    reply.send(preset);
  });

  app.get("/v1/platform/branding-presets/:id/logo", async (request, reply) => {
    const { id } = request.params as { id: string };
    const preset = await ctx.prisma.brandingPreset.findUnique({ where: { id } });
    if (!preset?.logoObjectKey) {
      reply.code(404).send();
      return;
    }
    const buffer = await ctx.objectStore.getObject(preset.logoObjectKey);
    const ext = preset.logoObjectKey.split(".").pop()?.toLowerCase() ?? "";
    const contentType = LOGO_EXT_TO_MIME[ext] ?? "application/octet-stream";
    reply.header("cache-control", "public, max-age=3600").type(contentType).send(buffer);
  });

  app.delete("/v1/platform/branding-presets/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.prisma.brandingPreset.delete({ where: { id } });
    reply.code(204).send();
  });

  app.post("/v1/platform/tenants/:tenantId/branding/apply-preset", { preHandler: scoped }, async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const { presetId } = z.object({ presetId: z.string().uuid() }).parse(request.body);
    const preset = await ctx.prisma.brandingPreset.findUniqueOrThrow({ where: { id: presetId } });
    const updated = await withPlatformContext(ctx.prisma, (tx) =>
      tx.tenant.update({ where: { id: tenantId }, data: { brandName: preset.brandName, logoObjectKey: preset.logoObjectKey } }),
    );
    await withTenant(ctx.prisma, { tenantId }, (tx) =>
      writeAuditLog(tx, { tenantId }, {
        actorUserId: request.authUser!.sub,
        action: "tenant_branding_updated",
        metadata: { appliedPreset: preset.name },
      }),
    );
    reply.send(updated);
  });
}
