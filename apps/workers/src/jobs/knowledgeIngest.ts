import { withTenant } from "@chat-agent/db";
import { extractByType, extractManualFaq, crawlPages, ingestDocument } from "@chat-agent/rag";
import type { KnowledgeIngestJob } from "@chat-agent/shared-types";
import type { WorkerContext } from "../context.js";

const EMBEDDING_MODEL = "text-embedding-3-small";

/**
 * Document Processing -> ... -> Vector Database, run for one
 * KnowledgeSource. Mirrors the pipeline diagram in CLAUDE.md's Knowledge
 * Base section end to end: extract -> chunk -> embed -> store, then flips
 * the source to READY (or FAILED with a stored error, never left stuck in
 * a processing state with no explanation).
 */
export async function runKnowledgeIngestJob(ctx: WorkerContext, job: KnowledgeIngestJob): Promise<void> {
  await withTenant(ctx.prisma, { tenantId: job.tenantId, agentId: job.agentId }, async (tx) => {
    await tx.knowledgeSource.update({ where: { id: job.knowledgeSourceId }, data: { status: "EXTRACTING" } });
  });

  try {
    const documents = await extractDocuments(ctx, job);
    // A source that extracted nothing is not "ready" — it just means
    // nothing is searchable yet, which looks identical to success from
    // the tenant's side unless this is flagged explicitly. Found live:
    // a WEBSITE_CRAWL source sat at READY with zero documents/chunks in
    // the DB, meaning the agent had been answering with no real
    // knowledge behind it despite the dashboard showing it as ready.
    if (documents.length === 0) {
      throw new Error(
        job.kind === "WEBSITE_CRAWL"
          ? "The crawl completed but found no readable pages — the site may be blocking automated requests, or the URL may not resolve to a normal HTML page."
          : "No content could be extracted from this source.",
      );
    }

    await withTenant(ctx.prisma, { tenantId: job.tenantId, agentId: job.agentId }, async (tx) => {
      await tx.knowledgeSource.update({ where: { id: job.knowledgeSourceId }, data: { status: "EMBEDDING" } });

      for (const doc of documents) {
        await ingestDocument(tx, ctx.router, {
          tenantId: job.tenantId,
          agentId: job.agentId,
          knowledgeSourceId: job.knowledgeSourceId,
          document: doc,
          embeddingModel: EMBEDDING_MODEL,
        });
      }

      await tx.knowledgeSource.update({ where: { id: job.knowledgeSourceId }, data: { status: "READY" } });
    });
  } catch (err) {
    await withTenant(ctx.prisma, { tenantId: job.tenantId, agentId: job.agentId }, (tx) =>
      tx.knowledgeSource.update({
        where: { id: job.knowledgeSourceId },
        data: { status: "FAILED", errorMessage: err instanceof Error ? err.message : String(err) },
      }),
    );
    throw err; // let the queue's retry/redelivery semantics apply
  }
}

async function extractDocuments(ctx: WorkerContext, job: KnowledgeIngestJob) {
  switch (job.kind) {
    case "FILE": {
      if (!job.s3Key || !job.fileType) throw new Error("FILE ingest job missing s3Key/fileType.");
      const buffer = await ctx.objectStore.getObject(job.s3Key);
      return [await extractByType(job.fileType, buffer, job.originalFilename ?? job.s3Key)];
    }
    case "WEBSITE_CRAWL": {
      if (!job.startUrls?.length) throw new Error("WEBSITE_CRAWL job missing startUrls.");
      const pages = await crawlPages(job.startUrls, { maxPages: 50 });
      return pages.map((p) => ({ title: p.title, text: p.text }));
    }
    case "MANUAL_FAQ": {
      if (!job.faqEntries?.length) throw new Error("MANUAL_FAQ job missing faqEntries.");
      return [extractManualFaq(job.faqEntries)];
    }
  }
}
