import { z } from "zod";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  objectType: z.enum(["lead", "contact", "deal"]),
  fields: z.record(z.string(), z.unknown()),
});
const OutputSchema = z.object({ recordId: z.string() });

const HUBSPOT_API = "https://api.hubapi.com";
// HubSpot has no separate "lead" object out of the box (leads are just
// contacts, optionally distinguished by a lifecycle-stage property) — so
// "lead" and "contact" both create a contact record, matching how HubSpot
// itself models this.
const OBJECT_PATH: Record<string, string> = { lead: "contacts", contact: "contacts", deal: "deals" };

/**
 * HubSpot CRM, connected via a Private App access token (HubSpot's
 * recommended single-account integration method — no OAuth app review
 * needed, unlike a public HubSpot App). Scopes required on the private
 * app: crm.objects.contacts.write, crm.objects.deals.write.
 */
export function createHubspotCrmTool(): ToolHandler<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  return {
    category: "crm",
    name: "create_crm_record",
    description: "Creates a lead, contact, or deal record in the tenant's connected HubSpot CRM.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "automatic",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      if (!token) {
        return { succeeded: false, errorMessage: "HubSpot is not connected.", confirmedByProvider: false, durationMs: Date.now() - started };
      }
      try {
        const resp = await fetch(`${HUBSPOT_API}/crm/v3/objects/${OBJECT_PATH[input.objectType]}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ properties: input.fields }),
        });
        const json = (await resp.json().catch(() => ({}))) as { id?: string; message?: string };
        return {
          succeeded: resp.ok && Boolean(json.id),
          output: json.id ? { recordId: json.id } : undefined,
          confirmedByProvider: resp.ok && Boolean(json.id),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : (json.message ?? `HubSpot returned HTTP ${resp.status}`),
        };
      } catch (err) {
        return { succeeded: false, errorMessage: err instanceof Error ? err.message : String(err), confirmedByProvider: false, durationMs: Date.now() - started };
      }
    },
  };
}
