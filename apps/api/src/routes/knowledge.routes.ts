import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { withTenant } from "@chat-agent/db";
import { QUEUE_NAMES } from "@chat-agent/queue";
import type { KnowledgeIngestJob } from "@chat-agent/shared-types";
import type { AppContext } from "../lib/context.js";
import { requireTenantMatch, requirePermission } from "../lib/rbac.js";
import { verifyActiveImpersonation } from "../lib/impersonation.js";
import { writeAuditLog } from "../lib/audit.js";
import { env } from "../env.js";

/** SQS queue URL when configured (production), otherwise the logical Redis-dev queue name — see createQueueClient(). */
function knowledgeIngestQueueTarget(): string {
  return env.SQS_KNOWLEDGE_INGEST_QUEUE_URL ?? QUEUE_NAMES.knowledgeIngest;
}

const CrawlSchema = z.object({ agentId: z.string().uuid(), startUrls: z.array(z.string().url()).min(1).max(20) });
const FaqSchema = z.object({
  agentId: z.string().uuid(),
  entries: z.array(z.object({ question: z.string().min(1), answer: z.string().min(1) })).min(1),
});

const EXT_TO_TYPE: Record<string, "PDF" | "DOCX" | "TXT" | "CSV"> = {
  pdf: "PDF",
  docx: "DOCX",
  txt: "TXT",
  csv: "CSV",
};

export async function registerKnowledgeRoutes(app: FastifyInstance, ctx: AppContext) {
  const scoped = [app.authenticate, requireTenantMatch(), verifyActiveImpersonation(ctx.prisma)];

  app.get("/v1/tenants/:tenantId/agents/:agentId/knowledge", { preHandler: scoped }, async (request) => {
    const { agentId } = request.params as { agentId: string };
    return withTenant(ctx.prisma, request.tenantCtx!, (tx) =>
      tx.knowledgeSource.findMany({ where: { tenantId: request.tenantCtx!.tenantId, agentId }, orderBy: { createdAt: "desc" } }),
    );
  });

  /** Document upload (PDF/DOCX/TXT/CSV) -> S3 -> enqueue ingestion. */
  app.post(
    "/v1/tenants/:tenantId/agents/:agentId/knowledge/upload",
    { preHandler: [...scoped, requirePermission("knowledge:write")] },
    async (request, reply) => {
      const { agentId } = request.params as { agentId: string };
      const file = await request.file();
      if (!file) {
        reply.code(400).send({ error: "no_file_uploaded" });
        return;
      }
      const ext = (file.filename.split(".").pop() ?? "").toLowerCase();
      const fileType = EXT_TO_TYPE[ext];
      if (!fileType) {
        reply.code(400).send({ error: "unsupported_file_type", supported: Object.keys(EXT_TO_TYPE) });
        return;
      }

      const buffer = await file.toBuffer();
      const actorSource = request.tenantCtx!.impersonation ? "STAFF_MANAGED_SETUP" : "CLIENT";
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;
      const knowledgeSourceId = randomUUID();
      const s3Key = ctx.objectStore.tenantKey(request.tenantCtx!.tenantId, "knowledge", agentId, `${knowledgeSourceId}-${file.filename}`);

      await ctx.objectStore.putObject(s3Key, buffer, file.mimetype);

      const source = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.knowledgeSource.create({
          data: {
            id: knowledgeSourceId,
            tenantId: request.tenantCtx!.tenantId,
            agentId,
            type: fileType,
            status: "PENDING",
            originalFilename: file.filename,
            s3Key,
            addedBySource: actorSource,
            addedByUserId: actorUserId,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId,
          action: "document_uploaded",
          contentSource: actorSource === "STAFF_MANAGED_SETUP" ? "client-provided file (staff upload)" : "client dashboard upload",
          metadata: { filename: file.filename, knowledgeSourceId },
        });
        return created;
      });

      await ctx.queue.enqueue<KnowledgeIngestJob>(knowledgeIngestQueueTarget(), {
        tenantId: request.tenantCtx!.tenantId,
        agentId,
        knowledgeSourceId,
        kind: "FILE",
        s3Key,
        originalFilename: file.filename,
        fileType,
      });

      reply.code(202).send(source);
    },
  );

  /** Website crawl ingestion source. */
  app.post(
    "/v1/tenants/:tenantId/knowledge/crawl",
    { preHandler: [...scoped, requirePermission("knowledge:write")] },
    async (request, reply) => {
      const body = CrawlSchema.parse(request.body);
      const actorSource = request.tenantCtx!.impersonation ? "STAFF_MANAGED_SETUP" : "CLIENT";
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;
      const knowledgeSourceId = randomUUID();

      const source = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.knowledgeSource.create({
          data: {
            id: knowledgeSourceId,
            tenantId: request.tenantCtx!.tenantId,
            agentId: body.agentId,
            type: "WEBSITE_CRAWL",
            status: "PENDING",
            sourceUrl: body.startUrls[0],
            addedBySource: actorSource,
            addedByUserId: actorUserId,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId: body.agentId,
          action: "website_crawled",
          contentSource: "website crawl",
          metadata: { startUrls: body.startUrls, knowledgeSourceId },
        });
        return created;
      });

      await ctx.queue.enqueue<KnowledgeIngestJob>(knowledgeIngestQueueTarget(), {
        tenantId: request.tenantCtx!.tenantId,
        agentId: body.agentId,
        knowledgeSourceId,
        kind: "WEBSITE_CRAWL",
        startUrls: body.startUrls,
      });

      reply.code(202).send(source);
    },
  );

  /** Manual FAQ entries. */
  app.post(
    "/v1/tenants/:tenantId/knowledge/faq",
    { preHandler: [...scoped, requirePermission("knowledge:write")] },
    async (request, reply) => {
      const body = FaqSchema.parse(request.body);
      const actorSource = request.tenantCtx!.impersonation ? "STAFF_MANAGED_SETUP" : "CLIENT";
      const actorUserId = request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub;
      const knowledgeSourceId = randomUUID();

      const source = await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const created = await tx.knowledgeSource.create({
          data: {
            id: knowledgeSourceId,
            tenantId: request.tenantCtx!.tenantId,
            agentId: body.agentId,
            type: "MANUAL_FAQ",
            status: "PENDING",
            addedBySource: actorSource,
            addedByUserId: actorUserId,
          },
        });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId,
          agentId: body.agentId,
          action: "faq_added",
          contentSource: actorSource === "STAFF_MANAGED_SETUP" ? "transcribed from onboarding call" : "client dashboard",
          metadata: { entryCount: body.entries.length, knowledgeSourceId },
        });
        return created;
      });

      await ctx.queue.enqueue<KnowledgeIngestJob>(knowledgeIngestQueueTarget(), {
        tenantId: request.tenantCtx!.tenantId,
        agentId: body.agentId,
        knowledgeSourceId,
        kind: "MANUAL_FAQ",
        faqEntries: body.entries,
      });

      reply.code(202).send(source);
    },
  );

  app.delete(
    "/v1/tenants/:tenantId/knowledge/:knowledgeSourceId",
    { preHandler: [...scoped, requirePermission("knowledge:delete")] },
    async (request, reply) => {
      const { knowledgeSourceId } = request.params as { knowledgeSourceId: string };
      await withTenant(ctx.prisma, request.tenantCtx!, async (tx) => {
        const source = await tx.knowledgeSource.findFirstOrThrow({
          where: { id: knowledgeSourceId, tenantId: request.tenantCtx!.tenantId },
        });
        if (source.s3Key) await ctx.objectStore.deleteObject(source.s3Key);
        await tx.knowledgeSource.delete({ where: { id: knowledgeSourceId } });
        await writeAuditLog(tx, request.tenantCtx!, {
          actorUserId: request.tenantCtx!.impersonation?.staffUserId ?? request.authUser!.sub,
          agentId: source.agentId,
          action: "document_deleted",
          metadata: { knowledgeSourceId },
        });
      });
      reply.code(204).send();
    },
  );
}
