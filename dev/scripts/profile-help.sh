#!/usr/bin/env bash
set -euo pipefail

# Auto-discovers and prints all available profile options.

PROFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../profiles" && pwd)"

list_dir() {
  local label="$1"
  local dir="$2"
  echo "$label:"
  for f in "$dir"/*.env; do
    [[ -f "$f" ]] || continue
    local name
    name="$(basename "$f" .env)"
    local desc=""
    # Read the first non-empty env vars as a brief description
    while IFS='=' read -r key value; do
      [[ -z "$key" || "$key" == \#* ]] && continue
      key="$(echo "$key" | xargs)"
      if [[ -n "$desc" ]]; then
        desc="$desc, $key=$value"
      else
        desc="$key=$value"
      fi
    done < "$f"
    if [[ -z "$desc" ]]; then
      desc="(no overrides)"
    fi
    printf "  %-28s %s\n" "$name" "$desc"
  done
  echo ""
}

echo ""
echo "LedgerBuddy Launch Profile System"
echo "================================"
echo ""
echo "Usage:"
echo "  yarn docker [--engine=X] [--ocr=X] [--extraction=X] [--preset=X]"
echo "  yarn slm    [--engine=X] [--extraction=X]"
echo "  yarn benchmark [--engine=X] [--ocr=X]"
echo ""

list_dir "Engines (--engine)" "$PROFILES_DIR/engines"
list_dir "OCR (--ocr)" "$PROFILES_DIR/ocr"
list_dir "Extraction (--extraction)" "$PROFILES_DIR/extraction"
list_dir "Presets (--preset)" "$PROFILES_DIR/presets"

echo "Examples:"
echo "  yarn docker --engine=claude --extraction=multi"
echo "  yarn docker --preset=llamaextract"
echo "  yarn docker --engine=claude --ocr=apple_vision --extraction=single"
echo "  yarn slm --engine=mlx --extraction=multi"
echo ""
echo "Presets set defaults that individual flags can override."
echo "Merge order: preset -> engine -> ocr -> extraction -> CLI env overrides."
echo ""
