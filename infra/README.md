# Infrastructure — shared platform, chat-specific resources only

This Terraform does **not** stand up a new VPC, ECS cluster, Aurora
cluster, Redis cluster, S3 bucket, or ALB. Those already exist as the
shared `agents-platform` infrastructure (originally provisioned for the
Voice Agent product — see `AI Voice Agent Workflows/ARCHITECTURE.md`) and
are looked up here via Terraform **data sources**, by tag
(`Project = "agents-platform"`).

This directory only adds what's specific to the Chat Agent product:

- ECR repositories for `chat-api` and `chat-workers` images.
- ECS task definitions + services (`chat-api`, `chat-workers`) registered
  into the **existing shared ECS cluster**.
- An ALB target group + listener rule routing `chat-api.<platform-domain>`
  (or a path prefix, see `variables.tf`) to the new `chat-api` service on
  the **existing shared ALB**.
- SQS queues (`chat-knowledge-ingest`, `chat-workflow-run`,
  `chat-followup`) — new queues, same SQS account/region as Voice.
- IAM roles/policies scoped to `chat/*` Secrets Manager paths and
  `chat/*` S3 key prefixes on the **existing shared secrets store and
  bucket** — never broadened to touch Voice's or Sales' data.
- A CloudFront distribution + S3 origin for the static widget bundle
  (`apps/widget/dist/widget.js`), the one piece of this product that
  legitimately needs its own edge-cached static hosting rather than
  living behind the ALB/API path.
- A Postgres schema-and-role bootstrap script (`scripts/bootstrap-db.sh`)
  that creates the `chat` schema + `chat_app_user` role on the **existing
  shared Aurora cluster** and applies `packages/db/prisma/sql/*.sql`.

Run order for a first deploy against an existing shared platform:

```sh
cd infra/terraform
terraform init
terraform plan  -var-file=environments/prod.tfvars
terraform apply -var-file=environments/prod.tfvars

# Then, once the Aurora endpoint/credentials are known:
../scripts/bootstrap-db.sh
pnpm --filter @chat-agent/db run migrate:deploy
```

See ARCHITECTURE.md at the repo root for the cost rationale — this
structure is what lets a second, third, Nth agent product join the same
platform for marginal infra cost instead of a new stack each time.
