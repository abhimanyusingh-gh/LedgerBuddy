#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is required. Install 'docker compose' plugin or 'docker-compose' binary."
  exit 1
fi

E2E_INBOX_DIR="${E2E_INBOX_DIR:-}"
SOURCE_INBOX_DIR="${SOURCE_INBOX_DIR:-$ROOT_DIR/sample-invoices/inbox}"
PINNED_SLM_MODEL_ID="mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit"
E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:4100}"
E2E_FRONTEND_BASE_URL="${E2E_FRONTEND_BASE_URL:-http://127.0.0.1:5177}"
E2E_OCR_HEALTH_URL="${E2E_OCR_HEALTH_URL:-http://127.0.0.1:8200/health}"
E2E_SLM_HEALTH_URL="${E2E_SLM_HEALTH_URL:-http://127.0.0.1:8300/health}"
RUN_DIR="$ROOT_DIR/.local-run"
OCR_PID_FILE="$RUN_DIR/e2e-ocr.pid"
SLM_PID_FILE="$RUN_DIR/e2e-slm.pid"
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
  if [[ -n "${E2E_INBOX_DIR:-}" && "$E2E_INBOX_DIR" == /tmp/* ]]; then
    rm -rf "$E2E_INBOX_DIR"
  fi
  "${COMPOSE_CMD[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

prepare_e2e_inbox() {
  if [[ -z "$E2E_INBOX_DIR" ]]; then
    E2E_INBOX_DIR="$(mktemp -d /tmp/billforge-e2e-inbox.XXXXXX)"
  fi

  mkdir -p "$E2E_INBOX_DIR"
  rm -f "$E2E_INBOX_DIR"/*

  copy_first_match "*.pdf" "$E2E_INBOX_DIR/e2e-sample.pdf"
  copy_first_match "*.png" "$E2E_INBOX_DIR/e2e-sample.png"
  copy_first_match "*.jpg" "$E2E_INBOX_DIR/e2e-sample.jpg"
}

copy_first_match() {
  local pattern="$1"
  local destination="$2"
  local source

  source="$(find "$SOURCE_INBOX_DIR" -maxdepth 1 -type f -name "$pattern" | head -n 1)"
  if [[ -z "$source" ]]; then
    echo "Missing source sample for pattern '$pattern' in '$SOURCE_INBOX_DIR'." >&2
    exit 1
  fi

  cp "$source" "$destination"
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

  echo "Timed out waiting for $name at $url. Expected content '$needle'." >&2
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

prepare_e2e_inbox
"${COMPOSE_CMD[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true

PYTHON_BIN="$(resolve_python_bin)"
assert_python_version "$PYTHON_BIN"
export SLM_MODEL_ID="$PINNED_SLM_MODEL_ID"

start_local_service_if_needed \
  "OCR" \
  "$E2E_OCR_HEALTH_URL" \
  "$OCR_PID_FILE" \
  "$OCR_LOG_FILE" \
  "$PYTHON_BIN" -m uvicorn app.api:app --app-dir invoice-ocr --host 0.0.0.0 --port 8200

start_local_service_if_needed \
  "SLM" \
  "$E2E_SLM_HEALTH_URL" \
  "$SLM_PID_FILE" \
  "$SLM_LOG_FILE" \
  "$PYTHON_BIN" -m uvicorn app.api:app --app-dir invoice-slm --host 0.0.0.0 --port 8300

INVOICE_INBOX_PATH="$E2E_INBOX_DIR" ENV=local \
  "${COMPOSE_CMD[@]}" up -d --build --remove-orphans \
  backend frontend mongo mongo-express mailhog mailhog-oauth minio-init invoice-ocr invoice-slm

wait_for_http_contains "$E2E_API_BASE_URL/health" "\"ready\":true" "backend" 600
wait_for_http_contains "$E2E_FRONTEND_BASE_URL" "<html" "frontend" 300

E2E_API_BASE_URL="$E2E_API_BASE_URL" \
E2E_FRONTEND_BASE_URL="$E2E_FRONTEND_BASE_URL" \
E2E_OCR_HEALTH_URL="$E2E_OCR_HEALTH_URL" \
E2E_SLM_HEALTH_URL="$E2E_SLM_HEALTH_URL" \
E2E_INBOX_DIR="$E2E_INBOX_DIR" \
yarn workspace billforge-backend run test:e2e

E2E_API_BASE_URL="$E2E_API_BASE_URL" \
E2E_FRONTEND_BASE_URL="$E2E_FRONTEND_BASE_URL" \
E2E_EXPECT_TOTAL_FILES=3 \
E2E_SKIP_INGEST=true \
yarn workspace billforge-frontend run test:e2e
