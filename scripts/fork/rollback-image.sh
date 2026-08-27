#!/usr/bin/env bash
set -euo pipefail

# scripts/fork/rollback-image.sh
# Performs manual or automated rollback:
# Restores 'production' tag in GHCR from 'production-previous' without rebuilding any images.

REGISTRY="${1:-ghcr.io}"
REPO="${2:-}"

if [[ -z "$REPO" ]]; then
  echo "Usage: $0 <registry> <repo>"
  echo "Example: $0 ghcr.io luthfisolahudin/9router"
  exit 1
fi

IMAGE_BASE="${REGISTRY}/${REPO}"
PROD_TAG="${IMAGE_BASE}:production"
PREV_TAG="${IMAGE_BASE}:production-previous"

echo "==> Initiating rollback: restoring ${PROD_TAG} from ${PREV_TAG}..."

# Check if production-previous exists
if ! docker buildx imagetools inspect "$PREV_TAG" >/dev/null 2>&1; then
  echo "Error: ${PREV_TAG} does not exist in registry! Cannot rollback."
  exit 1
fi

PREV_DIGEST=$(docker buildx imagetools inspect "$PREV_TAG" 2>/dev/null | grep -i "^Digest:" | awk '{print $2}' || true)
echo "==> Found production-previous digest: ${PREV_DIGEST:-unknown}"

# Promote production-previous to production
echo "==> Pointing ${PROD_TAG} to ${PREV_TAG}..."
docker buildx imagetools create --tag "$PROD_TAG" "$PREV_TAG"

echo "==> Rollback complete! ${PROD_TAG} now points to the previous production image (${PREV_DIGEST:-$PREV_TAG})."
