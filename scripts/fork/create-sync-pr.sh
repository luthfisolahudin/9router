#!/usr/bin/env bash
set -euo pipefail

# scripts/fork/create-sync-pr.sh
# Merges a target upstream tag into a candidate branch so local patches are
# retained or conflict visibly, then opens an auditable pull request.

TARGET_TAG="${1:-}"
TARGET_COMMIT="${2:-}"
UPSTREAM_REPO="${3:-https://github.com/decolua/9router.git}"

if [[ -z "$TARGET_TAG" || -z "$TARGET_COMMIT" ]]; then
  echo "Usage: $0 <target_tag> <target_commit> [upstream_repo]"
  exit 1
fi

BRANCH_NAME="sync/upstream-${TARGET_TAG}"
echo "==> Preparing sync PR for ${TARGET_TAG} (${TARGET_COMMIT}) on branch ${BRANCH_NAME}..."

# Configure git committer if in GitHub Actions
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
  git config user.name "github-actions[bot]"
  git config user.email "github-actions[bot]@users.noreply.github.com"
fi

# Fetch the upstream commit/tag
git fetch "$UPSTREAM_REPO" "refs/tags/${TARGET_TAG}:refs/tags/${TARGET_TAG}" || git fetch "$UPSTREAM_REPO" "${TARGET_COMMIT}"

DEFAULT_BRANCH="${GITHUB_REF_NAME:-master}"
git checkout -B "$BRANCH_NAME" "origin/${DEFAULT_BRANCH}"
git merge --no-ff --no-commit "$TARGET_COMMIT"

# Fork automation is policy, not upstream application source. Keep the reviewed
# versions while allowing application files and the Gemini patch to merge normally.
git checkout "origin/${DEFAULT_BRANCH}" -- .github/workflows scripts/fork
git commit -m "chore(sync): merge upstream ${TARGET_TAG}"

# Update fork metadata JSON
python3 -c "
import json, datetime
meta_path = '.github/fork-metadata.json'
try:
    with open(meta_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
except Exception:
    data = {}

data['upstream_repo'] = '$UPSTREAM_REPO'
data['synced_tag'] = '$TARGET_TAG'
data['synced_commit'] = '$TARGET_COMMIT'
data['last_sync_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()

with open(meta_path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
"

git add .github/ scripts/fork/ docs/ 2>/dev/null || true

# Commit changes if any
if ! git diff --cached --quiet; then
  git commit -m "chore(sync): sync upstream ${TARGET_TAG} (${TARGET_COMMIT}) and preserve fork automation"
else
  echo "No changes after restoring fork-owned files."
fi

# Push sync branch
echo "==> Pushing branch ${BRANCH_NAME}..."
git push -u origin "$BRANCH_NAME" --force-with-lease

# Check if PR already exists
PR_TITLE="chore(sync): sync upstream ${TARGET_TAG}"
PR_BODY="Automated upstream sync PR from \`${UPSTREAM_REPO}\` tag \`${TARGET_TAG}\` (\`${TARGET_COMMIT}\`).

### Fork Protections Applied:
- Preserved all fork GitHub Actions workflows under \`.github/workflows/\`
- Preserved fork automation scripts under \`scripts/fork/\`
- Updated \`.github/fork-metadata.json\`
- CI validation will run regression tests, Docker build, and container smoke test before merge."

EXISTING_PR=$(gh pr list --head "$BRANCH_NAME" --json number --jq '.[0].number' 2>/dev/null || echo "")

if [[ -n "$EXISTING_PR" ]]; then
  echo "==> Updating existing PR #${EXISTING_PR}..."
  gh pr edit "$EXISTING_PR" --title "$PR_TITLE" --body "$PR_BODY"
  PR_NUMBER="$EXISTING_PR"
else
  echo "==> Creating new PR..."
  PR_URL=$(gh pr create --title "$PR_TITLE" --body "$PR_BODY" --base "$DEFAULT_BRANCH" --head "$BRANCH_NAME")
  PR_NUMBER="${PR_URL##*/}"
fi

printf '%s\n' "$PR_NUMBER" > /tmp/fork-sync-pr-number
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'candidate_sha=%s\n' "$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
fi

echo "==> Sync PR successfully prepared."
