import { API_BASE } from "./api";

/**
 * Sends a dashboard crash to the API, which forwards it to Sentry
 * (apps/api/src/routes/clientErrors.routes.ts). Fire-and-forget: reporting
 * must never cause a second failure. Capped per page load so one broken
 * loop can't flood the endpoint; repeats of the same message are dropped.
 */
const MAX_REPORTS_PER_PAGE = 5;
let sent = 0;
const seen = new Set<string>();

export function reportError(error: unknown, kind: "render" | "unhandled" | "rejection", digest?: string): void {
  if (typeof window === "undefined") return;
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "Unknown error");
  const message = (err.message || "Unknown error").slice(0, 500);
  // Browser-extension noise and cancelled requests aren't our bugs.
  if (/ResizeObserver loop|chrome-extension:|moz-extension:|AbortError|Load failed|Failed to fetch/i.test(`${message} ${err.stack ?? ""}`)) return;
  if (sent >= MAX_REPORTS_PER_PAGE || seen.has(message)) return;
  sent += 1;
  seen.add(message);
  try {
    void fetch(`${API_BASE}/v1/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ message, stack: err.stack?.slice(0, 4000), path: window.location.pathname, digest, kind }),
    }).catch(() => undefined);
  } catch {
    // Never let reporting throw.
  }
}
