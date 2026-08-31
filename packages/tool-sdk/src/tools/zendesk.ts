import { z } from "zod";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  customerEmail: z.string().email(),
  customerName: z.string().optional(),
});
const OutputSchema = z.object({ ticketId: z.string(), ticketUrl: z.string() });

/** Credential stored via SecretsProvider as JSON — Zendesk auths with `{email}/token:{apiToken}` Basic auth, not a single bearer token. */
export interface ZendeskCredential {
  email: string;
  apiToken: string;
}

export function createZendeskTicketingTool(config: { subdomain: string }): ToolHandler<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  const baseUrl = `https://${config.subdomain}.zendesk.com/api/v2`;
  return {
    category: "ticketing",
    name: "create_support_ticket",
    description: "Creates a support ticket in the tenant's connected Zendesk when the agent cannot resolve an issue directly.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "automatic",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const raw = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      const credential = parseCredential(raw);
      if (!credential) {
        return { succeeded: false, errorMessage: "Zendesk is not connected.", confirmedByProvider: false, durationMs: Date.now() - started };
      }
      try {
        const basicAuth = Buffer.from(`${credential.email}/token:${credential.apiToken}`).toString("base64");
        const resp = await fetch(`${baseUrl}/tickets.json`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Basic ${basicAuth}` },
          body: JSON.stringify({
            ticket: {
              subject: input.subject,
              comment: { body: input.description },
              priority: input.priority,
              requester: { name: input.customerName ?? input.customerEmail, email: input.customerEmail },
            },
          }),
        });
        const json = (await resp.json().catch(() => ({}))) as { ticket?: { id?: number }; error?: string; description?: string };
        const ticketId = json.ticket?.id;
        return {
          succeeded: resp.ok && Boolean(ticketId),
          output: ticketId
            ? { ticketId: String(ticketId), ticketUrl: `https://${config.subdomain}.zendesk.com/agent/tickets/${ticketId}` }
            : undefined,
          confirmedByProvider: resp.ok && Boolean(ticketId),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : (json.description ?? json.error ?? `Zendesk returned HTTP ${resp.status}`),
        };
      } catch (err) {
        return { succeeded: false, errorMessage: err instanceof Error ? err.message : String(err), confirmedByProvider: false, durationMs: Date.now() - started };
      }
    },
  };
}

function parseCredential(raw: string | undefined): ZendeskCredential | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<ZendeskCredential>;
    return parsed.email && parsed.apiToken ? { email: parsed.email, apiToken: parsed.apiToken } : undefined;
  } catch {
    return undefined;
  }
}
