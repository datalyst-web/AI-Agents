# Lower-cost hosting and migration

User direction: minimize recurring costs and providers; prefer free tiers
where practical. Do not upgrade Neon. Supabase Free is the proposed database
replacement, subject to capacity and restore verification. Nothing in this
document means a migration has already happened.

## Consolidation decisions

| Service | Decision | Remaining cost or work |
| --- | --- | --- |
| Neon | Replace with Supabase PostgreSQL after verified export/restore | Source currently cannot be queried; user screenshot confirms monthly compute allowance exhausted |
| Supabase | Use PostgreSQL and pgvector only initially | Free includes 500 MB database; no automatic backups; inactive projects can pause after a week |
| Railway | Keep API, workers, Redis; prepare dashboard hosting here | Existing usage-based bill remains; dashboard adds usage, so compare actual cost before switching |
| Vercel | Candidate for retirement after Railway dashboard validation | Hobby is non-commercial; do not assume free commercial hosting |
| Cloudflare R2 | Keep existing working file storage during database migration | Verify actual usage/bill; relocating documents is a separate migration |
| Cloudflare Turnstile | Keep existing login protection | Not a separate app host; avoid removing it just to reduce provider count |
| Google Workspace | User's preferred email provider | Existing mailbox subscription, SMTP setup unfinished; not a newly free service |
| Brevo | Retire this app's SMTP connection once replacement email passes | Do not delete unrelated account resources or DNS records |
| Sentry | Keep existing error reporting pending plan/usage review | No additional paid plan approved |
| Twilio, Meta, Paynow | Enable only for agreed client requirements | No new account/subscription needed for the website-chat pilot unless promised |
| AI providers | Retain current abstraction and existing credentials | Model usage is a separate cost; no promise of unlimited free production AI |

Supabase replaces a database host, not the long-running Fastify API and
worker processes. Free database limits must be checked against documents,
embeddings, conversations, and growth before client launch. There is no
verified all-free production configuration for this application yet.

## Database migration gate

1. Create or identify a Supabase Free project. Record its region, database
   version, and connection options. Keep the existing application login
   system; do not recreate users in Supabase Auth.
2. Obtain a source export when Neon is accessible again, or locate and
   validate an existing backup. Do not upgrade the account without user
   approval, and do not replace existing client data with an empty database.
   If quota exhaustion prevents export, migration remains blocked until
   access resets or Neon provides a recovery route.
3. Inspect source database size and PostgreSQL/pgvector versions. Confirm
   the target can accommodate the full data and indexes within free limits.
4. Prepare the private `chat` schema. This app explicitly casts embeddings
   to `chat.vector`; install pgvector into `chat` before restoring. If the
   extension already lives elsewhere, stop and assess dependencies instead
   of dropping/moving it blindly. Preserve pgcrypto as required by the schema.
5. Create a dedicated `chat_app_user` with LOGIN and NOBYPASSRLS, separate
   from the schema-owner/migration connection. Do not use the BYPASSRLS role
   from Supabase's generic Prisma quickstart as this application's runtime
   user. Set its search path to `chat, public` and grant only required rights.
6. Restore the `chat` schema/data using PostgreSQL dump/restore tooling with
   ownership/ACL handling reviewed for the target. Do not overwrite Supabase's
   internal schemas. Reapply this repository's RLS policies and vector indexes.
7. Preserve tenant/agent IDs, user password hashes, stored document keys,
   encrypted integration credentials, and the existing encryption key.
   Compare per-table row counts and verify tenant isolation on the target.
8. For Railway's persistent services, start with Supabase's session pooler
   on port 5432 (IPv4 compatible) or a verified reachable direct connection.
   Use `schema=chat` and TLS for Prisma. Keep the SQL tooling URL free of
   Prisma-only query parameters. Limit connection pools for the free database.
9. Verify the target application role with the read-only connection checker,
   then run login, knowledge retrieval, workflow, and cross-tenant checks
   against an isolated test environment. A successful SELECT alone is not
   enough. Configure and prove a backup/restore procedure before client launch.
10. Stop source writes during the final export/cutover. Update API and workers
    together, and update the migration connection. Verify live workflows.
    Keep the source/export until acceptance. After target writes begin,
    rollback requires reconciling those writes; simply restoring old URLs
    would lose new records.

No Supabase project credentials or source export are available in this
session, so source/target provisioning and restoration remain outstanding.

## Optional dashboard consolidation

The dashboard Dockerfile now includes its widget build input, root build
configuration, all four public build variables, and a working Next.js start
command that honors Railway's PORT. Turbo forwards and hashes public build
variables so a cached build cannot silently reuse another API endpoint.

Before cutover:

1. Build and run the container (Docker is unavailable on the current machine).
2. Provision a `dashboard` service in the existing Railway project using
   `apps/dashboard/Dockerfile`, with repository root as build context.
3. Copy the verified Vercel public settings into Railway build variables:
   `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_WIDGET_SCRIPT_URL`,
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
4. Test using the temporary Railway domain, accounting for OAuth/CAPTCHA
   authorized origins. Keep `app.datalystafrica.com` as the eventual public
   origin and verify the widget bundle is served there.
5. Compare observed dashboard usage with the current Vercel bill. Only then
   move DNS and set GitHub repository variable `DASHBOARD_HOST=railway`.
   The existing workflow remains on Vercel until this variable is set.
6. Retire this project's Vercel deployment only after the Railway version
   passes checks. Do not cancel subscriptions used by other projects.

## Sources checked 2026-09-18

- [Supabase limits and pricing](https://supabase.com/pricing)
- [Supabase Prisma connections](https://supabase.com/docs/guides/database/prisma)
- [Supabase pgvector support](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Neon-to-Supabase migration](https://supabase.com/docs/guides/platform/migrating-to-supabase/neon)
- [Railway pricing](https://docs.railway.com/pricing)
- [Vercel Hobby limitations](https://vercel.com/docs/plans/hobby)
