#!/usr/bin/env bash
set -euo pipefail

# scripts/fork/smoke-test.sh
# Runs a container startup smoke test against the built docker image.
# Uses temporary isolated data dir and verifies health/HTTP response.

IMAGE_REF="${1:-}"
CONTAINER_PORT="${2:-20128}"
CONTAINER_NAME="9router-smoke-test-$$"

if [[ -z "$IMAGE_REF" ]]; then
  echo "Usage: $0 <image_reference> [port]"
  exit 1
fi

TMP_DATA_DIR="$(mktemp -d)"
cleanup() {
  echo "==> Cleaning up container and temporary directory..."
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -rf "$TMP_DATA_DIR" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> Running smoke test for ${IMAGE_REF} using data dir ${TMP_DATA_DIR}..."

# Find a free host port
FREE_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("", 0)); print(s.getsockname()[1]); s.close()')

# Run container with temporary volume
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "${FREE_PORT}:${CONTAINER_PORT}" \
  -e PORT="${CONTAINER_PORT}" \
  -e HOSTNAME="0.0.0.0" \
  -e DATA_DIR="/app/data" \
  -e INITIAL_PASSWORD="smoke-password" \
  -e REQUIRE_API_KEY="false" \
  -e ENABLE_REQUEST_LOGS="false" \
  -v "${TMP_DATA_DIR}:/app/data" \
  "$IMAGE_REF"

echo "==> Waiting for container to start on port ${FREE_PORT}..."
MAX_ATTEMPTS=30
SUCCESS=false

for i in $(seq 1 $MAX_ATTEMPTS); do
  if docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q "true"; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${FREE_PORT}/" || echo "000")
    if [[ "$HTTP_CODE" =~ ^(200|302|307|308|401|403)$ ]]; then
      echo "==> Service responded with HTTP ${HTTP_CODE} on attempt ${i}."
      SUCCESS=true
      break
    fi
  else
    echo "Container is not running! Inspecting logs:"
    docker logs "$CONTAINER_NAME" || true
    exit 1
  fi
  sleep 2
done

if [[ "$SUCCESS" != "true" ]]; then
  echo "==> Smoke test failed: container did not respond with expected HTTP status within $((MAX_ATTEMPTS * 2))s."
  echo "==> Container logs:"
  docker logs "$CONTAINER_NAME" || true
  exit 1
fi

echo "==> Smoke test passed successfully!"
