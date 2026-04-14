#!/usr/bin/env bash
set -euo pipefail

OCR_LOCAL_URL=${OCR_LOCAL_URL:-http://127.0.0.1:8200/v1}
SLM_LOCAL_URL=${SLM_LOCAL_URL:-http://127.0.0.1:8300/v1}
PYTHON_BIN=${PYTHON_BIN:-python3}
if [[ -x "./.venv-ml/bin/python" ]]; then
  PYTHON_BIN="./.venv-ml/bin/python"
fi

"$PYTHON_BIN" dev/scripts/benchmark-ocr.py --label local --base-url "$OCR_LOCAL_URL"
"$PYTHON_BIN" dev/scripts/benchmark-slm.py --label local --base-url "$SLM_LOCAL_URL"

if [[ -n "${OCR_PROD_URL:-}" ]]; then
  "$PYTHON_BIN" dev/scripts/benchmark-ocr.py --label prod --base-url "$OCR_PROD_URL"
else
  echo '{"kind":"ocr","label":"prod","status":"skipped","reason":"OCR_PROD_URL not set"}'
fi

if [[ -n "${SLM_PROD_URL:-}" ]]; then
  "$PYTHON_BIN" dev/scripts/benchmark-slm.py --label prod --base-url "$SLM_PROD_URL"
else
  echo '{"kind":"slm","label":"prod","status":"skipped","reason":"SLM_PROD_URL not set"}'
fi
