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
E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:4100}"
E2E_FRONTEND_BASE_URL="${E2E_FRONTEND_BASE_URL:-http://127.0.0.1:5177}"

cleanup() {
  if [[ -n "${E2E_INBOX_DIR:-}" && "$E2E_INBOX_DIR" == /tmp/* ]]; then
    rm -rf "$E2E_INBOX_DIR"
  fi
  "${COMPOSE_CMD[@]}" -f docker-compose.yml -f docker-compose.e2e.yml down --volumes --remove-orphans >/dev/null 2>&1 || true
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

prepare_e2e_inbox
"${COMPOSE_CMD[@]}" -f docker-compose.yml -f docker-compose.e2e.yml down --volumes --remove-orphans >/dev/null 2>&1 || true

INVOICE_INBOX_PATH="$E2E_INBOX_DIR" ENV=local \
  "${COMPOSE_CMD[@]}" -f docker-compose.yml -f docker-compose.e2e.yml \
  up -d --build --remove-orphans backend frontend mongo mongo-express

wait_for_http_contains "$E2E_API_BASE_URL/health" "\"ready\":true" "backend" 600
wait_for_http_contains "$E2E_FRONTEND_BASE_URL" "<html" "frontend" 300

E2E_API_BASE_URL="$E2E_API_BASE_URL" \
E2E_FRONTEND_BASE_URL="$E2E_FRONTEND_BASE_URL" \
E2E_INBOX_DIR="$E2E_INBOX_DIR" \
yarn workspace billforge-backend run test:e2e

E2E_API_BASE_URL="$E2E_API_BASE_URL" \
E2E_FRONTEND_BASE_URL="$E2E_FRONTEND_BASE_URL" \
E2E_EXPECT_TOTAL_FILES=3 \
E2E_SKIP_INGEST=true \
yarn workspace billforge-frontend run test:e2e
