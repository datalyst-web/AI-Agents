# Multi-stage build run from the monorepo root:
#   docker build -f apps/workers/Dockerfile -t chat-workers .
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN npx turbo prune @chat-agent/workers --docker

FROM base AS builder
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
# See apps/api/Dockerfile — turbo prune drops root-level config files that
# no package's file graph references, breaking tsconfig's `extends`.
COPY --from=pruner /repo/tsconfig.base.json /repo/turbo.json ./
RUN pnpm turbo run build --filter=@chat-agent/workers...

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
# See apps/api/Dockerfile — node:20-slim ships without libssl, which
# Prisma's query engine binary needs at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
COPY --from=builder /repo .
USER nodeapp
CMD ["node", "apps/workers/dist/main.js"]
