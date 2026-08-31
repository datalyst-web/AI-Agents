import { z } from "zod";
import type { ToolHandler } from "../types.js";

const BookInputSchema = z.object({
  startTimeIso: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(480),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  notes: z.string().optional(),
});
const BookOutputSchema = z.object({ bookingId: z.string(), confirmedStartTimeIso: z.string() });

const CancelInputSchema = z.object({ bookingId: z.string() });
const CancelOutputSchema = z.object({ cancelled: z.boolean() });

/** Credential stored via SecretsProvider as JSON — just the refresh token; a fresh access token is minted on every call rather than cached, avoiding any write-back/expiry-tracking complexity. */
export interface GoogleCalendarCredential {
  refreshToken: string;
}

interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  /** "primary" for the connected account's own calendar, or a specific calendar id. */
  calendarId: string;
}

async function getAccessToken(config: GoogleCalendarConfig, refreshToken: string): Promise<string> {
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const json = (await resp.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!resp.ok || !json.access_token) throw new Error(json.error_description ?? "Google Calendar token refresh failed — the connection may need to be re-authorized.");
  return json.access_token;
}

function parseCredential(raw: string | undefined): GoogleCalendarCredential | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<GoogleCalendarCredential>;
    return parsed.refreshToken ? { refreshToken: parsed.refreshToken } : undefined;
  } catch {
    return undefined;
  }
}

export function createGoogleCalendarBookTool(config: GoogleCalendarConfig): ToolHandler<z.infer<typeof BookInputSchema>, z.infer<typeof BookOutputSchema>> {
  return {
    category: "calendar",
    name: "book_appointment",
    description: "Books an appointment on the tenant's connected Google Calendar.",
    inputSchema: BookInputSchema,
    outputSchema: BookOutputSchema,
    defaultExecutionTier: "confirmation_required",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const credential = parseCredential(deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined);
      if (!credential) {
        return { succeeded: false, errorMessage: "Google Calendar is not connected.", confirmedByProvider: false, durationMs: Date.now() - started };
      }
      try {
        const accessToken = await getAccessToken(config, credential.refreshToken);
        const endTimeIso = new Date(new Date(input.startTimeIso).getTime() + input.durationMinutes * 60_000).toISOString();
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events`,
          {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              summary: `Appointment with ${input.customerName}`,
              description: input.notes,
              start: { dateTime: input.startTimeIso },
              end: { dateTime: endTimeIso },
              attendees: [{ email: input.customerEmail }],
            }),
          },
        );
        const json = (await resp.json().catch(() => ({}))) as { id?: string; start?: { dateTime?: string }; error?: { message?: string } };
        return {
          succeeded: resp.ok && Boolean(json.id),
          output: json.id ? { bookingId: json.id, confirmedStartTimeIso: json.start?.dateTime ?? input.startTimeIso } : undefined,
          confirmedByProvider: resp.ok && Boolean(json.id),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : (json.error?.message ?? `Google Calendar returned HTTP ${resp.status}`),
        };
      } catch (err) {
        return { succeeded: false, errorMessage: err instanceof Error ? err.message : String(err), confirmedByProvider: false, durationMs: Date.now() - started };
      }
    },
  };
}

export function createGoogleCalendarCancelTool(config: GoogleCalendarConfig): ToolHandler<z.infer<typeof CancelInputSchema>, z.infer<typeof CancelOutputSchema>> {
  return {
    category: "calendar",
    name: "cancel_appointment",
    description: "Cancels an existing appointment on the tenant's connected Google Calendar.",
    inputSchema: CancelInputSchema,
    outputSchema: CancelOutputSchema,
    // Never auto-executed, per CLAUDE.md principle 5 — always confirmed with the customer first.
    defaultExecutionTier: "confirmation_required",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const credential = parseCredential(deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined);
      if (!credential) {
        return { succeeded: false, errorMessage: "Google Calendar is not connected.", confirmedByProvider: false, durationMs: Date.now() - started };
      }
      try {
        const accessToken = await getAccessToken(config, credential.refreshToken);
        const resp = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events/${encodeURIComponent(input.bookingId)}`,
          { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } },
        );
        // Google returns 410 Gone for an already-deleted event — treat as a successful cancellation, not a failure.
        const ok = resp.ok || resp.status === 410;
        return {
          succeeded: ok,
          output: { cancelled: ok },
          confirmedByProvider: ok,
          durationMs: Date.now() - started,
          errorMessage: ok ? undefined : `Google Calendar returned HTTP ${resp.status}`,
        };
      } catch (err) {
        return { succeeded: false, errorMessage: err instanceof Error ? err.message : String(err), confirmedByProvider: false, durationMs: Date.now() - started };
      }
    },
  };
}
