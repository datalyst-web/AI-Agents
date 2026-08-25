import "fastify";
import type { TenantContext } from "@chat-agent/shared-types";

declare module "fastify" {
  interface FastifyRequest {
    tenantCtx?: TenantContext;
    /**
     * The exact raw request bytes, captured only on routes that register
     * the raw-body-capturing content type parser (currently just the
     * billing webhook — see routes/billing.routes.ts). HMAC/webhook
     * signature verification must run against these bytes, never a
     * re-serialization of the parsed body.
     */
    rawBody?: Buffer;
  }
}
