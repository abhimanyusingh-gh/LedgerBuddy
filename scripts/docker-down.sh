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

stop_pid_file() {
  local label="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "Stopping $label (pid $pid)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$pid_file"
}

KEEP_ML="${KEEP_ML:-true}"

if [[ "$KEEP_ML" != "true" ]]; then
  "${COMPOSE_CMD[@]}" down --volumes --rmi local --remove-orphans
else
  "${COMPOSE_CMD[@]}" down --remove-orphans
fi

if [[ "$KEEP_ML" != "true" ]]; then
  stop_pid_file "OCR" "$ROOT_DIR/.local-run/ocr.pid"
  stop_pid_file "SLM" "$ROOT_DIR/.local-run/slm.pid"
  echo "All services down (including OCR/SLM)."
else
  echo "Docker services down. OCR/SLM kept running."
fi
