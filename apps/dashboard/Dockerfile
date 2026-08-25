# Multi-stage build run from the monorepo root:
#   docker build -f apps/dashboard/Dockerfile -t chat-dashboard \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://chat-api.agents-platform.example.com .
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
RUN npx turbo prune @chat-agent/dashboard --docker

FROM base AS builder
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
RUN pnpm turbo run build --filter=@chat-agent/dashboard...

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
COPY --from=builder /repo .
USER nodeapp
EXPOSE 3000
CMD ["node", "apps/dashboard/node_modules/.bin/next", "start", "-p", "3000"]
