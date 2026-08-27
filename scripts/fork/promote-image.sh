#!/usr/bin/env bash
set -euo pipefail

# scripts/fork/promote-image.sh
# Promotes an existing image manifest/digest in GHCR:
# 1. Retrieves current digest for 'production' tag (if it exists).
# 2. If 'production' exists, tags that current digest as 'production-previous'.
# 3. Tags the target immutable version/digest as 'production'.
# Avoids rebuilding images.

REGISTRY="${1:-ghcr.io}"
REPO="${2:-}"
TARGET_REF="${3:-}" # can be tag (e.g. v0.5.55 or commit SHA) or full image ref

if [[ -z "$REPO" || -z "$TARGET_REF" ]]; then
  echo "Usage: $0 <registry> <repo> <target_ref>"
  echo "Example: $0 ghcr.io luthfisolahudin/9router v0.5.55"
  exit 1
fi

IMAGE_BASE="${REGISTRY}/${REPO}"
TARGET_IMAGE="${IMAGE_BASE}:${TARGET_REF}"
if [[ "$TARGET_REF" =~ ^sha256: || "$TARGET_REF" =~ @sha256: ]]; then
  if [[ "$TARGET_REF" =~ ^sha256: ]]; then
    TARGET_IMAGE="${IMAGE_BASE}@${TARGET_REF}"
  else
    TARGET_IMAGE="${TARGET_REF}"
  fi
fi

PROD_TAG="${IMAGE_BASE}:production"
PREV_TAG="${IMAGE_BASE}:production-previous"

echo "==> Promoting ${TARGET_IMAGE} to ${PROD_TAG}..."

# Step 1: Check if current production tag exists
CURRENT_PROD_DIGEST=""
if docker buildx imagetools inspect "$PROD_TAG" --raw >/tmp/current_prod_manifest.json 2>/dev/null; then
  # Compute or extract digest
  CURRENT_PROD_DIGEST=$(docker buildx imagetools inspect "$PROD_TAG" 2>/dev/null | grep -i "^Digest:" | awk '{print $2}' || true)
  echo "==> Current production tag found with digest: ${CURRENT_PROD_DIGEST:-unknown}"
else
  echo "==> No existing production tag found. Skipping production-previous backup."
fi

# Step 2: Backup existing production to production-previous if found
if [[ -n "$CURRENT_PROD_DIGEST" ]]; then
  echo "==> Backing up current production digest ${CURRENT_PROD_DIGEST} to ${PREV_TAG}..."
  docker buildx imagetools create --tag "$PREV_TAG" "${IMAGE_BASE}@${CURRENT_PROD_DIGEST}"
elif docker buildx imagetools inspect "$PROD_TAG" >/dev/null 2>&1; then
  echo "==> Backing up current production tag to ${PREV_TAG}..."
  docker buildx imagetools create --tag "$PREV_TAG" "$PROD_TAG"
fi

# Step 3: Promote target image/digest to production
echo "==> Promoting target image to ${PROD_TAG}..."
docker buildx imagetools create --tag "$PROD_TAG" "$TARGET_IMAGE"

echo "==> Promotion complete. ${PROD_TAG} is now pointing to ${TARGET_IMAGE}."
