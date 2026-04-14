#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SLM_PID_FILE="$ROOT_DIR/.local-run/slm.pid"
SLM_LOG_FILE="$ROOT_DIR/.local-run/slm.log"
SLM_HEALTH_URL="http://127.0.0.1:8300/health"

if [ -x "$ROOT_DIR/.venv-ml/bin/python" ]; then
  PYTHON_BIN="$ROOT_DIR/.venv-ml/bin/python"
else
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi

if [[ -f "$SLM_PID_FILE" ]]; then
  stale_pid="$(cat "$SLM_PID_FILE" 2>/dev/null || true)"
  if [[ -n "$stale_pid" ]] && kill -0 "$stale_pid" 2>/dev/null; then
    echo "Stopping SLM (PID $stale_pid)..."
    kill "$stale_pid" 2>/dev/null || true
    sleep 2
  fi
fi

engine="${SLM_ENGINE:-local_claude_cli}"
pipeline="${SLM_EXTRACTION_PIPELINE:-single_verify}"
multi_step="${SLM_MULTI_STEP_EXTRACTION:-false}"

echo "Starting SLM: engine=$engine  pipeline=$pipeline  multi_step=$multi_step"

SLM_ENGINE="$engine" \
SLM_EXTRACTION_PIPELINE="$pipeline" \
SLM_MULTI_STEP_EXTRACTION="$multi_step" \
"$PYTHON_BIN" dev/scripts/start-detached.py \
  --pid-file "$SLM_PID_FILE" \
  --log-file "$SLM_LOG_FILE" \
  --cwd "$ROOT_DIR" \
  -- "$PYTHON_BIN" -m uvicorn app.api:app --app-dir ai/slm --host 0.0.0.0 --port 8300

echo "SLM started (PID $(cat "$SLM_PID_FILE"))"
printf "Waiting for health"

for i in $(seq 1 30); do
  result=$(curl -fsS "$SLM_HEALTH_URL" 2>/dev/null || true)
  if [[ -n "$result" ]]; then
    provider=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('provider', d.get('modelId','?')))" 2>/dev/null || echo "?")
    echo ""
    echo "SLM ready: $provider"
    exit 0
  fi
  printf "."
  sleep 2
done

echo ""
echo "SLM did not become healthy in time — check .local-run/slm.log"
exit 1
