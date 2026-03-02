#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

E2E_INBOX_DIR="${E2E_INBOX_DIR:-}"
SOURCE_INBOX_DIR="${SOURCE_INBOX_DIR:-$ROOT_DIR/sample-invoices/inbox}"
E2E_API_BASE_URL="${E2E_API_BASE_URL:-http://127.0.0.1:4000}"
E2E_FRONTEND_BASE_URL="${E2E_FRONTEND_BASE_URL:-http://127.0.0.1:5173}"

cleanup() {
  yarn docker:down >/dev/null 2>&1 || true
  if [[ -n "${E2E_INBOX_DIR:-}" && "$E2E_INBOX_DIR" == /tmp/* ]]; then
    rm -rf "$E2E_INBOX_DIR"
  fi
}
trap cleanup EXIT

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

prepare_frontend_e2e_inbox() {
  if [[ -z "$E2E_INBOX_DIR" ]]; then
    E2E_INBOX_DIR="$(mktemp -d /tmp/invoice-processor-frontend-e2e-inbox.XXXXXX)"
  fi
  mkdir -p "$E2E_INBOX_DIR"
  rm -f "$E2E_INBOX_DIR"/*

  copy_first_match "*.pdf" "$E2E_INBOX_DIR/e2e-sample.pdf"
  copy_first_match "*.png" "$E2E_INBOX_DIR/e2e-sample.png"
  copy_first_match "*.jpg" "$E2E_INBOX_DIR/e2e-sample.jpg"
}

prepare_frontend_e2e_inbox
ENV=local yarn docker:down >/dev/null 2>&1 || true
INVOICE_INBOX_PATH="$E2E_INBOX_DIR" ENV=local yarn docker:up

E2E_API_BASE_URL="$E2E_API_BASE_URL" \
E2E_FRONTEND_BASE_URL="$E2E_FRONTEND_BASE_URL" \
E2E_EXPECT_TOTAL_FILES=3 \
yarn workspace invoice-processor-frontend run test:e2e
