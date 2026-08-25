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

/**
 * Booking is confirmation-gated (read the time back to the customer first,
 * per CLAUDE.md principle 4); cancellation is explicitly called out in
 * CLAUDE.md as never-auto-execute.
 */
export function createCalendarBookTool(config: {
  baseUrl: string;
  authHeaderName: string;
}): ToolHandler<z.infer<typeof BookInputSchema>, z.infer<typeof BookOutputSchema>> {
  return {
    category: "calendar",
    name: "book_appointment",
    description: "Books an appointment on the tenant's connected calendar.",
    inputSchema: BookInputSchema,
    outputSchema: BookOutputSchema,
    defaultExecutionTier: "confirmation_required",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      try {
        const resp = await fetch(new URL("/bookings", config.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { [config.authHeaderName]: token } : {}),
          },
          body: JSON.stringify(input),
        });
        const json = (await resp.json().catch(() => ({}))) as { id?: string; startTime?: string };
        return {
          succeeded: resp.ok && Boolean(json.id),
          output: { bookingId: json.id ?? "", confirmedStartTimeIso: json.startTime ?? input.startTimeIso },
          confirmedByProvider: resp.ok && Boolean(json.id),
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `Calendar provider returned HTTP ${resp.status}`,
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

export function createCalendarCancelTool(config: {
  baseUrl: string;
  authHeaderName: string;
}): ToolHandler<z.infer<typeof CancelInputSchema>, z.infer<typeof CancelOutputSchema>> {
  return {
    category: "calendar",
    name: "cancel_appointment",
    description: "Cancels an existing appointment on the tenant's connected calendar.",
    inputSchema: CancelInputSchema,
    outputSchema: CancelOutputSchema,
    // Never auto-executed, per CLAUDE.md principle 5 — always confirmed with the customer first.
    defaultExecutionTier: "confirmation_required",
    async execute(input, _ctx, deps) {
      const started = Date.now();
      const token = deps.credentialRef ? await deps.secrets.getSecret(deps.credentialRef) : undefined;
      try {
        const resp = await fetch(new URL(`/bookings/${input.bookingId}`, config.baseUrl), {
          method: "DELETE",
          headers: token ? { [config.authHeaderName]: token } : {},
        });
        return {
          succeeded: resp.ok,
          output: { cancelled: resp.ok },
          confirmedByProvider: resp.ok,
          durationMs: Date.now() - started,
          errorMessage: resp.ok ? undefined : `Calendar provider returned HTTP ${resp.status}`,
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
