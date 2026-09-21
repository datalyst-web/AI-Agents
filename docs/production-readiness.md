# Production readiness

Last checked: 2026-09-18. This is an evidence-based launch tracker, not a
claim that the platform is ready for paying clients.

**Updated cost constraint:** the user rejects a Neon upgrade and wants
fewer providers and free options where feasible. The Neon screenshot
confirms its monthly compute allowance is exhausted. Follow the
[lower-cost hosting plan](low-cost-hosting.md): prepare Supabase Free as
the database replacement and consider consolidating dashboard hosting
onto the existing Railway account. Do not interpret the earlier database
restoration steps as approval to buy a Neon plan. Existing data must be
exported/restored before switching; the application is not yet migrated.

## Previous-session handover

The user supplied Claude Code's prior progress notes after this review.
Those notes report that production schema/RLS updates, the administrator
account, test-data cleanup, worker SMTP settings, CORS restriction, legal
page content, and browser-push configuration were already completed.
Treat these as historical reports to verify, not tasks to repeat blindly.
In particular, do not recreate the administrator or assume production is
empty: the notes corrected an earlier mistaken empty-database assessment.

Email remained broken at the end of that session. The user preferred
Google Workspace SMTP over Brevo, but postponed the Workspace setup when
account settings prevented two-step verification. They then authorized
temporarily disabling application email-code login with
`REQUIRE_TWO_FACTOR=false`. Preserve that intent while resolving email;
do not require fresh approval just to honor the already-authorized flag.
The current boolean-parser fix is necessary for that string to mean false.

The notes mention earlier transient Neon connection failures. This is
useful diagnostic context, but does not establish the cause of the current
failed live requests. Restore and verify the existing database; do not
replace it. The Cloudflare Proposal Agent errors in the pasted history
belong to a different project and are excluded from this launch.

## Active deployment

- Dashboard and widget: Vercel (`app.datalystafrica.com`).
- API and workers: Railway project `chat-agent-platform`, production environment.
- Database: Neon PostgreSQL. API uses the direct endpoint; the migration
  connection currently uses the corresponding pooled endpoint.
- Redis: Railway private network, with an attached persistent volume.
- Object storage: Cloudflare R2 through the S3-compatible adapter.
- Transactional email: Brevo SMTP.
- Payment integration in code: Paynow.

The AWS Terraform and older architecture documents describe an earlier
plan. Do not provision that stack as part of the current launch.

## Verified remotely

- [x] API `/healthz`, dashboard `/login`, and `/widget.js` return HTTP 200.
- [x] Railway API, workers, and Redis deployments report success.
- [x] Vercel has production variables for API/widget URLs, Google login,
  and Turnstile. Presence does not establish that the values are correct.
- [x] R2 bucket access succeeds using production API credentials (HEAD
  only; uploading, downloading, and deleting have not been exercised).
- [x] Workers were missing `CHANNEL_CREDENTIALS_ENCRYPTION_KEY`. Copied the
  existing API value securely to workers; subsequent deployment succeeded.
  End-to-end workflow credential decryption remains to be verified.

## Launch blockers and required evidence

1. **Database-backed API requests fail.** A read-only widget lookup for a
   nonexistent UUID returns HTTP 500; live API logs contain Prisma P1001.
   The Neon hostname resolves and TCP port 5432 is reachable from the
   workstation, but database queries fail on both direct and pooled
   hostnames, including a 20-second connection timeout. The underlying
   Neon compute/account status is not accessible in this session.
   Restore database connectivity,
   then verify schema, pgvector, application-role privileges, and RLS.
   The public `/healthz` endpoint currently proves only process liveness.
2. **Email authentication is rejected.** Brevo SMTP returns EAUTH / 535
   using the production API configuration. Verify the SMTP username and
   replace the SMTP key in both API and worker production settings. No
   messages were sent during diagnostics. After authentication works,
   verify actual delivery of login codes, invites, and password resets
   to an agreed test recipient.
3. **Billing is not configured in production.** API settings have no
   `PAYNOW_INTEGRATION_ID` or `PAYNOW_INTEGRATION_KEY`. Launch prices in
   `paynowBilling.routes.ts` are marked placeholders ($49/$149/$399).
   Obtain approved pricing and merchant configuration, then verify the
   payment lifecycle and webhook handling in the appropriate test flow.
4. **Meta channels are incomplete.** `META_WEBHOOK_VERIFY_TOKEN` exists,
   but `META_APP_SECRET` is absent. Complete platform configuration and
   each client's own account authorization for channels promised at launch.
5. **Database security and full integration tests are unverified.** Use a
   separate disposable test database. Do not point the test suite at client
   data or bypass the populated-database guard.
6. **Queue recovery needs hardening before reliability sign-off.** Redis
   delayed jobs and retries currently use process timers, and there is no
   recovery of a crashed worker's processing-list entries. Test and fix
   restart recovery without duplicating externally visible tool actions.
7. **Operations need verification.** Confirm backup restoration, error
   alert delivery, deployment rollback, dependency-aware readiness, worker
   monitoring, queue failure handling, and realistic load/latency.

## Local fixes awaiting release

- Light-default page rendering and explicit light theme on both production
  tenant-creation routes and demo seed. Existing saved choices are retained.
- Deployment stops if `DATABASE_MIGRATE_URL` is missing instead of silently
  skipping schema and RLS application.
- Environment booleans parse the literal strings `true` and `false`.
  Previously `false` became true. Thirteen isolated regression tests pass.
  **Release implication:** production currently sets `REQUIRE_TWO_FACTOR=false`;
  the corrected parser will honor it. Resolve email and agree the intended
  production authentication setting before releasing this change.

## Read-only connection diagnostics

Local validation completed: all workspace type checks pass, all 13
configuration regression tests pass, and the dashboard production build
passes with 34 static pages generated. Lint passes with one existing
hook-dependency warning in the agent details page. Full database-backed
tests and live client acceptance remain outstanding.

Run from the repository root with installed dependencies and a generated
Prisma client:

```sh
railway run --service api --environment production --no-local -- node infra/scripts/check-connections.mjs
```

The script checks database security metadata, queue counts, R2 bucket
access, and SMTP authentication. It does not fetch client records, mutate
data, send mail, or print credentials. It exits nonzero on failed checks.
Use `--only=database`, `--only=redis`, `--only=object`, or `--only=smtp`
to narrow a check. `--database-host=HOST` changes only the diagnostic
connection destination, never production configuration.

Railway's private Redis hostname is unreachable from a local workstation;
run that check within Railway before treating it as a service outage.
Container diagnostics require Railway SSH access, which is not currently
configured on this workstation.

## Client acceptance gate

After infrastructure is healthy, onboard one pilot through the normal
managed-setup path: create account, ingest approved materials, configure
only agreed integrations, test a complete conversation and action, obtain
client approval, publish, and verify the embed on the client's site.
Deliver agreed prices/limits, branding, installation instructions, support
contact, and onboarding material before rolling out to remaining clients.
