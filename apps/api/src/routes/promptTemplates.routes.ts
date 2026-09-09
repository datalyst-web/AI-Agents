import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../lib/context.js";
import { requireStaff } from "../lib/rbac.js";

const CreateTemplateSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  systemInstructions: z.string().min(1),
  guardrailPolicy: z.string().default("PREFER_UNKNOWN_OVER_INVENTED_FACT_CONFIRM_BEFORE_ACTING"),
  isDefault: z.boolean().default(false),
});
const UpdateTemplateSchema = CreateTemplateSchema.partial();

/**
 * Starting-point templates for staff to reference/copy from while
 * configuring a new client's agent under Managed Setup — never applied
 * automatically to any tenant/agent (CLAUDE.md: staff configure through
 * the same tools a client would, deliberately, not a silent default).
 */
export async function registerPromptTemplateRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireStaff()];

  app.get("/v1/platform/prompt-templates", { preHandler: scoped }, async () => {
    return ctx.prisma.promptTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  });

  app.post("/v1/platform/prompt-templates", { preHandler: scoped }, async (request, reply) => {
    const body = CreateTemplateSchema.parse(request.body);
    const template = await ctx.prisma.promptTemplate.create({ data: { id: randomUUID(), ...body } });
    reply.send(template);
  });

  app.patch("/v1/platform/prompt-templates/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = UpdateTemplateSchema.parse(request.body);
    const template = await ctx.prisma.promptTemplate.update({ where: { id }, data: body });
    reply.send(template);
  });

  app.delete("/v1/platform/prompt-templates/:id", { preHandler: scoped }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await ctx.prisma.promptTemplate.delete({ where: { id } });
    reply.code(204).send();
  });
}
