# FORK.md — Why this fork exists

This is a **tracking fork of [decolua/9router](https://github.com/decolua/9router)**, maintained by
@luthfisolahudin. It exists for one reason: **run 9Router in production (24/7 Docker deployment)
with a small set of deliberate behavior patches, while continuously tracking upstream releases.**

It is *not* a feature fork. The intended end state is to carry as little divergence as upstream
accepts or necessity demands. Every patch below exists to serve the owner's actual deployment, and
any agent working here must preserve them across syncs.

**AI agents: read `AGENTS.md` for code orientation (architecture, commands, gotchas; `CLAUDE.md` is
a symlink to it) and this file for fork intent. When the two conflict on fork matters, this file
wins.** Maintenance procedures live in `.agents/skills/fork-stewardship/SKILL.md`.

---

## The one invariant

> **Never lose a fork patch.** On every upstream sync, all fork-specific commits and their intent
> must survive — rebase them onto the new upstream base, resolve conflicts conservatively, run the
> regression tests and `npm run build`, and only then push. Push is gated on green verification
> (fail-closed). See `.agents/skills/sync-upstream/SKILL.md` for the full procedure.

`.github/fork-metadata.json` records the upstream tag/commit this fork is currently synced to. It is
the source of truth for both the sync automation and the release pipeline's image tags.

## Fork patches (and why they exist)

| Area | Patch | Why it's divergent |
|---|---|---|
| antigravity | Normalize contents to drop empty reasoning-only turns; reject empty normalized history | Upstream accepted empty reasoning-only turns, which broke the owner's client sessions. |
| claude | Map assistant `reasoning_content` → Claude thinking blocks; avoid forged thinking signatures | Keeps reasoning streams intact for Claude-protocol clients without fabricating signature blocks. |
| gemini | Preserve JSON-Schema tool results as text (`serializeGeminiToolResult`) | Gemini 3 rejects local `$ref` pointers in structured function responses. |
| Dockerfile | Use default registries (Alpine CDN, npmjs) — no CN mirrors | Mirrors are unreliable from GitHub runners (caused repeated build failures); nothing fetches packages at runtime, so they buy nothing here. |
| Containerfile | Fork-owned build file on `node:24-slim` (upstream's `Dockerfile` is deleted) | glibc base for prebuilt native bindings, corepack/pnpm, reproducible frozen installs, HEALTHCHECK, OCI labels. Upstream Dockerfile changes conflict as modify/delete → `git rm Dockerfile` and port meaningful fixes by hand. |

**Patch verdicts, re-evaluated against upstream v0.5.69 (2026-09-06): every behavior patch above is
still necessary — none has an upstream equivalent.** Re-run this evaluation every sync per the
`fork-stewardship` skill; drop a patch only on verified upstream equivalence.

## Toolchain (fork-owned)

- **Package manager**: pnpm 12 via **corepack** (`packageManager` field in `package.json`; corepack
  ships with Node 24). Single `pnpm-lock.yaml` (tracked) covers the root app and `tests/` as one
  workspace — installs use `--frozen-lockfile` everywhere, so builds are reproducible. The stale,
  gitignored npm lockfiles are gone.
- **Supply-chain policy**: `minimumReleaseAge: 10080` (7 days) in `pnpm-workspace.yaml` — new
  dependency versions must be published ≥7 days before they can be resolved. **Strict**: when
  upstream bumps a dep to a too-fresh version, the sync install fails until it ages out — wait and
  re-run; do not waive. Dependency lifecycle scripts run only for the `allowBuilds` allowlist.
- **Node**: current LTS line (24, `.node-version`); CI, local, and the container image all match.
- **Release audit gate**: `pnpm audit --prod --audit-level high` fails the release on high/critical
  advisories in shipped dependencies.
| tests | Golden `url-header` snapshots normalize app version (`<APP_VERSION>` placeholders) | Version bumps must not break the fork's golden header lock on every sync. |
| infra | Everything under `.github/workflows/fork-*`, `scripts/fork/`, `.agents/skills/sync-upstream/` | Fork CI/CD and sync automation (see below). Upstream will never ship these. |

## Pipelines (one job each, no overlap)

1. **`fork-release.yml` — the only path to production.**
   `validate` (pnpm frozen install, regression tests, prod-dependency audit, `npm run build` via
   pnpm) → `build` (native amd64 on `ubuntu-latest`, native arm64 on `ubuntu-24.04-arm`, built from
   `Containerfile`, pushed by digest, persistent registry buildcache per arch) → `release` (merge
   digests into one multi-arch manifest, smoke-test that exact digest, promote it to `production`
   while backing up the old one as `production-previous`).
   Runs on every push to master and on `workflow_dispatch`. PRs run `validate` only.
2. **`fork-sync-upstream.yml` — upstream awareness, zero image building.**
   Daily (`17 3 * * *`) it checks upstream for a new stable semver tag
   (`scripts/fork/check-upstream-tag.py`). Clean sync → opens a sync PR, runs regression tests on
   the merged tree, auto-merges it (the merge push triggers Fork Release). Conflicted sync →
   opens/updates a `Manual sync needed:` issue with the conflicting files, instead of failing with a
   bare red X; the issue auto-closes once a later sync succeeds.
3. **`fork-rollback.yml` — manual retag only.**
   Point `production` back at `production-previous` (or any digest). No rebuild.

Image tags: `<upstream_tag>` (e.g. `v0.5.69`) and `sha-<8 chars>` are immutable; `production` /
`production-previous` are mutable promotion tags. Watchtower watches `production`.

## Deployment topology

- The owner's server runs this very repo checkout; `~/compose.yaml` defines the `9router` service
  from `ghcr.io/luthfisolahudin/9router:production` (Watchtower-enabled label, port `127.0.0.1:20128`,
  data at `~/.local/share/9router`).
- After a release run promotes a new image, deploy with
  `docker compose pull 9router && docker compose up -d 9router` and check
  `curl -s http://127.0.0.1:20128/api/version`. If the dashboard shows an older version than the
  API, hard-reload the browser to bust cached static assets.

## One-time GitHub settings this automation depends on

- **Actions → General → Workflow permissions**: Read and write; allow Actions to create PRs.
- **GHCR package `9router`**: visibility **Public** so Watchtower pulls without credentials.
- Scheduled workflows on public forks are auto-disabled after **60 days without commits** — syncs
  themselves produce commits, but if schedules pause, re-enable the workflow in the Actions tab.

## Pointers

- Code orientation: `AGENTS.md` (`CLAUDE.md` symlinks to it) · System design: `docs/ARCHITECTURE.md` · Engine conventions: `open-sse/AGENTS.md`
- Procedures: `.agents/skills/sync-upstream/SKILL.md` (sync) · `.agents/skills/fork-stewardship/SKILL.md` (patch re-evaluation, fingerprint freshness, conflict playbooks)
- Synced baseline: `.github/fork-metadata.json`
- Fork scripts: `scripts/fork/` (`check-upstream-tag.py`, `create-sync-pr.sh`, `promote-image.sh`, `rollback-image.sh`, `smoke-test.sh`)
