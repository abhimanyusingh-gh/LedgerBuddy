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
REQUIRED_SERVICES=(mongo minio keycloak)
for svc in "${REQUIRED_SERVICES[@]}"; do
  if ! "${COMPOSE_CMD[@]}" ps --status running --format '{{.Service}}' 2>/dev/null | grep -q "^${svc}$"; then
    echo "Error: '$svc' is not running. Start the full stack first: yarn docker:up" >&2
    exit 1
  fi
done

BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4100/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5177}"
OCR_HEALTH_URL="${OCR_HEALTH_URL:-http://127.0.0.1:8200/health}"
SLM_HEALTH_URL="${SLM_HEALTH_URL:-http://127.0.0.1:8300/health}"
RUN_DIR="$ROOT_DIR/.local-run"
PYTHON_BIN="$ROOT_DIR/.venv-ml/bin/python"

ensure_native_service() {
  local name="$1" health_url="$2" pid_file="$3" port="$4" app_dir="$5"
  if curl -fsS "$health_url" >/dev/null 2>&1; then
    echo "$name is running."
    return 0
  fi
  echo "$name is not running. Starting..."
  if [[ ! -x "$PYTHON_BIN" ]]; then
    echo "Error: Python venv not found at $PYTHON_BIN. Run yarn docker:up first." >&2
    return 1
  fi
  "$PYTHON_BIN" scripts/start-detached.py \
    --pid-file "$pid_file" --log-file "$RUN_DIR/${name,,}.log" --cwd "$ROOT_DIR" -- \
    "$PYTHON_BIN" -m uvicorn app.api:app --app-dir "$app_dir" --host 0.0.0.0 --port "$port" >/dev/null 2>&1
  local timeout=120 elapsed=0
  while (( elapsed < timeout )); do
    if curl -fsS "$health_url" >/dev/null 2>&1; then
      echo "$name ready."
      return 0
    fi
    sleep 3
    elapsed=$((elapsed + 3))
  done
  echo "Warning: $name did not become ready within ${timeout}s." >&2
}

mkdir -p "$RUN_DIR"
ensure_native_service "OCR" "$OCR_HEALTH_URL" "$RUN_DIR/ocr.pid" 8200 ocr
ensure_native_service "SLM" "$SLM_HEALTH_URL" "$RUN_DIR/slm.pid" 8300 slm

# Build all images with no cache (backend, frontend, OCR proxy, SLM proxy)
echo "Building images (no cache)..."
"${COMPOSE_CMD[@]}" build --no-cache backend frontend ocr slm

# Swap containers
echo "Recreating containers..."
"${COMPOSE_CMD[@]}" up -d --no-deps --force-recreate backend frontend ocr slm

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
