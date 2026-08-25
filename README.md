# AI Chat Agent Platform

Universal, multi-tenant AI Chat Agent SaaS platform — see [CLAUDE.md](CLAUDE.md)
for the full product/architecture spec and [ARCHITECTURE.md](ARCHITECTURE.md)
for concrete stack decisions, including how this product shares its AWS
hosting platform with the Voice Agent product to keep infrastructure cost
marginal per additional agent product.

## Structure

```
apps/
  api/         Fastify REST API — the agent loop, tenant/agent CRUD, auth
  widget/      Embeddable vanilla-TS chat widget (<script data-agent-id>)
  dashboard/   Next.js client + admin dashboard
  workers/     Async jobs — knowledge ingestion, workflow execution

packages/
  shared-types/    Tenant/RBAC/agent/conversation/memory/tool/workflow/audit types
  ai-provider/     AIProvider interface + Anthropic/OpenAI/Gemini adapters + router
  db/              Prisma schema (`chat` Postgres schema), RLS, tenant-scoped client
  tool-sdk/        Tool & Action Engine — registry, execution tiers, built-in tools
  rag/             Document extraction, chunking, embeddings, retrieval, crawling
  memory-engine/   Session / cross-conversation / cross-agent customer memory
  workflow-engine/ Trigger -> condition -> action -> notification executor
  queue/           SQS (prod) / Redis (dev) job queue abstraction
  storage/         Shared S3 object store wrapper, tenant-prefixed keys
  secrets/         Secrets Manager / KMS wrapper (env-var fallback in dev)
  config/          Zod-validated environment schema
  ui/              Shared dashboard design tokens + React components

infra/
  terraform/       AWS resources this product adds to the SHARED platform
  scripts/         DB schema/role bootstrap for the shared Aurora cluster

.github/workflows/ CI + per-service deploy pipelines (GitHub Actions -> ECR -> ECS)
```

## Local development

Requires Node 20+, pnpm 9, and Docker (for local Postgres/Redis).

```sh
cp .env.example .env          # fill in GEMINI_API_KEY at minimum — dev/CI
                               # default provider per CLAUDE.md principle 7
docker compose up -d          # local pgvector-enabled Postgres + Redis
pnpm install
pnpm --filter @chat-agent/db run generate
pnpm --filter @chat-agent/db exec prisma migrate dev
pnpm --filter @chat-agent/db run seed   # optional demo tenant/agent
pnpm dev                      # runs api, workers, dashboard, widget in parallel
```

- API: http://localhost:4000 (health: `/healthz`)
- Dashboard: http://localhost:3000
- Widget dev bundle: http://localhost:5000/widget.js

Drop this on any HTML page to test the widget end-to-end against your
local API:

```html
<script src="http://localhost:5000/widget.js" data-agent-id="YOUR_AGENT_ID" data-api-base="http://localhost:4000"></script>
```

## Deploying

This product deploys onto the **same shared AWS platform** as the Voice
Agent product — see [infra/README.md](infra/README.md) for the exact
resources this adds (new ECS services in the existing cluster, a new
Postgres schema in the existing Aurora cluster, new SQS queues, IAM scoped
to `chat/*` secrets and S3 keys) versus what it reuses. `.github/workflows/`
builds and pushes each service's image and rolls the corresponding ECS
service — no separate infrastructure to provision per product.

## What's here vs. what's next

This repository is a complete, coherent **architecture and working
implementation** of every system CLAUDE.md specifies: the model router
with failover, tenant-isolated Postgres schema with row-level security,
the full RAG pipeline, the tool/action engine with execution tiers, the
workflow engine, session/cross-conversation/cross-agent memory, the
Understand -> Retrieve -> Reason -> Decide -> Act -> Verify -> Respond ->
Record agent loop, Managed Setup / staff impersonation with full audit
trail, the embeddable widget, and the client dashboard.

Before pointing this at real traffic:

1. **API keys** — fill in `.env` (Anthropic/OpenAI/Gemini, and any
   CRM/email/calendar vendor credentials for the tools you enable). This
   was intentionally left for you, per your instructions.
2. **First deploy** — provision the shared `agents-platform` AWS
   infrastructure once (VPC, ECS cluster, Aurora, Redis, S3, ALB — either
   already done for Voice Agent, or stood up fresh from that pattern),
   then `terraform apply` this repo's `infra/terraform` to add the chat-*
   services to it.
3. **Vendor tool adapters** — `packages/tool-sdk` ships generic
   webhook/API/email/CRM/calendar/ticketing adapters; wiring a specific
   vendor (e.g. HubSpot, Cal.com, SendGrid) is a config row, not new code,
   but you'll want to smoke-test each integration you actually use.
4. **Load/latency testing** and a real sentiment/escalation classifier
   (the lexical heuristic in `apps/api/src/engine/sentiment.ts` is a
   documented placeholder, swappable without touching call sites).
