---
name: sync-upstream
description: Modes: assess · rebase · verify · promote. Standard workflow to inspect upstream releases, audit blast radius on fork-specific patches, rebase cleanly, run regression tests, and promote builds for 9router. Load when asked to check upstream, sync/update fork, resolve upstream conflicts, or verify new releases.
---

# Sync Upstream

**Inspect, rebase, and verify upstream updates while strictly preserving fork-specific patches.**

## When to use

Load when checking upstream releases, syncing the fork with upstream master/tags, assessing patch compatibility, or troubleshooting post-update behavior (such as version mismatches in the dashboard).

## Decision tree — pick a mode

- "What's new upstream?", "compare version", "check updates" -> **assess** (default)
- "Update/sync with upstream", "rebase on upstream" -> **rebase**
- "Run tests on rebase", "verify update" -> **verify**
- "Push synced fork", "promote build", "deploy update" -> **promote**

---

## Workflow

### 1. assess (inspection & blast radius check)

1. **Verify remotes**:
   Ensure `upstream` points to `https://github.com/decolua/9router.git` and fetch latest refs:
   ```bash
   git remote get-url upstream 2>/dev/null || git remote add upstream https://github.com/decolua/9router.git
   git fetch upstream --tags
   ```

2. **Inspect divergence**:
   Check what fork patches exist and what upstream commits are incoming:
   ```bash
   # Fork-specific patches that MUST be preserved:
   git log upstream/master..HEAD --oneline

   # Incoming upstream changes:
   git log HEAD..upstream/master --oneline
   ```

3. **Audit blast radius**:
   Check if incoming upstream commits touch any files modified by fork-specific patches:
   ```bash
   FORK_FILES=$(git diff --name-only upstream/master...HEAD)
   if [[ -n "$FORK_FILES" ]]; then
     git log HEAD..upstream/master --oneline -- $FORK_FILES
   fi
   ```
   Report findings clearly to the user before modifying git state.

---

### 2. rebase (safe integration)

1. **Rebase onto upstream**:
   ```bash
   git rebase upstream/master
   ```

2. **Handle conflicts**:
   - Never drop or silently discard fork-specific patches.
   - If conflicts arise, inspect the intention of the fork patch and resolve conflicts conservatively.
   - Stage resolved files and continue: `git rebase --continue`.

3. **Confirm patch preservation**:
   Verify all fork-specific patches remain intact on top of the rebased upstream master:
   ```bash
   git log upstream/master..HEAD --oneline
   ```

---

### 3. verify (regression tests & build)

1. **Install dependencies**:
   ```bash
   npm install && npm --prefix tests install
   ```

2. **Run regression tests**:
   Execute critical translation and provider regression test suites:
   ```bash
   npm --prefix tests exec vitest run --config vitest.config.js translator/gemini-tool-result.test.js translator/bugs-antigravity.test.js
   ```

3. **Verify application build**:
   ```bash
   npm run build
   ```

---

### 4. promote (metadata update, push & deploy)

1. **Update fork metadata**:
   Sync `.github/fork-metadata.json` with the latest upstream tag, commit SHA, and ISO timestamp:
   ```json
   {
     "upstream_repo": "https://github.com/decolua/9router.git",
     "base_tag": "<LATEST_TAG>",
     "base_commit": "<LATEST_COMMIT_SHA>",
     "synced_tag": "<LATEST_TAG>",
     "synced_commit": "<LATEST_COMMIT_SHA>",
     "last_sync_utc": "<ISO_TIMESTAMP_UTC>"
   }
   ```

2. **Push to fork repository**:
   Push the rebased master with lease protection:
   ```bash
   git push --force-with-lease origin master
   ```

3. **Verify runtime & cache handling**:
   - Check local container / server status: `curl -s http://127.0.0.1:20128/api/version`
   - **Dashboard cache notice**: If the browser UI displays an older version tag while `/api/version` reports the new version, perform a browser hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`) to bust cached static assets.

---

## Invariants

- **Never discard fork-specific patches**: Dynamically inspect fork commits (`upstream/master..HEAD`) — do not assume a hardcoded list.
- **Fail-closed verification**: Never push without successful test runs and clean build verification.
- **Atomic metadata sync**: Keep `.github/fork-metadata.json` consistent with the actual upstream commit synced.
