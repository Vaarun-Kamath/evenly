# syntax=docker/dockerfile:1
# One image: the API server plus the built web app. See docs/lib-001-split/ARCHITECTURE.md section 9.

FROM node:24-slim AS base
ENV npm_config_store_dir=/pnpm/store
# Installed with npm rather than corepack (ADR-0001). Keep in sync with "packageManager".
RUN npm install -g pnpm@12.11.2

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm -r build && pnpm --filter @evenly/server --prod deploy /out

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=build /out ./
COPY --from=build /repo/apps/web/dist ./public
USER node
EXPOSE 3000
# Asks /healthz at the configured base path (PUBLIC_URL), so it also works under /evenly.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]
CMD ["node", "dist/server.js"]
