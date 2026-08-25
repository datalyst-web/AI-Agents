import { z } from "zod";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
});
const OutputSchema = z.object({
  statusCode: z.number(),
  body: z.unknown(),
});

/**
 * Generic outbound webhook — the escape hatch for any integration that
 * doesn't have a dedicated adapter yet. The target URL and headers live in
 * the tenant's ToolDefinition config (resolved via credentialRef, never
 * inlined in a prompt or in code), not here.
 */
export function createWebhookTool(config: { url: string; headers?: Record<string, string> }): ToolHandler<
  z.infer<typeof InputSchema>,
  z.infer<typeof OutputSchema>
> {
  return {
    category: "webhook",
    name: "call_webhook",
    description: "Sends a JSON payload to a pre-configured external webhook URL for this tenant.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "confirmation_required",
    async execute(input, _ctx, _deps) {
      const started = Date.now();
      try {
        const resp = await fetch(config.url, {
          method: "POST",
          headers: { "content-type": "application/json", ...(config.headers ?? {}) },
          body: JSON.stringify(input.payload),
        });
        const body = await resp.json().catch(() => undefined);
        return {
          succeeded: resp.ok,
          output: { statusCode: resp.status, body },
          confirmedByProvider: resp.ok,
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `Webhook returned HTTP ${resp.status}`,
        };
      } catch (err) {
        return {
          succeeded: false,
          errorMessage: err instanceof Error ? err.message : String(err),
          confirmedByProvider: false,
          durationMs: Date.now() - started,
        };
      }
    },
  };
}
