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
RUN pnpm turbo run build --filter=@chat-agent/api...

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
COPY --from=builder /repo .
USER nodeapp
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://localhost:4000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
