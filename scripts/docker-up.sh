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
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://127.0.0.1:4100/health}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:5177}"
DEFAULT_DEMO_INBOX_PATH="$ROOT_DIR/.local-run/demo-inbox"
INVOICE_INBOX_PATH="${INVOICE_INBOX_PATH:-$DEFAULT_DEMO_INBOX_PATH}"
DEFAULT_LOCAL_MANIFEST_PATH="backend/runtime-manifest.local.demo.json"
APP_MANIFEST_PATH_VALUE="${APP_MANIFEST_PATH:-}"
LOCAL_DEMO_SEED_VALUE="${LOCAL_DEMO_SEED:-}"
AUTH_AUTO_PROVISION_USERS_VALUE="${AUTH_AUTO_PROVISION_USERS:-}"
LOCAL_DEMO_CONFIG_PATH_VALUE="${LOCAL_DEMO_CONFIG_PATH:-config/local-demo-users.json}"

mkdir -p "$ROOT_DIR/.local-run"

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
    if [[ "$local_demo_mode" == "true" ]]; then
      AUTH_AUTO_PROVISION_USERS_VALUE="true"
    else
      AUTH_AUTO_PROVISION_USERS_VALUE="false"
    fi
  fi
  if [[ "$INVOICE_INBOX_PATH" == "$DEFAULT_DEMO_INBOX_PATH" ]]; then
    prepare_local_demo_inbox "$ROOT_DIR/sample-invoices/inbox" "$INVOICE_INBOX_PATH"
  fi
fi

INVOICE_INBOX_PATH="$INVOICE_INBOX_PATH" \
APP_MANIFEST_PATH="$APP_MANIFEST_PATH_VALUE" \
LOCAL_DEMO_SEED="$LOCAL_DEMO_SEED_VALUE" \
AUTH_AUTO_PROVISION_USERS="$AUTH_AUTO_PROVISION_USERS_VALUE" \
LOCAL_DEMO_CONFIG_PATH="$LOCAL_DEMO_CONFIG_PATH_VALUE" \
ENV="$ENV_MODE" \
"${COMPOSE_CMD[@]}" up -d --build --remove-orphans \
  backend frontend mongo mongo-express mailhog mailhog-oauth minio-init invoice-ocr invoice-slm

wait_for_http_contains "$BACKEND_HEALTH_URL" "\"ready\":true" "backend" 600
wait_for_http_contains "$FRONTEND_URL" "<html" "frontend" 300

echo "Full stack is up."
