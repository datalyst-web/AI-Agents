import { z } from "zod";
import type { ToolHandler } from "../types.js";

const CreateRecordInputSchema = z.object({
  objectType: z.enum(["lead", "contact", "deal"]),
  fields: z.record(z.string(), z.unknown()),
});
const CreateRecordOutputSchema = z.object({ recordId: z.string() });

/**
 * Generic CRM adapter shape — REST-based create, matching the common
 * HubSpot/Salesforce/Pipedrive pattern (POST to an object-type endpoint
 * with a bearer token). Vendor-specific field mapping lives in the
 * tenant's ToolDefinition config, not in code, per CLAUDE.md's
 * "knowledge-driven, not hard-coded" principle applied to integrations.
 */
export function createCrmCreateRecordTool(config: {
  baseUrl: string;
  authHeaderName: string;
  objectTypeToPath: Record<string, string>;
}): ToolHandler<z.infer<typeof CreateRecordInputSchema>, z.infer<typeof CreateRecordOutputSchema>> {
  return {
    category: "crm",
    name: "create_crm_record",
    description: "Creates a lead, contact, or deal record in the tenant's connected CRM.",
    inputSchema: CreateRecordInputSchema,
    outputSchema: CreateRecordOutputSchema,
    defaultExecutionTier: "automatic",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const path = config.objectTypeToPath[input.objectType];
      if (!path) {
        return {
          succeeded: false,
          errorMessage: `CRM is not configured for object type "${input.objectType}".`,
          confirmedByProvider: false,
          durationMs: Date.now() - started,
        };
      }
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      try {
        const resp = await fetch(new URL(path, config.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { [config.authHeaderName]: token } : {}),
          },
          body: JSON.stringify(input.fields),
        });
        const json = (await resp.json().catch(() => ({}))) as { id?: string };
        return {
          succeeded: resp.ok && Boolean(json.id),
          output: { recordId: json.id ?? "" },
          confirmedByProvider: resp.ok && Boolean(json.id),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `CRM returned HTTP ${resp.status}`,
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
