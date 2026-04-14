#!/usr/bin/env bash
set -euo pipefail

# Loads profile .env files and merges them in priority order.
# Merge rule: first writer wins — variables already set are NOT overwritten.

PROFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../profiles" && pwd)"

load_profile() {
  local profile_path="$1"
  if [[ ! -f "$profile_path" ]]; then
    echo "Profile not found: $profile_path" >&2
    return 1
  fi
  while IFS='=' read -r key value; do
    # Skip blanks and comments
    [[ -z "$key" || "$key" == \#* ]] && continue
    # Strip surrounding whitespace from key
    key="$(echo "$key" | xargs)"
    # Only set if not already defined
    if [[ -z "${!key+x}" ]]; then
      export "$key=$value"
    fi
  done < "$profile_path"
}

resolve_preset_references() {
  # Presets can reference ENGINE, OCR, EXTRACTION as meta-keys.
  # After loading a preset, expand those into real profile loads.
  # Only adopt the preset's meta-key if the caller did not already set a value.
  if [[ -n "${ENGINE:-}" && -z "${_PROFILE_ENGINE:-}" ]]; then
    _PROFILE_ENGINE="$ENGINE"
    unset ENGINE
  fi
  if [[ -n "${OCR:-}" && -z "${_PROFILE_OCR:-}" ]]; then
    _PROFILE_OCR="$OCR"
    unset OCR
  fi
  if [[ -n "${EXTRACTION:-}" && -z "${_PROFILE_EXTRACTION:-}" ]]; then
    _PROFILE_EXTRACTION="$EXTRACTION"
    unset EXTRACTION
  fi
}

resolve_profiles() {
  local engine="${_PROFILE_ENGINE:-}"
  local ocr="${_PROFILE_OCR:-}"
  local extraction="${_PROFILE_EXTRACTION:-}"
  local preset="${_PROFILE_PRESET:-}"

  # 1. Preset first (lowest priority — sets defaults)
  if [[ -n "$preset" ]]; then
    load_profile "$PROFILES_DIR/presets/$preset.env"
    resolve_preset_references
    # Re-read meta-keys expanded by the preset
    engine="${_PROFILE_ENGINE:-$engine}"
    ocr="${_PROFILE_OCR:-$ocr}"
    extraction="${_PROFILE_EXTRACTION:-$extraction}"
  fi

  # 2. Engine layer
  if [[ -n "$engine" ]]; then
    load_profile "$PROFILES_DIR/engines/$engine.env"
  fi

  # 3. OCR layer
  if [[ -n "$ocr" ]]; then
    load_profile "$PROFILES_DIR/ocr/$ocr.env"
  fi

  # 4. Extraction layer
  if [[ -n "$extraction" ]]; then
    load_profile "$PROFILES_DIR/extraction/$extraction.env"
  fi
}
