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
  local name="$1"
  local pid_file="$2"
  if [[ ! -f "$pid_file" ]]; then
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
    echo "Stopping $name (pid $pid)"
    kill "$pid" >/dev/null 2>&1 || true
  fi
  rm -f "$pid_file"
}

KEEP_ML="${KEEP_ML:-true}"

"${COMPOSE_CMD[@]}" down --volumes --rmi local --remove-orphans

RUN_DIR="$ROOT_DIR/.local-run"
if [[ "$KEEP_ML" != "true" ]]; then
  stop_pid_file "OCR" "$RUN_DIR/ocr.pid"
  stop_pid_file "SLM" "$RUN_DIR/slm.pid"
fi

if [[ "$KEEP_ML" == "true" ]]; then
  echo "Docker services are down. OCR/SLM services kept running."
else
  echo "All services are down (including OCR/SLM)."
fi
