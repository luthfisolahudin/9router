# syntax=docker/dockerfile:1.7
#
# Fork Containerfile — replaces upstream's Dockerfile (see FORK.md).
#
# ── Pinned toolchain ─────────────────────────────────────────────────────────
# These are the only version pins in this file. Docker cannot read the repo's
# pin files for FROM arguments, so keep them in sync:
#   NODE_IMAGE  <- .node-version (idiomatic Node pin)
#   PNPM_IMAGE  <- package.json#devEngines.packageManager (pnpm pin + sha512)
# pnpm comes from the official image as recommended by pnpm's Docker guide
# (https://pnpm.io/docker#adding-pnpm-to-your-own-image). Both bases are Debian,
# so the copied standalone binary matches. Everything else in the image is
# resolved from the tracked pnpm-lock.yaml.
ARG NODE_IMAGE=node:26.13.0-slim
ARG PNPM_IMAGE=ghcr.io/pnpm/pnpm:12.16.1
# ─────────────────────────────────────────────────────────────────────────────

########## pnpm — official standalone binary ##########
FROM ${PNPM_IMAGE} AS pnpm

########## toolchain — Node + pnpm ##########
FROM ${NODE_IMAGE} AS toolchain
WORKDIR /app
COPY --from=pnpm /opt/pnpm /opt/pnpm
RUN for bin in pnpm pn pnpx pnx; do ln -s "/opt/pnpm/$bin" "/usr/local/bin/$bin"; done

########## deps — resolve workspace dependencies (root + tests) ##########
FROM toolchain AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tests/package.json tests/package.json
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

########## builder — compile the Next.js standalone output ##########
FROM toolchain AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# Lazy runtime deps (wreq-js, playwright-core) are createRequire-loaded by
# open-sse/services/lazyRuntime.js and omitted by Next's standalone tracing.
# Install the exact versions the lockfile resolved into an isolated flat tree so
# the runner can copy it whole (pnpm's virtual-store symlinks do not survive a
# partial COPY). https://github.com/decolua/9router/issues/5245
RUN --mount=type=cache,target=/root/.npm \
    WREQ_VERSION="$(node -p "require('./node_modules/wreq-js/package.json').version")" && \
    PLAYWRIGHT_VERSION="$(node -p "require('./node_modules/playwright-core/package.json').version")" && \
    mkdir -p /opt/lazy-runtime && cd /opt/lazy-runtime && \
    printf '{"name":"lazy-runtime","private":true}\n' > package.json && \
    npm install --no-audit --no-fund --no-save \
      "wreq-js@${WREQ_VERSION}" "playwright-core@${PLAYWRIGHT_VERSION}"

########## runner — minimal production image ##########
FROM ${NODE_IMAGE} AS runner
ARG NODE_IMAGE
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=20128 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data

ARG REVISION=local
ARG APP_VERSION=unknown
LABEL org.opencontainers.image.title="9router" \
      org.opencontainers.image.source="https://github.com/luthfisolahudin/9router" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.base.name="docker.io/library/${NODE_IMAGE}"

# Distro packages (gosu, ffmpeg) intentionally follow the Debian base rather
# than pinning apt versions, which drift with every base-image rebuild.
# gosu drops privileges to `node` after fixing volume ownership on boot (the
# mounted /app/data may be created by root on the host). ffmpeg backs the Codex
# OAuth STT path (audio conversion), matching upstream's runner.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gosu ffmpeg \
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
# wreq-js + playwright-core (and their native bindings) are lazy-loaded at
# runtime and omitted by tracing. Installed as one flat tree in the builder.
COPY --from=builder --chown=node:node /opt/lazy-runtime/node_modules/. ./node_modules/

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||20128)+'/api/version').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

EXPOSE 20128
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "custom-server.js"]
