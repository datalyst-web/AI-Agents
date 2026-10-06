# Production readiness

Last checked: 2026-10-06. Evidence-based: each item says how it was verified.
Hosting and operating rules live in CLAUDE.md ("Hosting & operations"); this
file tracks what is proven working and what still blocks paying clients.

## Live stack

All in one Railway project (Hobby, EU West): `api`, `workers`, `dashboard`,
Postgres 18 + pgvector, Redis. Cloudflare R2 (files, backups), Cloudflare
Turnstile, Gmail API for email, Sentry, HostGator DNS. Neon, Vercel and Brevo
are retired.

Deploys: push to `main` → CI (unit + DB-backed suites on Postgres 18 and
Redis) → schema/RLS applied → `api`/`workers` and `dashboard` deployed. A red
CI never deploys.

## Verified working

- [x] **Core services.** `api` `/healthz`, dashboard, `/widget.js` all 200;
  DB-backed requests answer correctly (unknown widget agent → 404, not 500).
- [x] **Database backups.** `db-backup.yml` succeeds daily, including a real
  restore with row-count and RLS checks (last five runs green).
- [x] **Email.** Gmail API; sign-in codes (`REQUIRE_TWO_FACTOR=true`), signup
  codes and onboarding emails delivered.
- [x] **Free-trial onboarding.** Signup → email code → questionnaire; both
  live submissions on 2026-10-06 saved (200) with no email errors logged.
- [x] **AI answers.** OpenAI `gpt-5-mini` with Gemini failover. Datalyst Demo
  agent smoke-tested 2026-10-06: ~3–4 s replies, 31–48 words, one question
  each; refused to invent a ZiG answer, a VAT-inclusive quote or a booking, and
  refused to name its model under a prompt-injection attempt.
- [x] **Paynow — ZiG.** Integration 27240 (ZWG). Test payment confirmed end
  to end: correct ZiG amount, payment marked PAID, plan activated.
- [x] **Paynow confirmation fallback.** A pending payment is also confirmed by
  polling Paynow's pollUrl (hash-verified, per currency) — added after the
  first test's result-URL call never arrived.
- [x] **Queue restart safety.** Delays/retries live in Redis; a dead worker's
  in-flight jobs are requeued; workers drain on SIGTERM. Covered by
  `packages/queue/src/redis.test.ts` in CI.
- [x] **Paid-period expiry.** 30 days per payment, reminders, 3-day grace,
  then suspension — `subscriptionRenewalSweep.test.ts` passes in CI against
  the real RLS role.

## Open before taking real money

1. **Paynow USD.** Integration 27237 processes in ZWG (test 64112020 showed
   `ZWG29.00`). Waiting on Paynow support to enable USD and set 27237 to USD;
   then one USD test must show `USD29.00`.
2. **Rotate Paynow keys.** Both integration keys were shared in a chat.
   Generate new keys for 27237 and 27240, update `PAYNOW_INTEGRATION_KEY` and
   `PAYNOW_ZWG_INTEGRATION_KEY` on `api`, then ask Paynow to set both Live.
3. **Remove test data.** Cancel, then permanently delete, the `Paynow Test`
   client in Managed Setup.
4. **Demo agent knowledge.** Add the ZiG option and prices (ZiG 1,160 /
   3,560 / 9,960) so it can answer ZiG questions.

## Open — channels

5. **Meta (WhatsApp, Messenger, Instagram).** `META_APP_SECRET` and
   `META_WEBHOOK_VERIFY_TOKEN` are set on `api`. The Meta app is in
   Development mode, so it only works for its own admins' pages. Needs Meta
   business verification and app review — see `meta-app-review.md`.

## Known limits, accepted for now

- **No Anthropic key.** The router skips Anthropic; failover is
  OpenAI → Gemini.
- **Workflow builder makes single-action workflows.** The engine supports
  chains (including a real `WAIT`), but only through the API.
- **Logs only reach back to the last restart** on Railway Hobby; Sentry holds
  errors beyond that.
- **Unknown caller.** ~180 `POST /api/opportunities` calls a day reach `api`
  via Cloudflare (404) — likely another project pointed at the wrong host.
  Harmless; worth tracing.

## Health check

```sh
railway run --service api -- node infra/scripts/check-connections.mjs
```

Verifies database isolation, storage, email consent and AI keys without side
effects. From a laptop add `--database-host=<proxy host:port> --skip=redis`.
