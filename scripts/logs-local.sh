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

RUN_DIR="$ROOT_DIR/.local-run"
OCR_LOG="$RUN_DIR/ocr.log"
SLM_LOG="$RUN_DIR/slm.log"

mkdir -p "$RUN_DIR"
touch "$OCR_LOG" "$SLM_LOG"

declare -a PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}

trap cleanup EXIT INT TERM

prefix_stream() {
  local prefix="$1"
  shift
  "$@" 2>&1 | awk -v p="$prefix" '{ print "[" p "] " $0; fflush(); }'
}

prefix_stream "compose" "${COMPOSE_CMD[@]}" logs -f backend frontend mongo mongo-express mailhog mailhog-oauth &
PIDS+=("$!")

prefix_stream "ocr" tail -n 200 -F "$OCR_LOG" &
PIDS+=("$!")

prefix_stream "slm" tail -n 200 -F "$SLM_LOG" &
PIDS+=("$!")

wait
