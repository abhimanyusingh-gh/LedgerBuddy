#!/usr/bin/env bash
set -euo pipefail

# Pre-downloads HuggingFace models required by OCR and SLM services.
# Models are cached in ~/.cache/huggingface/ and reused on service startup.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

OCR_MODEL_ID="${OCR_MODEL_ID:-mlx-community/DeepSeek-OCR-4bit}"
SLM_MODEL_ID="${SLM_MODEL_ID:-mlx-community/DeepSeek-R1-Distill-Qwen-1.5B-4bit}"

resolve_python_bin() {
  if [[ -x "$ROOT_DIR/.venv-ml/bin/python" ]]; then
    printf "%s" "$ROOT_DIR/.venv-ml/bin/python"
    return 0
  fi
  if command -v python3.11 >/dev/null 2>&1; then
    command -v python3.11
    return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    command -v python3
    return 0
  fi
  echo "Missing Python runtime. Install Python 3.10+ or create .venv-ml." >&2
  return 1
}

PYTHON_BIN="$(resolve_python_bin)"

echo "Using Python: $PYTHON_BIN"
echo ""

echo "Pulling OCR model: $OCR_MODEL_ID"
"$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download
print('Downloading $OCR_MODEL_ID ...')
path = snapshot_download('$OCR_MODEL_ID')
print(f'Cached at: {path}')
"
echo ""

echo "Pulling SLM model: $SLM_MODEL_ID"
"$PYTHON_BIN" -c "
from huggingface_hub import snapshot_download
print('Downloading $SLM_MODEL_ID ...')
path = snapshot_download('$SLM_MODEL_ID')
print(f'Cached at: {path}')
"
echo ""

echo "All models downloaded successfully."
