# Multi-stage build run from the monorepo root:
#   docker build -f apps/api/Dockerfile -t chat-api .
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN npx turbo prune @chat-agent/api --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# turbo prune's output only includes package.json files and per-package
# source — root-level config files (tsconfig.base.json, turbo.json itself)
# aren't part of any package's file graph, so they're silently dropped and
# every package's `extends: "../../tsconfig.base.json"` fails to resolve.
# Copy them from the pruner stage, which still has the untouched full repo.
COPY --from=pruner /repo/tsconfig.base.json /repo/turbo.json ./
RUN pnpm turbo run build --filter=@chat-agent/api...

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# node:20-slim ships without libssl — Prisma's query engine binary needs it
# at runtime or every query throws PrismaClientInitializationError. Only
# surfaced by actually running the built image, not by the build succeeding.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
COPY --from=builder /repo .
USER nodeapp
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://localhost:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
