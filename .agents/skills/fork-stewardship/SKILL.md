---
name: fork-stewardship
description: "Modes: re-evaluate · fingerprint · playbooks. Keeps the 9router fork's divergences deliberate and minimal: per-sync patch re-evaluation against upstream (keep/drop/consolidate with evidence), Antigravity agy CLI fingerprint freshness runbook, and sync-conflict playbooks (deleted Dockerfile, CLAUDE.md symlink, strict minimumReleaseAge waits). Load when asked whether a fork patch is still needed, to review or update fork patches, when the agy fingerprint may be stale, or alongside sync-upstream on every upstream sync. NOT for the sync/rebase procedure itself (use sync-upstream) or for general code orientation (use AGENTS.md and FORK.md)."
---

# Skill: Fork Stewardship

**Keep the fork's divergences deliberate, minimal, and alive — or let them die gracefully.**

## When to use

- Before or during any upstream sync (pairs with the `sync-upstream` skill).
- When asked whether a fork patch is still needed ("is X still required?", "why do we patch Y?").
- When the Antigravity/`agy` client fingerprint may be stale (upstream rejected requests, quota/anti-abuse errors, or after the agy CLI updates).
- Periodically (every few upstream tags) as a standing health check.

## The one rule

**Never lose a fork patch silently. Patches are dropped only on evidence that upstream now ships an
equivalent — verified by running this fork's tests against upstream's code.** This fork carries its
patches by owner decision: **do not open upstream PRs**; the fork is deliberately self-contained.

## 1. Per-sync patch re-evaluation

Run this for each patch in the inventory (see FORK.md for the charter-level WHY):

1. List current patches: `git log upstream/master..HEAD --oneline` (ignore `ci(fork)`, `chore(sync)`,
   `test(translator)` housekeeping commits — those are infrastructure, not behavior patches).
2. For each behavior patch, check whether upstream now ships an equivalent:
   `git grep <marker> upstream/master -- <files the patch touches>`
   (e.g. `git grep reasoning_content upstream/master -- open-sse/translator/request/openai-to-claude.js`,
   `git grep serializeGeminiToolResult upstream/master -- open-sse/translator/request/openai-to-gemini.js`,
   `git grep "antigravity/cli" upstream/master -- open-sse/providers/shared.js`).
3. Check upstream commits touching the same files since the last sync:
   `git log <last-synced-tag>..upstream/master --oneline -- <patched files>`.
4. Verdict per patch: **KEEP** (no upstream equivalent) / **DROP** (upstream equivalent exists AND
   the fork test suite passes on the rebased tree with the patch reverted) / **CONSOLIDATE**
   (upstream has a near-equivalent — rebase the patch onto upstream's shape to shrink the diff).

Evidence goes in the sync commit message (one line per verdict). Never revert a patch without
running: `pnpm run build` and the full translator test suite — a dropped patch must show zero
new failures against the pre-existing baseline.

## 2. Antigravity client fingerprint freshness

The fork matches the official macOS Antigravity IDE Desktop fingerprint in `open-sse/providers/shared.js`:

- `ANTIGRAVITY_IDE_USER_AGENT` — `antigravity/ide/2.11.0 darwin/arm64`
- `ANTIGRAVITY_IDE_VERSION` — `2.11.0`

When upstream bumps the official IDE fingerprint or Google releases a new stable Antigravity IDE version on macOS:
1. Update `ANTIGRAVITY_IDE_VERSION` and `ANTIGRAVITY_IDE_USER_AGENT` in `open-sse/providers/shared.js`.
2. Verify: `pnpm -C tests exec vitest run unit/antigravity-retry-hook.test.js unit/antigravity-usage-headers.test.js`
   and `node tests/__baseline__/verify-providers.mjs`.

## 3. Keep/drop criteria (decision table)

| Signal | Action |
|---|---|
| Upstream ships an equivalent and fork tests pass without our patch | DROP the patch (document in sync commit) |
| Upstream ships a partial equivalent | CONSOLIDATE — rebase our patch onto upstream's shape, shrink the diff |
| Patch guards against an upstream regression (e.g. forged signatures) | KEEP; re-check every sync |
| Antigravity client fingerprint | Keep aligned with latest stable macOS Antigravity IDE per §2 |
| Patch's failure mode no longer occurs and no upstream equivalent exists | KEEP — absence of symptoms is not evidence |

## 4. Sync-conflict playbooks

- **Upstream modifies their `Dockerfile`** (we deleted it in favor of `Containerfile`):
  resolve modify/delete conflicts as `git rm Dockerfile`; port any meaningful upstream fix into
  `Containerfile` by hand.
- **Upstream modifies `CLAUDE.md`** (ours is a symlink to `AGENTS.md`): take upstream's content
  changes into `AGENTS.md`, then restore the symlink (`ln -sf AGENTS.md CLAUDE.md`).
- **Upstream dependency bumps younger than 7 days**: `pnpm install` fails with a
  `minimumReleaseAge` error. Per owner decision this is strict — wait for the versions to age out
  and re-run the sync. Do not waive the policy and do not grow `minimumReleaseAgeExclude` without
  asking the owner.
- **Upstream adds a new workflow/CI file**: fork CI is fork-owned; upstream files under
  `.github/workflows/` are restored by `create-sync-pr.sh` policy only for `workflows` it knows —
  review `git status` after a sync for resurrected upstream workflows (e.g. `gitbook-pages.yml`,
  `docker-publish.yml`) and delete them again if they can only fail on the fork.

## 5. Standing health check (every few upstream tags)

1. Full suite: `pnpm -C tests exec vitest run` — compare failure list against the pre-existing
   baseline (~120 known fails that also fail on pure upstream). New failures = fork regression.
2. `pnpm audit --prod --audit-level high` — release gate locally before pushing.
3. Re-run the re-evaluation in §1 and refresh FORK.md's verdict table if anything changed.
