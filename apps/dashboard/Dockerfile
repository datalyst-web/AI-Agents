# Multi-stage build run from the monorepo root:
#   docker build -f apps/dashboard/Dockerfile -t chat-dashboard \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://chat-api.agents-platform.example.com .
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS pruner
COPY . .
# The dashboard build copies widget.js, even though the widget isn't a
# package dependency. Include it explicitly in the pruned workspace.
RUN npx turbo prune @chat-agent/dashboard @chat-agent/widget --docker

FROM base AS builder
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_WIDGET_SCRIPT_URL
ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_WIDGET_SCRIPT_URL=$NEXT_PUBLIC_WIDGET_SCRIPT_URL
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY --from=pruner /repo/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /repo/out/full/ .
COPY --from=pruner /repo/tsconfig.base.json /repo/turbo.json ./
RUN test -n "$NEXT_PUBLIC_API_BASE_URL"
RUN pnpm turbo run build --filter=@chat-agent/dashboard...

FROM node:20-slim AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nodeapp
COPY --from=builder --chown=nodeapp:nodejs /repo .
WORKDIR /app/apps/dashboard
USER nodeapp
EXPOSE 3000
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port \"${PORT:-3000}\""]
