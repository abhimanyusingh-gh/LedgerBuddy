#!/usr/bin/env bash
set -euo pipefail

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is required. Install 'docker compose' plugin or 'docker-compose' binary."
  exit 1
fi

cleanup() {
  "${COMPOSE_CMD[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

"${COMPOSE_CMD[@]}" up -d mongo mongo-express

yarn workspace invoice-processor-backend run test:e2e
