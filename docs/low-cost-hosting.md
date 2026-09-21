# Low-cost hosting

User direction: minimise recurring costs and the number of providers, while
keeping full multi-tenant isolation (which lives in PostgreSQL row-level
security, so the database must stay PostgreSQL).

## Where everything runs (as of 2026-09-21)

| Service | Role | Cost |
| --- | --- | --- |
| Railway (Hobby) | `api`, `workers`, `dashboard`, `Redis`, `Postgres` — one project, one bill | $5/month plan, includes $5 of usage; usage beyond that is billed |
| Cloudflare R2 | Uploaded knowledge-base files | Free tier; verify usage periodically |
| Cloudflare Turnstile | Login/signup bot protection | Free |
| HostGator | DNS for datalystafrica.com (and the existing website) | Existing account |
| Sentry | Error reporting | Free tier |
| OpenAI (Anthropic, Gemini optional) | AI models, pay-as-you-go | Passed through to tenants via plan limits and overage billing |

Retired: **Neon** (free compute allowance ran out and took production down;
replaced by Railway Postgres, started fresh), **Vercel** (free plan forbids
commercial use; replaced by the Railway `dashboard` service). **Brevo** is
retired once the replacement email setup is working.

## Database

Railway's official Postgres image (18.x, SSL on, pgvector 0.8 included).
Set up with `infra/scripts/bootstrap-database.mjs`, which creates the `chat`
schema, installs pgvector into it, and creates the `chat_app_user` runtime
role with `NOBYPASSRLS` and no DDL rights, then verifies both.

- `api`/`workers` `DATABASE_URL`: `chat_app_user` over the private network
  (`postgres.railway.internal`), `?schema=chat`.
- `api` `DATABASE_MIGRATE_URL`: the database owner over the public TCP proxy,
  used only by the deploy workflow to apply schema + RLS (GitHub Actions runs
  outside Railway's private network).
- CI tests against `pgvector/pgvector:pg18` to match production.
- Railway Postgres has no automatic backups on Hobby. Set up a scheduled
  `pg_dump` before relying on it for paying clients' data.

## Dashboard

`apps/dashboard/Dockerfile`, repository root as build context. The four
`NEXT_PUBLIC_*` values are Railway service variables (they are baked into
the build, so changing one requires a redeploy). Served at
`app.datalystafrica.com` via a CNAME in HostGator DNS plus Railway's
`_railway-verify.app` TXT record. Deployed by `deploy-dashboard.yml` after
CI passes.
