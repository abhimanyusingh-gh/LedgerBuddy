#!/usr/bin/env bash
set -euo pipefail

# Validates profile combinations and prints actionable error messages.

PROFILES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../profiles" && pwd)"

validate_engine() {
  local engine="$1"
  if [[ -z "$engine" ]]; then
    return 0
  fi
  if [[ ! -f "$PROFILES_DIR/engines/$engine.env" ]]; then
    echo "Error: unknown engine '$engine'" >&2
    echo "Available engines:" >&2
    for f in "$PROFILES_DIR/engines/"*.env; do
      echo "  $(basename "$f" .env)" >&2
    done
    return 1
  fi
}

validate_ocr() {
  local ocr="$1"
  if [[ -z "$ocr" ]]; then
    return 0
  fi
  if [[ ! -f "$PROFILES_DIR/ocr/$ocr.env" ]]; then
    echo "Error: unknown ocr profile '$ocr'" >&2
    echo "Available OCR profiles:" >&2
    for f in "$PROFILES_DIR/ocr/"*.env; do
      echo "  $(basename "$f" .env)" >&2
    done
    return 1
  fi
}

validate_extraction() {
  local extraction="$1"
  if [[ -z "$extraction" ]]; then
    return 0
  fi
  if [[ ! -f "$PROFILES_DIR/extraction/$extraction.env" ]]; then
    echo "Error: unknown extraction profile '$extraction'" >&2
    echo "Available extraction profiles:" >&2
    for f in "$PROFILES_DIR/extraction/"*.env; do
      echo "  $(basename "$f" .env)" >&2
    done
    return 1
  fi
}

validate_preset() {
  local preset="$1"
  if [[ -z "$preset" ]]; then
    return 0
  fi
  if [[ ! -f "$PROFILES_DIR/presets/$preset.env" ]]; then
    echo "Error: unknown preset '$preset'" >&2
    echo "Available presets:" >&2
    for f in "$PROFILES_DIR/presets/"*.env; do
      echo "  $(basename "$f" .env)" >&2
    done
    return 1
  fi
}

validate_combinations() {
  local engine="${_PROFILE_ENGINE:-}"
  local ocr="${_PROFILE_OCR:-}"
  local preset="${_PROFILE_PRESET:-}"

  # llamaextract presets require llamaparse OCR — disallow explicit OCR overrides
  if [[ "$preset" == llamaextract* && -n "$ocr" && "$ocr" != "default" ]]; then
    echo "Error: preset '$preset' manages its own OCR provider. Do not combine with --ocr." >&2
    return 1
  fi

  # codex + apple_vision is not supported
  if [[ "$engine" == "codex" && "$ocr" == "apple_vision" ]]; then
    echo "Error: codex engine does not support apple_vision OCR." >&2
    return 1
  fi
}

validate_all() {
  validate_engine "${_PROFILE_ENGINE:-}"
  validate_ocr "${_PROFILE_OCR:-}"
  validate_extraction "${_PROFILE_EXTRACTION:-}"
  validate_preset "${_PROFILE_PRESET:-}"
  validate_combinations
}
