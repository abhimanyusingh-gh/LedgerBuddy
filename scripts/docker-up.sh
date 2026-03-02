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

ENV_MODE="${ENV:-local}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4000/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5173}"
OCR_HEALTH_URL="${OCR_HEALTH_URL:-http://127.0.0.1:8000/v1/health}"
SLM_HEALTH_URL="${SLM_HEALTH_URL:-http://127.0.0.1:8100/v1/health}"
DEFAULT_DEMO_INBOX_PATH="$ROOT_DIR/.local-run/demo-inbox"
INVOICE_INBOX_PATH="${INVOICE_INBOX_PATH:-$DEFAULT_DEMO_INBOX_PATH}"
DEFAULT_LOCAL_MANIFEST_PATH="runtime-manifest.local.demo.json"
APP_MANIFEST_PATH_VALUE="${APP_MANIFEST_PATH:-}"
LOCAL_DEMO_SEED_VALUE="${LOCAL_DEMO_SEED:-}"
AUTH_AUTO_PROVISION_USERS_VALUE="${AUTH_AUTO_PROVISION_USERS:-}"
LOCAL_DEMO_CONFIG_PATH_VALUE="${LOCAL_DEMO_CONFIG_PATH:-config/local-demo-users.json}"

RUN_DIR="$ROOT_DIR/.local-run"
OCR_PID_FILE="$RUN_DIR/ocr.pid"
SLM_PID_FILE="$RUN_DIR/slm.pid"
OCR_LOG_FILE="$RUN_DIR/ocr.log"
SLM_LOG_FILE="$RUN_DIR/slm.log"

mkdir -p "$RUN_DIR"

prepare_local_demo_inbox() {
  local source_dir="$1"
  local destination_root="$2"
  local tenant_a_dir="$destination_root/tenant-alpha"
  local tenant_b_dir="$destination_root/tenant-beta"
  local -a files=()

  mkdir -p "$tenant_a_dir" "$tenant_b_dir"
  rm -f "$tenant_a_dir"/* "$tenant_b_dir"/*

  while IFS= read -r file; do
    files+=("$file")
  done < <(find "$source_dir" -maxdepth 1 -type f \( -name "*.pdf" -o -name "*.png" -o -name "*.jpg" -o -name "*.jpeg" \) | sort)

  local index=0
  for file_path in "${files[@]}"; do
    if (( index % 2 == 0 )); then
      cp "$file_path" "$tenant_a_dir/"
    else
      cp "$file_path" "$tenant_b_dir/"
    fi
    index=$((index + 1))
  done
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

start_local_service_if_needed() {
  local name="$1"
  local health_url="$2"
  local pid_file="$3"
  local log_file="$4"
  shift 4

  if is_model_ready "$health_url"; then
    echo "$name is already ready at $health_url"
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
  local pid
  pid="$("$PYTHON_BIN" scripts/start-detached.py --pid-file "$pid_file" --log-file "$log_file" --cwd "$ROOT_DIR" -- "$@")"
  if [[ -n "$pid" ]]; then
    echo "$name started with pid $pid"
  fi
  wait_for_model_ready "$health_url" "$name" 1800 "$pid_file" "$log_file"
}

if [[ "$ENV_MODE" == "local" || "$ENV_MODE" == "dev" ]]; then
  local_demo_mode="false"
  if [[ "$INVOICE_INBOX_PATH" == "$DEFAULT_DEMO_INBOX_PATH" ]]; then
    local_demo_mode="true"
  fi
  if [[ -z "$APP_MANIFEST_PATH_VALUE" && "$local_demo_mode" == "true" ]]; then
    APP_MANIFEST_PATH_VALUE="$DEFAULT_LOCAL_MANIFEST_PATH"
  fi
  if [[ -z "$LOCAL_DEMO_SEED_VALUE" ]]; then
    if [[ "$local_demo_mode" == "true" ]]; then
      LOCAL_DEMO_SEED_VALUE="true"
    else
      LOCAL_DEMO_SEED_VALUE="false"
    fi
  fi
  if [[ -z "$AUTH_AUTO_PROVISION_USERS_VALUE" ]]; then
    AUTH_AUTO_PROVISION_USERS_VALUE="false"
  fi
  if [[ "$INVOICE_INBOX_PATH" == "$DEFAULT_DEMO_INBOX_PATH" ]]; then
    prepare_local_demo_inbox "$ROOT_DIR/sample-invoices/inbox" "$INVOICE_INBOX_PATH"
  fi

  PYTHON_BIN="$(resolve_python_bin)"
  assert_python_version "$PYTHON_BIN"

  start_local_service_if_needed \
    "OCR" \
    "$OCR_HEALTH_URL" \
    "$OCR_PID_FILE" \
    "$OCR_LOG_FILE" \
    "$PYTHON_BIN" -m uvicorn app.api:app --app-dir invoice-ocr --host 0.0.0.0 --port 8000

  start_local_service_if_needed \
    "SLM" \
    "$SLM_HEALTH_URL" \
    "$SLM_PID_FILE" \
    "$SLM_LOG_FILE" \
    "$PYTHON_BIN" -m uvicorn app.api:app --app-dir invoice-slm --host 0.0.0.0 --port 8100
fi

INVOICE_INBOX_PATH="$INVOICE_INBOX_PATH" \
APP_MANIFEST_PATH="$APP_MANIFEST_PATH_VALUE" \
LOCAL_DEMO_SEED="$LOCAL_DEMO_SEED_VALUE" \
AUTH_AUTO_PROVISION_USERS="$AUTH_AUTO_PROVISION_USERS_VALUE" \
LOCAL_DEMO_CONFIG_PATH="$LOCAL_DEMO_CONFIG_PATH_VALUE" \
ENV="$ENV_MODE" \
"${COMPOSE_CMD[@]}" up -d --build --remove-orphans backend frontend mongo mongo-express mailhog mailhog-oauth local-sts
wait_for_http_contains "$BACKEND_HEALTH_URL" "\"ready\":true" "backend" 600
wait_for_http_contains "$FRONTEND_URL" "<html" "frontend" 300

echo "Full stack is up."
