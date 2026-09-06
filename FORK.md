# FORK.md — Why this fork exists

This is a **tracking fork of [decolua/9router](https://github.com/decolua/9router)**, maintained by
@luthfisolahudin. It exists for one reason: **run 9Router in production (24/7 Docker deployment)
with a small set of deliberate behavior patches, while continuously tracking upstream releases.**

It is *not* a feature fork. The intended end state is to carry as little divergence as upstream
accepts or necessity demands. Every patch below exists to serve the owner's actual deployment, and
any agent working here must preserve them across syncs.

**AI agents: read `CLAUDE.md` for code orientation (architecture, commands, gotchas) and this file
for fork intent. When the two conflict on fork matters, this file wins.**

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
| antigravity | Exact `agy` CLI client fingerprint + model IDs | Matches the agy CLI the owner actually uses; deliberately **not** the IDE fingerprint upstream sends. Do not "fix" it back. |
| antigravity | Normalize contents to drop empty reasoning-only turns; reject empty normalized history | Upstream accepted empty reasoning-only turns, which broke the owner's client sessions. |
| claude | Map assistant `reasoning_content` → Claude thinking blocks; avoid forged thinking signatures | Keeps reasoning streams intact for Claude-protocol clients without fabricating signature blocks. |
| gemini | Preserve JSON-Schema tool results as text (`serializeGeminiToolResult`) | Gemini 3 rejects local `$ref` pointers in structured function responses. |
| Dockerfile | Use default registries (Alpine CDN, npmjs) — no CN mirrors | Mirrors are unreliable from GitHub runners (caused repeated build failures); nothing fetches packages at runtime, so they buy nothing here. |
| tests | Golden `url-header` snapshots normalize app version (`<APP_VERSION>` placeholders) | Version bumps must not break the fork's golden header lock on every sync. |
| infra | Everything under `.github/workflows/fork-*`, `scripts/fork/`, `.agents/skills/sync-upstream/` | Fork CI/CD and sync automation (see below). Upstream will never ship these. |

## Pipelines (one job each, no overlap)

1. **`fork-release.yml` — the only path to production.**
   `validate` (tests + `npm run build`, no docker) → `build` (native amd64 on `ubuntu-latest`,
   native arm64 on `ubuntu-24.04-arm`, pushed by digest, persistent registry buildcache per arch)
   → `release` (merge digests into one multi-arch manifest, smoke-test that exact digest, promote
   it to `production` while backing up the old one as `production-previous`).
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

- Code orientation: `CLAUDE.md` · System design: `docs/ARCHITECTURE.md` · Engine conventions: `open-sse/AGENTS.md`
- Sync procedure: `.agents/skills/sync-upstream/SKILL.md` · Synced baseline: `.github/fork-metadata.json`
- Fork scripts: `scripts/fork/` (`check-upstream-tag.py`, `create-sync-pr.sh`, `promote-image.sh`, `rollback-image.sh`, `smoke-test.sh`)
