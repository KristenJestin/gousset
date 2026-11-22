# syntax=docker/dockerfile:1
# The one image of Gousset (docs/releases.md, "The image"): the app (pages, server functions,
# background jobs) and its `migrate` one-shot.
#   docker build -t gousset .
#   docker run gousset           the app, on port 3001
#   docker run gousset migrate   applies the database migrations, then exits
FROM node:26.13.1-slim AS build
ENV VARLOCK_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.21.0
WORKDIR /src
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  pnpm install --frozen-lockfile --store-dir /pnpm-store
ENV NODE_ENV=production
RUN pnpm --filter web build
# The migrations need drizzle-orm and pg only: one bundled file, its migrations beside it.
RUN pnpm exec rolldown packages/db/src/migrate.ts --platform node -f esm -o /out/db/migrate.mjs \
  && cp -r packages/db/src/migrations /out/db/migrations \
  && cp -r apps/web/.output/. /out/
# The server loads and checks its environment at start with Varlock's CLI and the app's schema
# (`ssrInjectMode: "auto-load"`): both ship, the CLI having no dependency of its own.
RUN mkdir -p /out/node_modules/.bin \
  && cp -rL apps/web/node_modules/varlock /out/node_modules/varlock \
  && ln -s ../varlock/bin/cli.js /out/node_modules/.bin/varlock \
  && cp apps/web/.env.schema /out/.env.schema

FROM node:26.13.1-slim
ARG VERSION=local
LABEL org.opencontainers.image.title="Gousset" \
  org.opencontainers.image.description="Self-hosted personal finance: where did my money go?" \
  org.opencontainers.image.source="https://github.com/KristenJestin/gousset" \
  org.opencontainers.image.licenses="AGPL-3.0-only" \
  org.opencontainers.image.version="$VERSION"
# Varlock's CLI sends usage statistics unless told not to: nothing leaves an installation.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 \
  VARLOCK_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /out /app
COPY --chmod=755 tools/docker-entrypoint.sh /usr/local/bin/gousset
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["gousset"]
CMD ["serve"]
