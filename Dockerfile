# Grand Transfer Agent web app (public mode). Data lives in the /data volume.
# Build:  docker build -t grand-transfer-agent .
# Run:    docker run --env-file .env.public -p 127.0.0.1:3000:3000 -v gta-data:/data grand-transfer-agent
FROM node:26-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @gta/web build

FROM base AS run
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# 0.0.0.0 inside the container only; the app itself refuses any Host but GTA_PUBLIC_ORIGIN's.
CMD ["pnpm", "--filter", "@gta/web", "exec", "next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
