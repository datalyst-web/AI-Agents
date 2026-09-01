import * as Sentry from "@sentry/node";
import { env } from "./env.js";

/**
 * Must be imported FIRST in server.ts, before any other module — Sentry's
 * Node SDK auto-instruments built-ins/libraries (http, pg, fastify, ...)
 * by patching them at require/import time, which only works for modules
 * imported after Sentry itself has initialized. Optional: local dev/CI
 * never needs a Sentry account (see SENTRY_DSN in packages/config).
 */
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // Full request tracing isn't worth the overhead for this service yet —
    // errors are what's missing today (CLAUDE.md gap: failures only ever
    // lived in Railway logs). Revisit if/when performance tracing itself
    // becomes something worth paying for.
    tracesSampleRate: 0,
  });
}
