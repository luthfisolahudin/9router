# AGENTS.md

Guidance for AI coding agents working in this repository. For fork intent and maintenance
procedures, read `FORK.md` and `.agents/skills/fork-stewardship/SKILL.md` first.

## What this is

9Router (`9router-app`) — a local AI routing gateway + Next.js dashboard. It exposes one OpenAI-compatible endpoint (`/v1/*`) and routes traffic across 40+ upstream providers with format translation, model-combo fallback, multi-account fallback, OAuth/API-key credential management, token refresh, quota/usage tracking, and optional cloud sync.

Two published artifacts live in this one repo:
- The **dashboard + gateway** (root `package.json`, `9router-app`) — the Next.js server that does the actual routing.
- The **CLI launcher** (`cli/`, published to npm as `9router`) — a separate package that installs/starts the server and manages the tray. It has its own `package.json`, version, and build.

## Commands

The fork uses **pnpm 12 via corepack** (pinned in `package.json#packageManager`; corepack ships with
Node 24). One `pnpm-lock.yaml` covers the root app and `tests/` as a single workspace. Node LTS is
pinned via `.node-version`. New dependency versions must be ≥7 days old (`minimumReleaseAge` in
`pnpm-workspace.yaml`) — installs failing on that error are the supply-chain policy working.

Dashboard/gateway (run from repo root):
```bash
cp .env.example .env
corepack enable            # once; makes `pnpm` available
pnpm install --frozen-lockfile
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 pnpm run dev   # next dev on port 20127 (the script pins --port); webpack via dev:webpack
pnpm run build && PORT=20128 HOSTNAME=0.0.0.0 node custom-server.js --port 20128   # production
```
- Bun variants exist (`pnpm run dev:bun` / `build:bun` / `start:bun`) but are upstream's path — the fork builds/tests with pnpm.
- Default runtime port is **20128** (dashboard at `/dashboard`, API at `/v1`).
- Lint: `pnpm exec eslint .` (config `eslint.config.mjs`, extends `eslint-config-next`).
- Dependency audit (release gate): `pnpm audit --prod --audit-level high`.

CLI package (`cli/`) stays on npm (upstream's published distribution channel — don't pnpm-ify it):
```bash
npm run cli:pack       # build + npm pack from root
cd cli && npm run dev  # nodemon watch
```

Tests (vitest, in `tests/` — a workspace member; one root `pnpm install` covers it):
```bash
pnpm -C tests exec vitest run                            # all tests; auto-discovers tests/vitest.config.js
pnpm -C tests exec vitest run unit/capabilities.test.js  # single file (path relative to tests/)
```
> Use the `pnpm -C tests exec vitest` form — the `tests/package.json` `test` script hardcodes
> upstream's `NODE_PATH=/tmp/node_modules` workaround and should be bypassed. The same form replaces
> the `cd app && npx vitest` commands in upstream's `tests/translator/AGENTS.md`
> (`pnpm -C tests exec vitest run translator/`).
>
> The suite is red on a plain checkout; these failures occur on pure upstream too. Expected red:
> - The pre-existing cluster: kiro-direct translator shape, cursor protobuf codec, saml (empty file), db-benchmark, embeddings.cloud, and friends.
> - `unit/embeddings.cloud.test.js` imports `cloud/src/handlers/embeddings.js` — the `cloud/` worker dir is **not in this repo**, so it always fails here.
> - `translator/real/*.real.test.js` make live provider calls — need credentials, skip otherwise.
- Regression baselines: `tests/__baseline__/verify-*.mjs` compare against committed snapshots (providers, aliases, OAuth URLs). Run these after touching provider registry / alias logic.

## Architecture

Two authoritative docs already exist — read them before working in these areas rather than re-deriving:
- `docs/ARCHITECTURE.md` — full system: request lifecycle, combo/account fallback, OAuth + token refresh, cloud sync, data model.
- `open-sse/AGENTS.md` — the routing/translation engine's own conventions and "how to add a provider/executor/translator". **Read this before editing anything under `open-sse/`.**

### Request flow (the thing to understand first)
`src/app/api/v1/*` route (Next rewrite maps `/v1/*` → `/api/v1/*` in `next.config.mjs`)
→ `src/sse/handlers/chat.js` (parse, combo expansion, account-selection loop)
→ `open-sse/handlers/chatCore.js` (detect source format, translate request, dispatch to executor, retry/refresh, stream setup)
→ `open-sse/executors/*` (per-provider upstream call; `default.js` handles any OpenAI-compatible provider)
→ `open-sse/translator/*` (client format ↔ provider format)
→ SSE back to client.

`src/sse/` is the app-side entry glue; `open-sse/` is the provider-agnostic engine (also usable standalone). Cross that boundary consciously.

### Persistence — IMPORTANT (ARCHITECTURE.md is stale here)
State is **no longer `db.json`**. It's a SQLite layer under `src/lib/db/` with an adapter fallback chain (`driver.js`): `bun:sqlite` → `better-sqlite3` (optional native dep) → `node:sqlite` (Node ≥22.5) → `sql.js` (pure-JS fallback, always works). `better-sqlite3` is deliberately in `optionalDependencies` so install never fails without build tools.
- `src/lib/localDb.js` is a **backward-compat shim** re-exporting `src/lib/db/index.js`. New code should import from `@/lib/db/index.js`; per-entity logic lives in `src/lib/db/repos/*`. Schema/migrations in `src/lib/db/migrations/`.
- DB file location resolves via `src/lib/db/paths.js` (`DATA_DIR`, else `~/.9router/`).
- Usage/logs (`src/lib/usageDb.js`, `usage.json` + `log.txt`) still live under `~/.9router` and do **not** follow `DATA_DIR`.

## Conventions & gotchas

- Plain JavaScript (ESM), no TypeScript. `@/*` path alias → `src/*` (`jsconfig.json`).
- `custom-server.js` wraps the Next standalone server to derive client IP from the TCP socket and strip attacker-controlled `X-Forwarded-For` — trusting forwarding headers only from a loopback reverse proxy. Preserve this when touching request/IP/rate-limit code.
- Security-sensitive env: `JWT_SECRET` (session cookie), `INITIAL_PASSWORD` (default `123456` — must override), `API_KEY_SECRET`, `MACHINE_ID_SALT`. Full env contract in `.env.example` and ARCHITECTURE.md's env matrix.
- **Security-first on PRs**: Security is the top priority when reviewing or creating PRs. Audit authentication, credential/token storage & leaks, header manipulation (`X-Forwarded-For`), and SSRF risks before functional logic. Always include explicit security warnings/notes when reporting PR reviews or changes to the user.
- Versioning: root and `cli/` are versioned independently; changes are logged in `CHANGELOG.md`. Commit style is Conventional Commits (`fix(translator): …`, `feat(...)`).
