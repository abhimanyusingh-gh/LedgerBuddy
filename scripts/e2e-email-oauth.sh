#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is required. Install 'docker compose' plugin or 'docker-compose' binary." >&2
  exit 1
fi

E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:4100}"
PINNED_SLM_MODEL_ID="mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit"
E2E_OCR_HEALTH_URL="${E2E_OCR_HEALTH_URL:-http://127.0.0.1:8200/health}"
E2E_SLM_HEALTH_URL="${E2E_SLM_HEALTH_URL:-http://127.0.0.1:8300/health}"
E2E_MAILHOG_WRAPPER_URL="${E2E_MAILHOG_WRAPPER_URL:-http://127.0.0.1:8126}"
E2E_EMAIL_USERNAME="${E2E_EMAIL_USERNAME:-ap@example.com}"

EMAIL_OAUTH_CLIENT_ID="${EMAIL_OAUTH_CLIENT_ID:-mailhog-client}"
EMAIL_OAUTH_CLIENT_SECRET="${EMAIL_OAUTH_CLIENT_SECRET:-mailhog-secret}"
EMAIL_OAUTH_REFRESH_TOKEN="${EMAIL_OAUTH_REFRESH_TOKEN:-mailhog-refresh}"
EMAIL_OAUTH_ACCESS_TOKEN="${EMAIL_OAUTH_ACCESS_TOKEN:-mailhog-access-token}"

RUN_DIR="$ROOT_DIR/.local-run"
OCR_PID_FILE="$RUN_DIR/e2e-email-ocr.pid"
SLM_PID_FILE="$RUN_DIR/e2e-email-slm.pid"
OCR_LOG_FILE="$ROOT_DIR/.e2e-ocr.log"
SLM_LOG_FILE="$ROOT_DIR/.e2e-slm.log"
PYTHON_BIN=""

stop_pid_file() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$pid_file"
}

cleanup() {
  stop_pid_file "$OCR_PID_FILE"
  stop_pid_file "$SLM_PID_FILE"
  "${COMPOSE_CMD[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

wait_for_http_contains() {
  local url="$1"
  local needle="$2"
  local name="$3"
  local timeout_seconds="$4"
  local started_at body
  started_at="$(date +%s)"
  body=""

  while (( "$(date +%s)" - started_at < timeout_seconds )); do
    body="$(curl -fsSL "$url" 2>/dev/null || true)"
    if [[ "$body" == *"$needle"* ]]; then
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for $name at $url. Expected '$needle'. Last payload: $body" >&2
  return 1
}

is_model_ready() {
  local url="$1"
  local body compact
  body="$(curl -fsS "$url" 2>/dev/null || true)"
  compact="$(printf "%s" "$body" | tr -d ' \t\r\n')"
  [[ "$compact" == *"\"modelLoaded\":true"* ]] && \
    ([[ "$compact" == *"\"status\":\"ok\""* ]] || [[ "$compact" == *"\"status\":\"ready\""* ]] || [[ "$compact" == *"\"status\":\"healthy\""* ]])
}

wait_for_model_ready() {
  local url="$1"
  local name="$2"
  local timeout_seconds="$3"
  local pid_file="${4:-}"
  local log_file="${5:-}"
  local started_at body compact
  started_at="$(date +%s)"
  body=""

  while (( "$(date +%s)" - started_at < timeout_seconds )); do
    if [[ -n "$pid_file" && -f "$pid_file" ]]; then
      local current_pid
      current_pid="$(cat "$pid_file" 2>/dev/null || true)"
      if [[ -n "$current_pid" ]] && ! kill -0 "$current_pid" >/dev/null 2>&1; then
        echo "$name process exited before readiness check completed." >&2
        if [[ -n "$log_file" && -f "$log_file" ]]; then
          tail -n 80 "$log_file" >&2 || true
        fi
        return 1
      fi
    fi

    body="$(curl -fsS "$url" 2>/dev/null || true)"
    compact="$(printf "%s" "$body" | tr -d ' \t\r\n')"
    if [[ "$compact" == *"\"modelLoaded\":true"* ]] && \
      ([[ "$compact" == *"\"status\":\"ok\""* ]] || [[ "$compact" == *"\"status\":\"ready\""* ]] || [[ "$compact" == *"\"status\":\"healthy\""* ]]); then
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for $name readiness at $url. Last payload: $body" >&2
  return 1
}

resolve_python_bin() {
  if [[ -x "$ROOT_DIR/.venv-ml/bin/python" ]]; then
    printf "%s" "$ROOT_DIR/.venv-ml/bin/python"
    return 0
  fi
  if command -v python3.11 >/dev/null 2>&1; then
    command -v python3.11
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  echo "Missing Python runtime. Install Python 3.10+ or create .venv-ml." >&2
  return 1
}

assert_python_version() {
  local python_bin="$1"
  "$python_bin" - <<'PY'
import sys
if sys.version_info < (3, 10):
  raise SystemExit(f"Python 3.10+ required, found {sys.version.split()[0]}")
PY
}

start_local_service_if_needed() {
  local name="$1"
  local health_url="$2"
  local pid_file="$3"
  local log_file="$4"
  shift 4

  if is_model_ready "$health_url"; then
    echo "$name already running at $health_url"
    return 0
  fi

  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" >/dev/null 2>&1; then
      echo "$name process already running (pid $existing_pid), waiting for readiness"
      wait_for_model_ready "$health_url" "$name" 1800 "$pid_file" "$log_file"
      return 0
    fi
  fi

  echo "Starting $name service"
  "$PYTHON_BIN" scripts/start-detached.py --pid-file "$pid_file" --log-file "$log_file" --cwd "$ROOT_DIR" -- "$@" >/dev/null
  wait_for_model_ready "$health_url" "$name" 1800 "$pid_file" "$log_file"
}

"${COMPOSE_CMD[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true

PYTHON_BIN="$(resolve_python_bin)"
assert_python_version "$PYTHON_BIN"
export SLM_MODEL_ID="$PINNED_SLM_MODEL_ID"

start_local_service_if_needed \
  "OCR" \
  "$E2E_OCR_HEALTH_URL" \
  "$OCR_PID_FILE" \
  "$OCR_LOG_FILE" \
  "$PYTHON_BIN" -m uvicorn app.api:app --app-dir ocr --host 0.0.0.0 --port 8200

start_local_service_if_needed \
  "SLM" \
  "$E2E_SLM_HEALTH_URL" \
  "$SLM_PID_FILE" \
  "$SLM_LOG_FILE" \
  "$PYTHON_BIN" -m uvicorn app.api:app --app-dir slm --host 0.0.0.0 --port 8300

ENV=local \
APP_MANIFEST_PATH=runtime-manifest.e2e.email-oauth.json \
INGESTION_SOURCES=email \
EMAIL_TRANSPORT=mailhog_oauth \
EMAIL_MAILHOG_API_BASE_URL=http://mailhog-oauth:8026 \
EMAIL_HOST=imap.gmail.com \
EMAIL_PORT=993 \
EMAIL_SECURE=true \
EMAIL_USERNAME="$E2E_EMAIL_USERNAME" \
EMAIL_AUTH_MODE=oauth2 \
EMAIL_OAUTH_CLIENT_ID="$EMAIL_OAUTH_CLIENT_ID" \
EMAIL_OAUTH_CLIENT_SECRET="$EMAIL_OAUTH_CLIENT_SECRET" \
EMAIL_OAUTH_REFRESH_TOKEN="$EMAIL_OAUTH_REFRESH_TOKEN" \
EMAIL_OAUTH_ACCESS_TOKEN="$EMAIL_OAUTH_ACCESS_TOKEN" \
EMAIL_OAUTH_TOKEN_ENDPOINT=http://mailhog-oauth:8026/oauth/token \
"${COMPOSE_CMD[@]}" up -d --build --remove-orphans backend mongo mailhog mailhog-oauth

wait_for_http_contains "$E2E_API_BASE_URL/health" "\"ready\":true" "backend" 600
wait_for_http_contains "$E2E_MAILHOG_WRAPPER_URL/health" "\"status\":\"ok\"" "mailhog-oauth-wrapper" 120

E2E_API_BASE_URL="$E2E_API_BASE_URL" \
E2E_MAILHOG_WRAPPER_URL="$E2E_MAILHOG_WRAPPER_URL" \
E2E_EMAIL_USERNAME="$E2E_EMAIL_USERNAME" \
E2E_EMAIL_OAUTH_CLIENT_ID="$EMAIL_OAUTH_CLIENT_ID" \
E2E_EMAIL_OAUTH_CLIENT_SECRET="$EMAIL_OAUTH_CLIENT_SECRET" \
E2E_EMAIL_OAUTH_REFRESH_TOKEN="$EMAIL_OAUTH_REFRESH_TOKEN" \
yarn workspace billforge-backend jest --config jest.config.cjs --runInBand src/e2e/emailOAuthIngestion.e2e.test.ts
