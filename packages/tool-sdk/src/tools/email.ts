import { z } from "zod";
import type { ToolHandler } from "../types.js";

const InputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1),
});
const OutputSchema = z.object({ messageId: z.string() });

/**
 * Sends transactional email through a tenant-configured provider (SES,
 * SendGrid, Postmark, ...) reached over its HTTP API — credentials
 * resolved via credentialRef. Confirmation-gated by default per CLAUDE.md
 * ("sending important emails" is explicitly listed as confirmation-tier).
 */
export function createEmailTool(config: {
  sendUrl: string;
  authHeaderName: string;
  fromAddress: string;
}): ToolHandler<z.infer<typeof InputSchema>, z.infer<typeof OutputSchema>> {
  return {
    category: "email",
    name: "send_email",
    description: "Sends an email to the customer or a configured internal recipient.",
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    defaultExecutionTier: "confirmation_required",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      if (!token) {
        return {
          succeeded: false,
          errorMessage: "Email provider credential not configured for this tenant.",
          confirmedByProvider: false,
          durationMs: Date.now() - started,
        };
      }
      try {
        const resp = await fetch(config.sendUrl, {
          method: "POST",
          headers: { "content-type": "application/json", [config.authHeaderName]: token },
          body: JSON.stringify({
            from: config.fromAddress,
            to: input.to,
            subject: input.subject,
            text: input.body,
          }),
        });
        const json = (await resp.json().catch(() => ({}))) as { id?: string };
        return {
          succeeded: resp.ok,
          output: { messageId: json.id ?? "" },
          confirmedByProvider: resp.ok && Boolean(json.id),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `Email provider returned HTTP ${resp.status}`,
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
