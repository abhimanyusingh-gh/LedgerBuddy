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
PINNED_SLM_MODEL_ID="mlx-community/Qwen2.5-14B-Instruct-4bit"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4100/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5177}"
OCR_HEALTH_URL="${OCR_HEALTH_URL:-http://127.0.0.1:8200/health}"
SLM_HEALTH_URL="${SLM_HEALTH_URL:-http://127.0.0.1:8300/health}"
DEFAULT_DEMO_INBOX_PATH="$ROOT_DIR/.local-run/demo-inbox"
INVOICE_INBOX_PATH="${INVOICE_INBOX_PATH:-$DEFAULT_DEMO_INBOX_PATH}"
DEFAULT_LOCAL_MANIFEST_PATH="backend/runtime-manifest.local.demo.json"
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

find_system_python310() {
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    local bin
    bin="$(command -v "$candidate" 2>/dev/null || true)"
    if [[ -n "$bin" ]]; then
      local ok
      ok="$("$bin" -c 'import sys; print("ok" if sys.version_info >= (3,10) else "no")' 2>/dev/null || echo "no")"
      if [[ "$ok" == "ok" ]]; then
        printf "%s" "$bin"
        return 0
      fi
    fi
  done
  return 1
}

ensure_venv_ml() {
  local venv_dir="$ROOT_DIR/.venv-ml"
  local needs_create="false"
  local needs_deps="false"

  if [[ ! -x "$venv_dir/bin/python" ]]; then
    needs_create="true"
  else
    local ok
    ok="$("$venv_dir/bin/python" -c 'import sys; print("ok" if sys.version_info >= (3,10) else "no")' 2>/dev/null || echo "no")"
    if [[ "$ok" != "ok" ]]; then
      echo "Existing .venv-ml has Python < 3.10, recreating..." >&2
      rm -rf "$venv_dir"
      needs_create="true"
    fi
  fi

  if [[ "$needs_create" == "true" ]]; then
    local sys_python
    sys_python="$(find_system_python310)" || {
      echo "No Python 3.10+ found. Install via: brew install python@3.12" >&2
      exit 1
    }
    echo "Creating .venv-ml with $sys_python..." >&2
    "$sys_python" -m venv "$venv_dir"
    needs_deps="true"
  fi

  if [[ "$needs_deps" == "false" ]]; then
    local missing
    missing="$("$venv_dir/bin/python" -c 'import uvicorn, fastapi' 2>&1 || echo "missing")"
    if [[ "$missing" == *"missing"* || "$missing" == *"ModuleNotFoundError"* ]]; then
      needs_deps="true"
    fi
  fi

  if [[ "$needs_deps" == "true" ]]; then
    echo "Installing Python dependencies into .venv-ml..." >&2
    "$venv_dir/bin/pip" install --quiet --upgrade pip
    "$venv_dir/bin/pip" install --quiet -r ocr/requirements.txt
    "$venv_dir/bin/pip" install --quiet -r slm/requirements.txt
    echo "Python dependencies installed." >&2
  fi

  printf "%s" "$venv_dir/bin/python"
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

  echo "Timed out waiting for $name at $url. Expected '$needle'. Last payload: $body" >&2
  return 1
}

kill_local_service() {
  local name="$1"
  local pid_file="$2"

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      echo "Stopping $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -0 "$pid" >/dev/null 2>&1 && kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

kill_stale_slm_if_engine_mismatch() {
  local health_url="$1"
  local pid_file="$2"
  local requested_engine="${SLM_ENGINE:-}"

  if [[ -z "$requested_engine" || "$requested_engine" == "prod_http" ]]; then
    return 0
  fi

  local body
  body="$(curl -fsS "$health_url" 2>/dev/null || true)"
  if [[ -z "$body" ]]; then
    return 0
  fi

  local running_provider
  running_provider="$(printf "%s" "$body" | tr -d ' \t\r\n' | sed -n 's/.*"provider":"\([^"]*\)".*/\1/p')"
  if [[ -z "$running_provider" ]]; then
    return 0
  fi

  if [[ "$running_provider" == "$requested_engine" ]]; then
    return 0
  fi

  echo "SLM engine mismatch: running=$running_provider, requested=$requested_engine. Killing stale process."
  kill_local_service "SLM" "$pid_file"
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

is_local_ocr_engine() {
  local engine="${OCR_ENGINE:-}"
  [[ "$engine" == local_* ]]
}

is_local_slm_engine() {
  local engine="${SLM_ENGINE:-}"
  [[ "$engine" == local_* ]]
}

if [[ "$ENV_MODE" == "local" || "$ENV_MODE" == "dev" ]]; then
  export SLM_MODEL_ID="$PINNED_SLM_MODEL_ID"
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
    if [[ "$local_demo_mode" == "true" ]]; then
      AUTH_AUTO_PROVISION_USERS_VALUE="true"
    else
      AUTH_AUTO_PROVISION_USERS_VALUE="false"
    fi
  fi
  if [[ "$INVOICE_INBOX_PATH" == "$DEFAULT_DEMO_INBOX_PATH" ]]; then
    prepare_local_demo_inbox "$ROOT_DIR/sample-invoices/inbox" "$INVOICE_INBOX_PATH"
  fi

  if is_local_ocr_engine || is_local_slm_engine; then
    PYTHON_BIN="$(ensure_venv_ml)"
  fi

  if is_local_ocr_engine; then
    if [[ "${RESTART_LOCAL_ML:-false}" == "true" ]]; then
      kill_local_service "OCR" "$OCR_PID_FILE"
    fi

    start_local_service_if_needed \
      "OCR" \
      "$OCR_HEALTH_URL" \
      "$OCR_PID_FILE" \
      "$OCR_LOG_FILE" \
      "$PYTHON_BIN" -m uvicorn app.api:app --app-dir ocr --host 0.0.0.0 --port 8200

    detected_ocr_model="$(curl -fsS http://localhost:8200/v1/models 2>/dev/null \
      | "$PYTHON_BIN" -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id'] if d.get('data') else '')" 2>/dev/null || true)"
    if [[ -n "$detected_ocr_model" ]]; then
      export OCR_MODEL="$detected_ocr_model"
      echo "OCR model detected: $OCR_MODEL"
    fi
  fi

  if is_local_slm_engine; then
    if [[ "${RESTART_LOCAL_ML:-false}" == "true" ]]; then
      kill_local_service "SLM" "$SLM_PID_FILE"
    else
      kill_stale_slm_if_engine_mismatch "$SLM_HEALTH_URL" "$SLM_PID_FILE"
    fi

    start_local_service_if_needed \
      "SLM" \
      "$SLM_HEALTH_URL" \
      "$SLM_PID_FILE" \
      "$SLM_LOG_FILE" \
      "$PYTHON_BIN" -m uvicorn app.api:app --app-dir slm --host 0.0.0.0 --port 8300
  fi
fi

INVOICE_INBOX_PATH="$INVOICE_INBOX_PATH" \
APP_MANIFEST_PATH="$APP_MANIFEST_PATH_VALUE" \
LOCAL_DEMO_SEED="$LOCAL_DEMO_SEED_VALUE" \
AUTH_AUTO_PROVISION_USERS="$AUTH_AUTO_PROVISION_USERS_VALUE" \
LOCAL_DEMO_CONFIG_PATH="$LOCAL_DEMO_CONFIG_PATH_VALUE" \
ENV="$ENV_MODE" \
NO_CACHE_FLAG="--no-cache"

"${COMPOSE_CMD[@]}" build $NO_CACHE_FLAG backend frontend
"${COMPOSE_CMD[@]}" up -d --build --remove-orphans \
  backend frontend mongo mongo-express mailhog mailhog-oauth minio minio-init

wait_for_http_contains "$BACKEND_HEALTH_URL" "\"ready\":true" "backend" 600
wait_for_http_contains "$FRONTEND_URL" "<html" "frontend" 300

echo "Full stack is up."
