import * as Sentry from "@sentry/node";
import { env } from "./env.js";

/**
 * Must be imported FIRST in main.ts, before any other module — see
 * apps/api/src/instrument.ts's identical comment for why. Workers has no
 * HTTP framework to hook into (unlike the API's
 * Sentry.setupFastifyErrorHandler), but Sentry.init() alone still catches
 * genuinely uncaught exceptions/rejections globally; main.ts additionally
 * calls Sentry.captureException explicitly at each of its own catch sites
 * (the two periodic sweeps, and each queue job handler) so that already-
 * caught-and-logged failures — which is most of what actually goes wrong
 * here, per packages/queue's retry/dead-letter design — show up in Sentry
 * too, not just Railway's logs.
 */
if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0,
  });
}
