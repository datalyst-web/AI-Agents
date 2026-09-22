# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository.

**Doc status:** v1.3 (2026-09-22) — living architecture/guidance doc, not a finished
spec. Sections are marked `[LOCKED]` (settled decision, treat as a
constraint) or `[PROPOSED]` (direction we intend to take, still open to
revision — e.g. against real vendor testing). Anything unmarked should
be treated as `[LOCKED]` unless it's clearly descriptive narrative (like
this Project Overview).

## Project Overview

This repository implements a **Universal AI Chat Agent Platform** — a
production-ready, multi-tenant SaaS system that lets businesses across any
industry purchase, configure, and deploy an AI "digital employee" to their
website and other channels.

**Core philosophy:** Build the AI engine once. Configure each client's AI
employee separately.

**How a client gets configured `[LOCKED]`:**

**Every client is fully managed. There is no self-serve configuration
path.** Our own team builds and configures the knowledge base, agent
instructions and integrations on the client's behalf, using the same
tenant-scoped tools and pipelines a client would use (never a separate,
undocumented path) — see "Managed Setup Service" below. The client's
dashboard is for **reviewing, testing, approving and monitoring**, not for
building.

This is a product decision, not a limitation to design around. It shapes
concrete things in the code, all of which must stay consistent with it:

- Signup creates tenants as `FULLY_MANAGED`, never `SELF_SERVE`
  (`auth.routes.ts`).
- `CLIENT_NAV` in the dashboard layout deliberately omits the
  configuration surfaces (Tools, Workflows) that `TENANT_NAV` exposes to
  staff while impersonating. Adding a config screen to `CLIENT_NAV` is a
  product regression, not a feature.
- Public copy (the marketing page and `/guide`) must never tell a client
  to configure, upload or wire up anything themselves. Their only input is
  sending us their material, then reviewing what we build.

The `SELF_SERVE` value still exists in `ManagedSetupTier` for historical
tenants; nothing new should be created with it.

The system is not a simple Q&A chatbot. Every agent operates on the loop:

```
Understand → Retrieve → Reason → Decide → Act → Verify → Respond → Record
```

Agents can answer questions, qualify and score leads, recommend
products/services, book appointments, send emails, create CRM records, call
APIs/webhooks, run workflows, create support tickets, escalate to humans, and
surface analytics.

## Guiding Principles (apply to all code in this repo)

1. **Multi-tenant by default.** Every table, query, cache key, vector
   record, log line, and API call must be scoped to `tenant_id` (and usually
   `agent_id`). No code path should be able to read or write another
   tenant's data. Treat missing tenant scoping as a security bug, not a bug.
2. **Model-independent.** Application code must never call a provider SDK
   (Anthropic, OpenAI, Gemini) directly. All model access goes through the
   `AIProvider` abstraction (see below). Do not add provider-specific
   branching logic outside the provider adapters.
3. **Knowledge-driven, not hard-coded.** Client facts (prices, policies,
   products, hours) live in the knowledge base / RAG pipeline, never in
   prompts, code, or model weights. Updating a client's knowledge base must
   never require a deploy or retrain.
4. **Anti-hallucination first, with confirmation.** The agent must prefer
   "I can't verify that" over inventing prices, availability, orders,
   appointments, policies, or tool results. Anything that will be acted on
   (a booking, an order, a confirmation code) must be **confirmed back to
   the customer** before or after the action executes. Never mark an
   action as succeeded unless the tool call actually confirmed success.
5. **Action safety tiers.** Tool calls are auto-executed, confirmation-gated,
   or human-approval-gated based on risk. Sending money, cancelling
   appointments, and changing sensitive records must never be
   auto-executed.
6. **White-label safe.** Nothing in client-facing surfaces (widget,
   dashboard, emails, standalone agent URL) should leak which AI provider,
   model, or internal infra is in use.
7. **Gemini is dev/test only.** Local development and CI should run against
   Gemini (via its API key) to minimize cost, without requiring live
   Anthropic/OpenAI credentials for routine dev work. Production traffic
   is routed across Anthropic / OpenAI / Gemini with configurable
   failover. The dev/test setup must never become a hard production
   dependency.
8. **Staff-assisted setup uses client-facing tools, never a side channel.**
   When our own team configures a client's knowledge base or agent on
   their behalf (see "Managed Setup Service"), they must go through the
   same tenant-scoped pipelines and permission checks a client would use —
   fully audited and attributable — never a direct/bypass path into a
   tenant's data.

## Architecture

```
                         AI CHAT PLATFORM
                                │
                  ┌─────────────┴─────────────┐
                  │                           │
             CLIENT LAYER                ADMIN LAYER
                  │                           │
          ┌───────┴────────┐           Platform Control
          │                │
      Dashboard        AI Widget
          │                │
          └───────┬────────┘
                  │
             AGENT ENGINE
                  │
      ┌───────────┼────────────┐
      │           │            │
 Knowledge     Memory       Workflow
  Engine       Engine        Engine
      │           │            │
      └───────────┼────────────┘
                  │
              TOOL ENGINE
                  │
       ┌──────────┼───────────┐
       │          │           │
      CRM      Calendar      APIs
                  │
                  ▼
             MODEL ROUTER
                  │
       ┌──────────┼───────────┐
       │          │           │
   Anthropic    OpenAI      Gemini
```

### Model Router / Provider Abstraction

All model access goes through a single interface:

```
AIProvider
 ├── AnthropicProvider
 ├── OpenAIProvider
 └── GeminiProvider
```

Exposed methods (implement identically across all providers):

- `generate()`
- `stream()`
- `toolCall()`
- `embed()`
- `countTokens()`
- `healthCheck()`

Routing decisions may consider: cost, speed, context length needs,
reasoning requirements, multimodal requirements, provider availability,
task type, client subscription tier, and admin configuration.

**Failover chain** (configurable, default order):
`Anthropic → OpenAI → Gemini`. Failures should be invisible to the end
user wherever possible.

**Gemini note:** used as a production failover option and as the default
dev/test provider (via its API key), so local development and CI don't
incur Anthropic/OpenAI costs. Use pinned, stable model IDs in production
rather than moving/preview aliases. Gemini's function/tool-calling
support means it can participate fully in the Tool Engine in both roles,
not just plain generation.

**Production today:** OpenAI answers with `gpt-5-mini` (`OPENAI_MODEL_ID` on
`api` and `workers`; the code default is `gpt-5`), with Gemini as the working
failover; Anthropic has no key yet, so the router skips it. Staff can see which providers are really connected on the
agent's AI Model card (`GET /v1/platform/ai-providers`, staff-only).

**Reply speed `[LOCKED]`:** agents default to `reasoningEffort: "low"`
("Fast" on the AI Model card). Measured on production, it answered
knowledge-base questions ~3× faster than "medium" with the same answers,
including refusing to invent facts, and costs less (reasoning tokens are
billed). Raise it per agent only for complex multi-step tool work.
Production switched to `gpt-5-mini` (2026-09-22): same knowledge answers at
~5× lower cost. It did, unlike `gpt-5`, offer to book a table for an agent
with no booking tool — so the system prompt now always states exactly which
actions the agent has tools for (`capabilitiesText()` in `agentLoop.ts`).
Keep that section whatever the model.

### Tenant / Client Isolation

```
                 PLATFORM
                    │
       ┌────────────┼────────────┐
       │            │            │
    CLIENT A     CLIENT B     CLIENT C
       │            │            │
     Agent A      Agent B      Agent C
       │            │            │
 Knowledge A   Knowledge B   Knowledge C
```

Isolated per client: users, agents, knowledge, conversations, customers,
leads, files, integrations, API credentials, workflows, analytics, branding,
settings.

### Knowledge Base / RAG Pipeline

```
Client Documents → Document Processing → Text Extraction → Chunking →
Embeddings → Vector Database → Semantic Search → Relevant Context → AI Model
```

Every knowledge record carries: `tenant_id`, `agent_id`,
`knowledge_source_id`, `document_id`, `chunk_id`, `embedding`, `metadata`.
Every retrieval must enforce tenant + agent authorization — an agent must
never be able to retrieve another client's chunks.

Supported sources: PDF, DOCX, TXT, CSV (where appropriate), website
crawling (selected pages or sitemap ingestion), manual FAQs/Q&A, and
trusted external APIs.

### Memory Engine

Distinct from the Knowledge Engine: Knowledge is what the business
knows (facts, prices, policies). Memory is what the agent knows about
*this specific customer*, across time. Both are tenant/agent-scoped and
retrieved the same way — via the Agent Engine, never hard-coded.

Three scopes, each with its own retention/consent rules:

- **In-conversation memory (session)** — everything said earlier in the
  current conversation. Always available, cleared at session end unless
  promoted to cross-conversation memory below.
- **Cross-conversation memory (per customer)** — keyed by a durable
  customer identifier (authenticated account, email, or a persistent
  widget session/cookie), scoped to a single tenant/agent. Stores
  durable facts a customer has stated across conversations (stated
  preferences, prior issues raised, order history references) — not
  full transcripts by default. This is what lets the agent recognize a
  returning customer ("last time you asked about X") instead of
  starting cold every time.
- **Cross-agent memory (per tenant, opt-in only)** — sharing customer
  context across multiple agents/departments within the *same* tenant
  (e.g. sales agent's notes visible to support agent). Off by default;
  a tenant must explicitly enable it per pair of agents. Never shared
  across tenants under any configuration — this is a tenant-isolation
  boundary, not just a privacy preference.

Rules:
- Memory writes happen through the same tool-permission and audit
  pipeline as any other agent action — never a silent side-write.
- A customer can request their memory be reset or forgotten; this must
  be a supported, auditable action (see Security Requirements), not a
  manual database operation.
- Cross-conversation memory retention follows the tenant's configured
  data retention policy — it doesn't get a silent exemption just
  because it's "memory" rather than "conversation logs."
- The agent must never present a memory-derived inference as a fact the
  customer stated if they didn't actually state it — this is the same
  anti-hallucination principle applied to memory retrieval, not just
  knowledge retrieval.

### Tool & Action Engine

```
TOOLS
├── Search Knowledge
├── Search Database
├── CRM
├── Calendar
├── Email
├── Webhook
├── API
├── Ticketing
├── Inventory
├── Orders
└── Custom Tools
```

Each tool definition requires: name, description, input schema, output
schema, permissions, authentication, tenant ownership, logging, and error
handling. The AI must only ever see tools it is authorized to use for that
tenant/agent.

Execution tiers:
- **Automatic** — low-risk actions only.
- **Confirmation required** — e.g. sending important emails, cancelling
  appointments, purchases, sensitive record changes.
- **Human approval** — high-risk actions.

### Workflow Engine

```
TRIGGER → AI DECISION → ACTION → CONDITION → ACTION → NOTIFICATION → FOLLOW-UP
```

Triggers: new lead, conversation ended, conversation abandoned, tool
failure, CRM field change, DTMF-equivalent form submission, sentiment
threshold crossed (frustration detected), no-reply timeout on an open
conversation.

Workflows are tenant-scoped and versioned like agent config. Each
workflow definition requires: trigger, condition logic (branching, not
just linear), action(s), retry/failure behavior, and notification
target. A failed action in a workflow must not silently drop — log it
and notify a configured fallback (staff/owner), never fail open or fail
silently.

Examples:
- New lead → qualify → score → if HOT → create CRM record → notify
  salesperson → send customer confirmation.
- Conversation abandoned (customer stops replying mid-flow) → wait 1
  hour → send follow-up email with a link back to the conversation.
- Sentiment threshold crossed mid-conversation → flag for post-
  conversation review → notify team lead, independent of whether a
  human handoff also occurred.

### Human Handoff

Trigger handoff on: explicit request, detected frustration, complex/sensitive
issue, high-value lead, missing information, tool failure, or business rule.
Before handoff, summarize for the human:

```
CUSTOMER
REQUEST
PROBLEM
INFORMATION COLLECTED
ACTIONS ATTEMPTED
RECOMMENDED NEXT STEP
```

## Client Lifecycle

Onboarding steps: Business Information → Knowledge Base → Agent
Configuration → Integrations → Testing → Deployment.

Agent status pipeline:

```
DRAFT → CONFIGURING → KNOWLEDGE PROCESSING → TESTING → APPROVED → LIVE
```

Subscription states: `ACTIVE`, `TRIAL`, `PAST_DUE`, `SUSPENDED`,
`CANCELLED`. On expiry, suspend the agent — never delete client data.

Agents are versioned (e.g. `v1.0`, `v1.1`, `v2.0`) with rollback support.
Knowledge updates are tracked separately from agent config versions.

### Published vs working copy `[LOCKED]`

Client approval gates **every** change a customer can see, not only the
first launch. A `LIVE` agent has two copies of its config
(`apps/api/src/lib/publishedAgentConfig.ts`):

- **Working copy** — the `Agent` row. What staff edit, and what the
  dashboard's test chat answers with (`useWorkingCopy`).
- **Published copy** — the `AgentVersionSnapshot` for `agent.version`. What
  every customer channel and the widget's greeting/name are served.

Editing a `LIVE` agent creates *pending changes*; the agent page shows a
banner, the client clicks **Approve changes**, then **Publish changes**
releases a new version. Staff can publish without approval only when the
tenant has `delegatesAutoPublish`. Rollback restores an already-approved
version and records it as the new published copy. Never read
`agent.personality`/`modelRouting`/`enabledToolIds` directly on a
customer-facing path — use `servedAgentConfig()`.

### Lapsed subscriptions `[LOCKED]`

One rule, `isSubscriptionLapsed()` in `apps/api/src/lib/subscriptionAccess.ts`:
`SUSPENDED`, `CANCELLED`, or a `TRIAL` past `trialEndsAt` (the date is the
truth even before `trialExpirySweep` runs). `PAST_DUE` is a grace period,
not lapsed. A lapsed client can still sign in, but `app.authenticate`
returns `402 subscription_required` on everything except billing, usage,
support tickets and `/v1/auth/*`; the dashboard shows only Billing and
Support with a banner, and unlocks the moment Paynow confirms payment.
Their agent stops answering at the same moment. Staff are never locked
out. The check fails open on a database error.

### Free trials `[LOCKED]`

Self-signup is the free-trial path (clients who subscribe directly are
onboarded by our team another way, not by this flow):

1. Sign up (business name, email, password, CAPTCHA) → 6-digit email code.
2. The dashboard sends the trial owner/admin to `/welcome` before anything
   else: a 7-step questionnaire collecting everything staff need to build
   and connect the assistant — business facts, assistant behaviour and
   handover rules, products/prices, FAQs, policies, documents, logo and
   brand, every channel (incl. "install it on my website for me" vs "send
   me a guide"), calendar and tools. Stored on `Tenant.onboardingIntake`;
   files in R2 under the tenant's `intake/` prefix
   (`apps/api/src/routes/onboarding.routes.ts`).
3. Every staff member is emailed all answers (files attached up to 4 MB);
   Managed Setup shows a "Questionnaire" button per client.
4. Staff build, the client approves, it's published. **The 14 days start at
   first go-live** (`trialEndsAt` is null until then; the publish route sets
   it and emails the client). Reminders at 3 days and on the last day; at
   expiry the account locks to Billing until they pay (see "Lapsed
   subscriptions"). One account per email — a repeat signup is refused.

### Deleting a client `[LOCKED]`

"Remove" in Managed Setup cancels (reversible — Reactivate). Permanent
**Delete** is separate: `platform_admin` only, only for a client already
`CANCELLED`, and the caller must type the client's exact name and a
reason. Every tenant table cascades from `Tenant`; stored files are
removed from R2 afterwards; the deletion is recorded in the platform-level
`tenant_deletion_records` because the client's own audit log is deleted
with it. Automatic expiry must never delete.

## Managed Setup Service (Done-For-You Onboarding)

This is a core, sellable part of the product, not an internal favor. Many
clients (especially small businesses) do not have the time or expertise to
assemble a knowledge base, write agent instructions, or configure
integrations themselves. We offer a **paid Managed Setup / Done-For-You
(DFY) service** where our own staff build and configure the client's agent
for them.

This must be designed as a first-class product capability from day one:

### Service tiers (reflect in the data model / billing, not just docs)

`ManagedSetupTier` retains three values, but only one is sold:

- **Fully managed `[LOCKED — the only tier sold]`** — staff own the entire
  setup end-to-end, including ongoing knowledge base maintenance. Every new
  tenant is created as this.
- **Assisted setup** — legacy value. Client provides raw materials, staff
  structure and load them. Kept for existing tenants; not offered.
- **Self-serve** — legacy value. Not offered, and not compatible with the
  current client dashboard, which has no configuration surfaces.

### Internal roles & access

- Add an **internal staff role** (e.g. `setup_specialist` /
  `onboarding_agent`), distinct from platform super-admins and from the
  client's own users.
- Staff acting on a client's behalf must operate through the **same
  tenant-scoped tools and pipelines a client would use** — document
  upload, website crawling, FAQ builder, agent config screens — accessed
  via an **"act as tenant" / impersonation mode**, never through direct
  database or vector-store writes that bypass the normal ingestion
  pipeline.
- Impersonation/assisted-edit sessions must be explicitly scoped to one
  tenant at a time, time-boxed, and never grant access to unrelated
  tenants' data (this extends, not replaces, the tenant isolation rules
  above).

### Required audit trail

Every action a staff member takes on a client's behalf must be logged
with, at minimum:

- staff user id
- tenant/agent id
- action taken (e.g. "uploaded document," "edited agent instructions,"
  "published knowledge base")
- timestamp
- source of the underlying content (e.g. "client-provided PDF,"
  "transcribed from onboarding call")

The client dashboard should visibly distinguish content added by staff vs.
content added by the client themselves (e.g. an "added by Acme AI Setup
Team" tag), so there is never ambiguity about who configured what.

### Client-facing workflow

1. Client selects a managed setup tier during purchase/onboarding.
2. Client submits raw materials (documents, URLs, a completed intake
   form, and/or a scheduled onboarding call).
3. Staff build the knowledge base and agent configuration using the
   standard ingestion/config tools, under the client's tenant.
4. Agent status moves through the normal pipeline
   (`DRAFT → CONFIGURING → KNOWLEDGE PROCESSING → TESTING`).
5. Client reviews the configured agent in the **Testing** stage and must
   explicitly **approve** before the agent can move to `LIVE` — staff can
   build and test, but should not be able to unilaterally publish a
   client's agent to production without client sign-off, unless the
   client has explicitly delegated that authority in writing/contract
   terms captured in their account settings. The same applies to every
   later change — see "Published vs working copy" above.
6. For "fully managed" tier clients, staff periodically revisit and
   update the knowledge base (e.g. price/policy changes) following the
   same versioning and audit rules.

### Billing implications

Managed setup is a sellable SKU alongside the subscription plan (e.g.
one-time setup fee, or recurring "managed knowledge base maintenance" add-
on). Track it in the same usage/billing model described in "Usage & Cost
Tracking" below, tagged distinctly from AI inference costs, so it can be
invoiced and reported on separately.

## Deployment Surfaces

- **Website widget** — embed script identifies tenant + agent securely.
  Copy the snippet from the agent page; it must carry `data-api-base`,
  because the script is served by the dashboard host but talks to the API:
  ```html
  <script src="https://app.datalystafrica.com/widget.js" data-agent-id="AGENT_ID" data-api-base="https://api.datalystafrica.com"></script>
  ```
  The launcher stays hidden until its config loads (retrying network/5xx
  errors, giving up on 4xx), so a failed load never shows a dead bubble.
- **Standalone agent URL** — `https://ai.yourplatform.com/client-agent`,
  with optional custom domain for premium clients
  (`https://ai.clientcompany.com`).
- **Client dashboard** — overview, conversations, leads, knowledge, agent
  config, integrations, analytics. Lives at `/overview` and below; `/` is
  the public marketing page, not the dashboard.
- **Messaging channels** — each client connects their own Telegram bot
  (token pasted on their Integrations page; the platform registers the
  webhook). WhatsApp, Messenger and Instagram go through one platform-level
  Meta app ("Datalyst Africa Agent"): `META_APP_SECRET` and
  `META_WEBHOOK_VERIFY_TOKEN` on `api`, webhook
  `https://api.datalystafrica.com/v1/channels/meta/webhook` subscribed to
  `messages` for Page, Instagram and WhatsApp Business Account. While the
  Meta app is in Development mode it only works for its own admins' pages;
  serving clients needs Meta business verification and app review.
- **Public marketing surface** — `/` (landing + pricing), `/guide`,
  `/terms`, `/privacy`. Static server components, no auth, indexable.
  The Datalyst logo appears only in the header (linking to `/`) and footer
  of the marketing/guide/legal pages — `components/BrandHome.tsx`. The
  sign-in style screens show a "Back to home" button instead, no logo.
  Login and signup both use `components/TurnstileWidget.tsx` for the bot
  check (the API requires it on both); it renders on every mount via
  `onReady` — never `onLoad`, which fires only on first download and left
  the CAPTCHA/Google button missing after in-app navigation. Signup also
  proves the email address: it creates the account but emails a 6-digit
  code (the same step as login's two-step code) before any session.
- **White-label inside the client dashboard `[LOCKED]`** — a client sees
  only their own identity: their white-label name/logo, else their business
  name (`tenantName` from `/me`) and initial. `/me` never sends the
  platform's brand to non-staff. No "Powered by" in the widget, no AI
  provider names (Billing's per-provider card is staff-only), no internal
  terms ("model router", "CLAUDE.md") in client-visible copy.
  Two rules they must keep: never name the AI provider or model
  (principle 6), and never claim a customer, logo, testimonial or metric
  we don't have — the same anti-fabrication standard the agent is held to.
  The legal pages render unfilled company details as visible highlighted
  placeholders so they can't be published half-finished by accident.

### Theming `[LOCKED]`

Two separate theme systems, deliberately:

- **Signed-out surface** (marketing, legal, guide, and all five auth
  screens) — a per-browser light/dark choice in `localStorage`, applied by
  an inline pre-paint script in `app/layout.tsx` so switching never flashes
  the wrong theme. That script is scoped by pathname; it must not run
  inside the dashboard.
- **Dashboard and widgets** — a tenant setting persisted server-side and
  applied by `AuthProvider` from `/me`. One setting, two surfaces. A
  visitor's local preference must never override it.

Write colors with the theme tokens (`text-foreground/60`, `bg-surface-raised`,
`border-surface-border`, `text-brand-link`), never `text-white/60` or a raw
hex. `text-white` is correct *only* on a brand gradient or a solid status
fill, where it's white in both themes. `brand-300`/`brand-400` are
near-invisible on a light surface — use `brand-link`, which adapts.

## Hosting & operations `[LOCKED]`

Everything runs in **one Railway project on the Hobby plan, region EU West
(Amsterdam)** — closest Railway region to our African users. Services:
`api` (Fastify), `workers`, `dashboard` (Next.js), `Postgres` (Railway's
official 18.x image, pgvector 0.8 in the `chat` schema), `Redis`. Other
providers: Cloudflare R2 (files + backups), Cloudflare Turnstile
(login/signup bot check), HostGator DNS, Google Workspace (email), Sentry,
and the AI providers (pay-as-you-go). Neon, Vercel and Brevo are retired —
don't reintroduce them.

- **Domains** — `app.datalystafrica.com` → `dashboard` and
  `api.datalystafrica.com` → `api`, as CNAMEs in HostGator's Zone Editor
  plus Railway's `_railway-verify` TXT records.
- **Deploys** — push to `main` → CI → `deploy.yml` (applies schema + RLS to
  production, then deploys `api` and `workers`) and `deploy-dashboard.yml`.
  A red CI never deploys.
- **Database connections** — `api`/`workers` `DATABASE_URL` is
  `chat_app_user` (NOBYPASSRLS, no DDL) over the private network;
  `DATABASE_MIGRATE_URL` on `api` is the owner, over the public TCP proxy,
  used only by the deploy's schema step, backups and ops scripts. A new
  database is set up with `infra/scripts/bootstrap-database.mjs`.
- **Backups** — Railway Hobby takes none, so `.github/workflows/db-backup.yml`
  runs daily at 01:30 UTC: `pg_dump`, a real restore into a throwaway
  Postgres 18 with row-count and RLS-policy checks, upload to R2 under
  `backups/postgres/` (outside every tenant prefix), 14-day retention.
  Restore steps are in the workflow header. Any change to the backup script
  re-runs it on push.
- **Email** — Railway blocks outbound SMTP below the Pro plan, so SMTP
  cannot work here with any provider. Platform email goes through the
  **Gmail API** as `SMTP_FROM_ADDRESS` (info@datalystafrica.com) using that
  mailbox's own one-time consent: `GMAIL_OAUTH_CLIENT_ID/_SECRET/_REFRESH_TOKEN`
  on `api` and `workers`, from the Internal Google Cloud project
  `datalyst-mailer`. Re-authorise with `infra/scripts/gmail-authorize.mjs`
  if sends start failing with `google_token_invalid_grant` (e.g. the
  mailbox password changed). `REQUIRE_TWO_FACTOR=true` depends on this:
  sign-in codes are emailed. Don't touch the "Datalyst SMTP" Cloud project's
  audience — it also holds the customer "Sign in with Google" client.
- **Health checks** — `infra/scripts/check-connections.mjs` (run under
  `railway run --service api`; `--database-host=<proxy host:port>
  --skip=redis` from a laptop) verifies database isolation, storage, email
  consent and AI keys without side effects.
- **Env booleans** are parsed strictly (`"true"`/`"false"` only) — never
  `z.coerce.boolean()`, which reads `"false"` as true.
- **Logs** — query-string values named like a secret (token, key, code,
  signature…) are redacted before the request line is logged
  (`apps/api/src/lib/logRedaction.ts`).
- **Error responses** — the API's error handler is registered before every
  route; 5xx bodies are generic, never the raw error.

## Database schema changes `[LOCKED — read before touching schema.prisma]`

There is **no `prisma/migrations` directory**. Schema changes are applied
with `prisma db push`, and the generated client is refreshed with
`pnpm --filter @chat-agent/db run generate`.

The deploy pipeline (`deploy.yml`) applies the schema and re-runs both SQL
files against production *before* deploying the services, using
`DATABASE_MIGRATE_URL`, and refuses to deploy if that variable is missing.
Before that step existed, a schema change shipped a Prisma client selecting
columns production didn't have — it took login down once
(`users.notify_escalation_email`). Destructive diffs fail the deploy
instead of dropping data.

So, for any change to `schema.prisma`:

1. Regenerate the client locally and typecheck.
2. Let the deploy apply it (or apply it by hand the same way). The app's
   own `DATABASE_URL` is a least-privilege role (`chat_app_user`) with no
   DDL rights — this is correct and should stay that way — so DDL uses the
   owner's connection string in `DATABASE_MIGRATE_URL`.
3. Re-apply `packages/db/prisma/sql/rls_policies.sql` afterwards whenever
   the change added a **tenant-scoped table**. `db push` creates the table
   but knows nothing about row-level security, so a new tenant table is
   created with no tenant isolation at all until that file is re-run. Both
   SQL files in that directory are idempotent and safe to re-run.
4. Check the diff before applying to production:
   `prisma migrate diff --from-schema-datasource prisma/schema.prisma
   --to-schema-datamodel prisma/schema.prisma`. Additive-only output
   (`[+]` lines) is safe. Anything removed or retyped needs a deliberate
   decision, never `--accept-data-loss` on production.

Platform-level tables that carry no `tenant_id` (`feature_flags`,
`prompt_templates`, `branding_presets`, `incident_log_entries`,
`push_subscriptions`, `platform_settings`, `tenant_deletion_records`) are
deliberately excluded from the RLS list; access to them is gated by role in
the route instead. `tenant_deletion_records` names its column
`deleted_tenant_id`, not `tenant_id`, because it must outlive the tenant.

## Security Requirements

- Clients/browsers must **never** receive: Anthropic/OpenAI/Gemini API
  keys, database credentials, vector DB credentials, or any internal system
  credentials. All model/provider access is proxied through the backend →
  Model Router.
- Implement authentication, authorization, RBAC, tenant isolation,
  encrypted secrets, secure API key storage, audit logs, rate limiting,
  input validation, tool permission checks, session security, data access
  controls, and secure file processing.
- Treat prompt injection and cross-tenant data leakage as first-class
  security test cases (see Testing below), not edge cases.
- Internal staff "act as tenant" access for Managed Setup work (see
  "Managed Setup Service") is a privileged, auditable capability — gate it
  behind its own role/permission, log every action, and time-box each
  session to the tenant being onboarded.

## Usage & Cost Tracking

Track per organization, agent, conversation, request, provider, and model:
input tokens, output tokens, model, provider, request cost (where
available), timestamp, conversation, tenant. This backs
included-usage → limit → overage billing logic.

### How that logic is wired `[LOCKED]`

- **Prices live in one place** — `PLAN_PRICE_USD` in `apps/api/src/lib/planLimits.ts`:
  Starter $29, Growth $89, Scale $249 a month, Enterprise from $499 (not
  self-checkout). Paynow checkout and Platform Analytics read it; keep the
  marketing page's pricing table and the demo agent's knowledge in step.
- **Allowances live in one place** — `apps/api/src/lib/planLimits.ts`.
  Changing what a plan includes means editing that table, never a
  migration or a per-tenant edit. A `UsageLimits` row is provisioned
  wherever a tenant is created or changes plan, and `checkUsageAllowance`
  self-provisions for any tenant that somehow lacks one.
- **Only the hard cap blocks.** Going over the included allowance is a
  billing event, not an outage — `checkUsageAllowance` refuses a turn only
  past `hardCapTokensPerMonth`, and is called on every inbound
  customer-message path before any model call. A tenant with no limits row
  fails **open**: wrongly cutting off a paying client's agent is worse than
  briefly under-billing one.
- **Never tell the customer about the tenant's billing.** When a cap
  blocks a turn, the end customer sees the same neutral "temporarily
  unavailable" message as any other outage. Quotas and invoices are the
  business's private matter, not their customer's (white-label safety).
- **Overage is billed from closed months only.** `overageBillingSweep`
  writes an `AI_INFERENCE_OVERAGE` line item for the *previous* calendar
  month, idempotent per (tenant, period) so it self-heals if the worker was
  down at the boundary.
- **Trials end.** `Tenant.trialEndsAt` is set at signup (`TRIAL_DAYS`) and
  cleared on conversion; `trialExpirySweep` suspends expired trials and
  warns three days out. Trials are hard-capped at exactly their included
  amount — a trial should stop, not quietly accrue overage nobody agreed
  to pay. Suspension never deletes: everything built during the trial is
  intact the moment they pay.

## Conversation Analytics & Quality

Usage tracking above answers "what did this cost." This section answers
"did the conversation actually work" — the business-outcome side, which
the dashboard's analytics view (see Deployment Surfaces) is built on.

Track per conversation, rolled up per agent/tenant/time period:

- **Outcome:** resolved / escalated to human / abandoned by customer.
- **Business result:** lead qualified/disqualified, appointment booked,
  ticket created, sale/order placed — whatever outcome types the
  tenant's workflows define.
- **Drop-off point:** which stage of the conversation the customer
  disengaged at (greeting, knowledge lookup, tool execution, handoff
  wait), so a tenant can see *where* conversations fail, not just that
  some do.
- **Sentiment trend:** per-conversation sentiment trajectory and
  aggregate trend over time per agent, to surface a degrading agent
  before it shows up as lost business.
- **Handoff quality:** for conversations escalated to a human, whether
  the handoff summary was accurate/complete (spot-checked or flagged by
  the receiving human) and time-to-human-pickup.
- **Per-agent comparison:** the same metrics above compared across an
  agent's versions (`v1.0` vs `v1.1`) so a config change's actual impact
  on outcomes — not just on the test conversation — is visible.

This data is what powers ongoing quality improvement (instruction edits,
knowledge base gaps, workflow tuning) after an agent goes `LIVE` — it is
the mechanism the "fully managed" tier's staff use to know what to
revisit, and what the client sees in their dashboard to understand how
their agent is performing. Like all other conversation data, it's
tenant/agent-scoped and subject to the same retention and access rules
as conversation logs.

## Testing Expectations

Before any agent goes live, cover:

- **Knowledge:** correct answers, handling of incorrect/missing info.
- **Security:** prompt injection resistance, data leakage across tenants,
  unauthorized tool use.
- **Conversation:** context retention, intent detection, personality
  consistency, language handling.
- **Tools:** successful execution, failure handling, invalid input.
- **Business logic:** lead qualification, booking flows, support flows,
  escalation triggers.

How the automated suites are split:

- `pnpm test:unit` (`vitest.unit.config.ts`) — no database, no `.env.test`;
  config parsing, email, RBAC guard, the lapsed-subscription lock, log
  redaction, published-config comparison. Runs in seconds.
- `pnpm test` — everything, including the DB-backed suites that use the
  real RLS-enforced `chat_app_user` connection (tenant isolation, client
  deletion, pending agent changes, chat and widget-config). CI runs it on
  `pgvector/pgvector:pg18`, the same major version as production. Real
  environment variables always win over `.env.test`.
- End-to-end on production uses the **Datalyst Demo** client
  (`info+demo@datalystafrica.com`, mail lands in info@): a LIVE agent whose
  knowledge comes only from our own published marketing copy, connected to
  the website widget and the `@DatalystDemoBot` Telegram bot. Use it for
  demos and smoke tests; never put invented facts in it.

## What NOT to Do

- Don't call a provider SDK directly from application/business logic —
  always go through `AIProvider`.
- Don't let the dev/test Gemini setup become a hard production
  dependency.
- Don't hard-code any client's business facts into prompts or code.
- Don't share cross-conversation customer memory across tenants under
  any configuration, or across agents within a tenant without that
  tenant explicitly opting in per agent pair.
- Don't present a memory-derived inference as something the customer
  said if they didn't actually say it.
- Don't let the agent claim an action succeeded without tool confirmation.
- Don't auto-execute high-risk tool actions.
- Don't expose provider identity/model name to end users.
- Don't write a query, cache read, or vector search without tenant scoping.
- Don't delete client data on subscription expiry — suspend instead.
- Don't let staff configure or publish a client's knowledge base/agent
  through anything other than the standard tenant-scoped tools — no
  direct DB/vector-store edits, and no unlogged "act as tenant" access.
- Don't auto-publish a staff-configured agent to `LIVE` without client
  approval unless that authority has been explicitly delegated in the
  client's account settings.
- Don't add configuration surfaces to the client dashboard, or write copy
  telling clients to configure anything themselves — every client is fully
  managed.
- Don't change `schema.prisma` without also applying it to production and
  re-running the RLS policies for any new tenant-scoped table.
- Don't surface a tenant's quota, overage or billing state to their end
  customers.
- Don't style with `text-white/60` or raw hex on any surface that can
  render light — use the theme tokens.
- Don't serve a LIVE agent's working copy to customers — go through
  `servedAgentConfig()`; edits wait for client approval.
- Don't try SMTP from Railway (blocked below Pro) — email goes through the
  Gmail API.
- Don't parse env booleans with `z.coerce.boolean()`.
- Don't register a Fastify error handler after routes — it won't apply.
- Don't put the platform's logo or a link to it on a client's
  white-labelled surface.

## Tech Stack `[LOCKED — as built]`

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript throughout.
  `apps/api` (Fastify), `apps/workers` (queue consumers and sweeps),
  `apps/dashboard` (Next.js App Router — dashboard, marketing, auth), and
  `apps/widget` (vanilla TS embed, built into `dashboard/public/widget.js`).
  Shared packages: `ai-provider`, `config`, `db`, `email`, `memory-engine`,
  `push`, `queue`, `rag`, `secrets`, `shared-types`, `sms`, `storage`,
  `tool-sdk`, `ui`, `workflow-engine`.
- **Database:** PostgreSQL 18 with pgvector, Prisma 5 (`prisma db push`,
  no migrations directory), tenant isolation enforced by row-level security
  (`FORCE ROW LEVEL SECURITY`), not application code alone.
- **Queue/cache:** Redis.
- **Model Router:** the internal `AIProvider` abstraction above, not a
  third-party gateway.
- **Auth:** JWT sessions, tenant-scoped RBAC (`packages/shared-types/src/rbac.ts`),
  emailed two-step codes, Google sign-in, Cloudflare Turnstile.
- **Files:** Cloudflare R2 via the S3 API, keyed by tenant.
- **Hosting:** see "Hosting & operations" above.
