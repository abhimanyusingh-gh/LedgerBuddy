#!/usr/bin/env bash
set -euo pipefail

# Rebuild and restart only the app containers (backend + frontend)
# with latest code. Data services (mongo, minio) and their volumes
# are left untouched — no data loss.
#
# Prerequisites: the full stack must already be running (yarn docker:up).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is required." >&2
  exit 1
fi

# Verify infrastructure services are running before reload
REQUIRED_SERVICES=(mongo minio local-sts)
for svc in "${REQUIRED_SERVICES[@]}"; do
  if ! "${COMPOSE_CMD[@]}" ps --status running --format '{{.Service}}' 2>/dev/null | grep -q "^${svc}$"; then
    echo "Error: '$svc' is not running. Start the full stack first: yarn docker:up" >&2
    exit 1
  fi
done

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4100/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5177}"

# Build images first (no timeout pressure)
echo "Building backend and frontend images..."
"${COMPOSE_CMD[@]}" build backend frontend

# Swap containers (fast — images already built)
echo "Recreating containers..."
"${COMPOSE_CMD[@]}" up -d --no-deps --force-recreate backend frontend

# Wait for backend health
echo "Waiting for backend..."
elapsed=0
while (( elapsed < 120 )); do
  body="$(curl -fsSL "$BACKEND_HEALTH_URL" 2>/dev/null || true)"
  if [[ "$body" == *'"ready":true'* ]]; then
    echo "Backend ready."
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
if (( elapsed >= 120 )); then
  echo "Backend did not become ready within 120s. Recent logs:" >&2
  "${COMPOSE_CMD[@]}" logs --tail 30 backend >&2
  exit 1
fi

# Wait for frontend
echo "Waiting for frontend..."
elapsed=0
while (( elapsed < 60 )); do
  body="$(curl -fsSL "$FRONTEND_URL" 2>/dev/null || true)"
  if [[ "$body" == *"<html"* ]]; then
    echo "Frontend ready."
    break
  fi
  sleep 2
  elapsed=$((elapsed + 2))
done
if (( elapsed >= 60 )); then
  echo "Frontend did not become ready within 60s. Recent logs:" >&2
  "${COMPOSE_CMD[@]}" logs --tail 30 frontend >&2
  exit 1
fi

echo "Reload complete. Data volumes preserved."
