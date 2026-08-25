import { z } from "zod";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  customerEmail: z.string().email(),
});
const OutputSchema = z.object({ ticketId: z.string(), ticketUrl: z.string().optional() });

export function createTicketingTool(config: {
  baseUrl: string;
  authHeaderName: string;
}): ToolHandler<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  return {
    category: "ticketing",
    name: "create_support_ticket",
    description: "Creates a support ticket in the tenant's connected helpdesk when the agent cannot resolve an issue directly.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "automatic",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      try {
        const resp = await fetch(new URL("/tickets", config.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { [config.authHeaderName]: token } : {}),
          },
          body: JSON.stringify(input),
        });
        const json = (await resp.json().catch(() => ({}))) as { id?: string; url?: string };
        return {
          succeeded: resp.ok && Boolean(json.id),
          output: { ticketId: json.id ?? "", ticketUrl: json.url },
          confirmedByProvider: resp.ok && Boolean(json.id),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `Ticketing provider returned HTTP ${resp.status}`,
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
