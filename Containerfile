# syntax=docker/dockerfile:1.7
# Fork Containerfile — replaces upstream's Dockerfile (see FORK.md).
# node:24-slim (Debian glibc, current LTS), corepack-managed pnpm 12,
# reproducible installs from the tracked pnpm-lock.yaml, no registry mirrors.

ARG NODE_IMAGE=node:24-slim

########## deps — resolve workspace dependencies (root + tests) ##########
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tests/package.json tests/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

########## builder — compile the Next.js standalone output ##########
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
# Reuse the corepack cache so the pinned pnpm version isn't re-downloaded.
COPY --from=deps /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

########## runner — minimal production image ##########
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=20128 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data

ARG REVISION=local
LABEL org.opencontainers.image.title="9router" \
      org.opencontainers.image.source="https://github.com/luthfisolahudin/9router" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.base.name="docker.io/library/node:24-slim"

# gosu drops privileges to `node` after fixing volume ownership on boot
# (the mounted /app/data may be created by root on the host).
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /app/data /app/data-home \
 && chown -R node:node /app /app/data-home \
 && ln -sf /app/data-home /root/.9router \
 && printf '#!/bin/sh\nchown -R node:node /app/data /app/data-home 2>/dev/null\nexec gosu node "$@"\n' > /entrypoint.sh \
 && chmod 755 /entrypoint.sh

COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/custom-server.js ./custom-server.js
COPY --from=builder --chown=node:node /app/open-sse ./open-sse
# Next file tracing can omit sibling files; MITM runs server.js as a separate process.
COPY --from=builder --chown=node:node /app/src/mitm ./src/mitm
# Standalone node_modules may omit deps only required by the MITM child process.
COPY --from=builder --chown=node:node /app/node_modules/node-forge ./node_modules/node-forge
# Ensure `next` is available at runtime in case tracing did not include it.
COPY --from=builder --chown=node:node /app/node_modules/next ./node_modules/next
# sql.js loads dist/sql-wasm.wasm by path at runtime; tracing only follows JS imports,
# so the last-resort DB driver would abort with ENOENT on the missing binary.
COPY --from=builder --chown=node:node /app/node_modules/sql.js ./node_modules/sql.js
# node-machine-id is createRequire-loaded at runtime; tracing omits it.
COPY --from=builder --chown=node:node /app/node_modules/node-machine-id ./node_modules/node-machine-id

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||20128)+'/api/version').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 20128
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
