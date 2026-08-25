# Technical Architecture & Stack

Concrete stack decisions for the Universal AI Chat Agent Platform, per the
"Suggested Tech Stack [PROPOSED — confirm before first build]" section of
[CLAUDE.md](CLAUDE.md). Runtime: **Node.js / TypeScript**. Cloud target:
**AWS** — the same AWS platform as `AI Voice Agent Workflows`, by design
(see "Shared platform hosting" below).

## Shared platform hosting `[LOCKED]`

This product does **not** get its own VPC, cluster, database, queue, or
secrets store. It is deployed as additional services inside the **same
shared AWS platform** as every other agent product (Voice, Sales, future
products) so we pay for one piece of infrastructure that scales across all
of them, not one stack per product:

- **One ECS Fargate cluster** (`agents-platform`) — each product's
  request/event-driven services run as their own ECS services inside it
  (`chat-api`, `chat-workers`, `voice-call-engine`, `voice-api`, ...).
  Adding a new agent product means adding an ECS service, not standing up
  a new cluster.
- **One Aurora Postgres cluster** (with `pgvector`) — every product gets
  its own Postgres **schema** inside the same cluster
  (`chat`, `voice`, `sales`, ...), never a separate database/instance.
  Cheaper (one set of instances/replicas/backups to pay for and operate)
  while keeping products' tables physically separated by schema, and every
  table still carries `tenant_id` per CLAUDE.md principle 1.
- **One ElastiCache Redis cluster**, key-namespaced per product
  (`chat:*`, `voice:*`) — sub-ms cache/session/rate-limit reads shared
  across products.
- **One SQS account setup + EventBridge bus**, per-product queues
  (`chat-knowledge-ingest`, `chat-workflow-run`, `voice-outbound-dial`,
  ...) — one queueing system to operate, independent throughput per queue.
- **One S3 bucket** (`agents-platform-storage`), key-prefixed by product
  then tenant (`chat/{tenantId}/...`, `voice/{tenantId}/...`) — one
  bucket policy, one lifecycle/retention config to maintain.
- **One Secrets Manager / KMS setup** — LLM provider keys are already
  shared across products (same `AIProvider` contract, same Anthropic/
  OpenAI/Gemini accounts); chat-specific secrets (e.g. CRM/email
  integration credentials) live under a `chat/` path prefix.
- **One CloudWatch + OpenTelemetry pipeline**, one GitHub Actions ->
  ECR -> ECS pipeline, with per-service deploy targets.

Net effect: standing up the Chat Agent product costs *marginal* infra
(new ECS services + a new Postgres schema + new queues), not a second
platform. This is the direct implementation of "use the same hosting way
they used [for Voice] to cut costs — we won't need to host to many
platforms" — see `infra/` for the Terraform that extends the shared
platform rather than duplicating it.

### Why this is safe for tenant isolation

Sharing infrastructure is a cost decision, not a scoping decision — it
does not relax CLAUDE.md principle 1. Schema-per-product plus
`tenant_id`-scoped RLS per row inside `chat` means a Chat Agent tenant's
data is unreachable both from other Chat tenants *and* from the Voice/Sales
schemas, at the database level, not just in application code.

## Monorepo layout

```
apps/
  api/            REST API — dashboard, admin, billing, tenant/agent CRUD,
                  the conversation/agent-engine request path, widget-facing
                  public endpoints
  widget/         Embeddable vanilla TS chat widget (script tag, no
                  framework) — the client-site footprint
  dashboard/      Next.js client + admin dashboard
  workers/        Async jobs: knowledge ingestion, embeddings, workflow
                  runs, follow-ups, staff/managed-setup pipelines

packages/
  ai-provider/     AIProvider interface + Anthropic/OpenAI/Gemini adapters
                   + the model router (cost/latency/failover)
  db/              Postgres (`chat` schema) via Prisma, RLS policies,
                   tenant-scoped query helpers
  shared-types/    Tenant, RBAC, agent, conversation, memory, tool,
                   workflow, billing, audit types shared across apps
  tool-sdk/        Tool & Action Engine: tool registry, schemas,
                   permission/execution tiers, built-in tool adapters
  workflow-engine/ Trigger -> condition -> action -> notification engine
  rag/             Document extraction, chunking, embeddings, retrieval,
                   website crawling
  memory-engine/   Session / cross-conversation / cross-agent memory
  secrets/         Secrets Manager / KMS wrapper (env-var fallback in dev)
  config/          Per-app env schema validation (zod)
  ui/              Shared React components/design tokens for the dashboard
```

One language across `api`, `workers`, and `dashboard` keeps the
`AIProvider` contract (CLAUDE.md principle 2) shared as actual TypeScript
interfaces instead of duplicated docs — same pattern as the Voice Agent
repo's `packages/ai-provider`.

## Core infrastructure (AWS, shared platform)

| Concern | Choice | Why |
|---|---|---|
| Primary DB | **Aurora Postgres**, `chat` schema on the shared cluster | Relational multi-tenant data, RLS for `tenant_id` isolation, one cluster to operate across products |
| Vector store | **pgvector**, same schema | Every embedding row already carries `tenant_id`/`agent_id`/`knowledge_source_id` per CLAUDE.md's RAG spec; no separate vector DB to secure |
| Cache / session / rate limits | **ElastiCache (Redis)**, `chat:` key prefix | Sub-ms reads for routing decisions, rate limiting, widget session tokens |
| Async queue | **SQS** (+ EventBridge for scheduled/workflow triggers), `chat-*` queues | Knowledge ingestion, embedding jobs, workflow engine, follow-up email |
| Object storage | **S3**, `chat/{tenantId}/...` prefix | Uploaded documents, exported transcripts — encrypted, tenant-prefixed keys |
| Secrets | **Secrets Manager / KMS**, `chat/` path prefix | LLM/CRM/email credentials never touch the client or dashboard |
| Observability | **CloudWatch + OpenTelemetry traces** | Per-conversation latency and error tracing |
| CI/CD | **GitHub Actions -> ECR -> ECS**, per-service deploy | Standard, reuses the Voice Agent pipeline pattern |

`apps/api` and `apps/workers` run on **ECS Fargate** (request/event-driven,
no long-lived per-call connection requirement like `voice-call-engine`, but
kept off Lambda for consistent latency and shared VPC/Redis access). The
widget's static assets (`apps/widget`) are built and served from
**S3 + CloudFront**, not ECS — it's a static script bundle.

## Model Router (`AIProvider`)

Identical contract to the Voice Agent repo, reused as-is:
`AnthropicProvider`, `OpenAIProvider`, `GeminiProvider` (pinned stable
model IDs). Each implements `generate / stream / toolCall / embed /
countTokens / healthCheck`. Default failover order:
Anthropic -> OpenAI -> Gemini. Gemini is the default dev/test provider
(CLAUDE.md principle 7) — never wired as a hard production dependency.

## Auth & multi-tenancy

- Auth: JWT-based auth with tenant/org + role claims (`shared-types`
  RBAC roles: `platform_admin`, `tenant_owner`, `tenant_admin`,
  `tenant_agent_editor`, `tenant_viewer`, `setup_specialist`).
- Every DB row scoped by `tenant_id` (+ `agent_id` where applicable),
  enforced via Postgres row-level security policies in the `chat` schema,
  not just application-layer filtering.
- Staff "act as tenant" sessions (Managed Setup) are a distinct,
  time-boxed, audited auth mode layered on top of the same tenant model —
  see `packages/db` `StaffImpersonationSession` and the audit log.

## Dashboard

**Next.js (React) + TypeScript**, sharing types with `packages/shared-types`.
Talks only to `apps/api` — never directly to any LLM vendor or the DB, per
principle 2 and the Security section.

## What this doc intentionally leaves open

- Exact CRM/calendar/email vendor adapters wired into `packages/tool-sdk`
  beyond the generic webhook/API tool — decide per client integration
  demand.
- Whether a dedicated vector DB is ever needed instead of pgvector — only
  if RAG volume/latency outgrows the shared Aurora cluster.
- Specific managed-provider vs. custom auth implementation — either fronts
  the same tenant/RBAC model in `packages/shared-types`.

## Suggested build order

1. `packages/shared-types` + `packages/db` — contracts and schema first.
2. `packages/ai-provider` — interface + Gemini (dev) + Anthropic adapters.
3. `packages/tool-sdk` + `packages/rag` + `packages/memory-engine` —
   the engines the agent loop depends on.
4. `apps/api` — tenant/agent CRUD, auth, the conversation/agent-engine
   request path (Understand -> Retrieve -> Reason -> Decide -> Act ->
   Verify -> Respond -> Record).
5. `packages/workflow-engine` + `apps/workers` — async jobs wired to
   triggers.
6. `apps/widget` — embeddable script hitting `apps/api`.
7. `apps/dashboard` — once there's an API to point it at.
8. `infra/` — Terraform extending the shared `agents-platform` cluster
   with `chat-*` services, matching Voice Agent's ECS/Aurora/Redis/SQS/S3
   pattern.
