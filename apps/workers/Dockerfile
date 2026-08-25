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
RUN pnpm turbo run build --filter=@chat-agent/workers...

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
COPY --from=builder /repo .
USER nodeapp
CMD ["node", "apps/workers/dist/main.js"]
