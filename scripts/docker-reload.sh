#!/usr/bin/env bash
set -euo pipefail

# Rebuild and restart only the app containers (backend + frontend)
# with latest code. Data services (mongo, minio) and their volumes
# are left untouched — no data loss.

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

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4100/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5177}"

wait_for_http_contains() {
  local url="$1" needle="$2" name="$3" timeout_seconds="$4"
  local started_at body
  started_at="$(date +%s)"
  while (( "$(date +%s)" - started_at < timeout_seconds )); do
    body="$(curl -fsSL "$url" 2>/dev/null || true)"
    if [[ "$body" == *"$needle"* ]]; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for $name at $url" >&2
  return 1
}

echo "Rebuilding backend and frontend containers..."
"${COMPOSE_CMD[@]}" up -d --build --force-recreate backend frontend

echo "Waiting for backend health..."
wait_for_http_contains "$BACKEND_HEALTH_URL" "\"ready\":true" "backend" 300

echo "Waiting for frontend..."
wait_for_http_contains "$FRONTEND_URL" "<html" "frontend" 120

echo "Reload complete. Data volumes preserved."
