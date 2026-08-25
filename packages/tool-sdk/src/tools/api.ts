import { z } from "zod";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  path: z.string().describe("Path appended to the configured base URL, e.g. /v1/orders/123"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  body: z.record(z.string(), z.unknown()).optional(),
});
const OutputSchema = z.object({
  statusCode: z.number(),
  body: z.unknown(),
});

/**
 * Generic authenticated REST call against a tenant-configured "trusted
 * external API" (CLAUDE.md's RAG source list also calls these out). Auth
 * header is resolved from packages/secrets via credentialRef — never
 * visible to the model or logged in plaintext.
 */
export function createApiTool(config: {
  baseUrl: string;
  authHeaderName: string;
  allowedMethods?: ("GET" | "POST" | "PUT" | "PATCH" | "DELETE")[];
}): ToolHandler<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  return {
    category: "api",
    name: "call_external_api",
    description: "Calls a pre-configured, trusted external API on behalf of the tenant.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "automatic",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      if (config.allowedMethods && !config.allowedMethods.includes(input.method)) {
        return {
          succeeded: false,
          errorMessage: `Method ${input.method} is not allowed for this API tool.`,
          confirmedByProvider: false,
          durationMs: Date.now() - started,
        };
      }
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      try {
        const resp = await fetch(new URL(input.path, config.baseUrl), {
          method: input.method,
          headers: {
            "content-type": "application/json",
            ...(token ? { [config.authHeaderName]: token } : {}),
          },
          body: input.body ? JSON.stringify(input.body) : undefined,
        });
        const body = await resp.json().catch(() => undefined);
        return {
          succeeded: resp.ok,
          output: { statusCode: resp.status, body },
          confirmedByProvider: resp.ok,
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `API returned HTTP ${resp.status}`,
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
