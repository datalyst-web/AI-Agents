import * as Sentry from "@sentry/node";
import { z } from "zod";
import type { FastifyInstance } from "fastify";

/**
 * Crash reports from the dashboard, forwarded to Sentry alongside the API's
 * own errors — so a page breaking for a client doesn't go unnoticed. The
 * dashboard has no Sentry SDK of its own; one small endpoint here avoids
 * shipping it to every browser.
 *
 * Unauthenticated on purpose (a crash can happen before sign-in), so it is
 * tightly rate-limited, size-capped, and accepts only the error itself —
 * never user, tenant or customer data.
 */
const ClientErrorSchema = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(4000).optional(),
  path: z.string().max(300).optional(),
  digest: z.string().max(100).optional(),
  kind: z.enum(["render", "unhandled", "rejection"]).default("unhandled"),
});

export async function registerClientErrorRoutes(app: FastifyInstance) {
  app.post("/v1/client-errors", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = ClientErrorSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_request" });
      return;
    }
    const e = parsed.data;
    // Ids in a path ("/agents/<uuid>") say nothing about who; query strings might.
    const path = e.path?.split("?")[0];
    Sentry.withScope((scope) => {
      scope.setTag("source", "dashboard");
      scope.setTag("kind", e.kind);
      if (path) scope.setTag("path", path);
      if (e.digest) scope.setTag("digest", e.digest);
      if (e.stack) scope.setExtra("stack", e.stack);
      Sentry.captureMessage(`[dashboard] ${e.message}`, "error");
    });
    request.log.warn({ path, kind: e.kind, message: e.message.slice(0, 200) }, "dashboard client error");
    reply.code(204).send();
  });
}
