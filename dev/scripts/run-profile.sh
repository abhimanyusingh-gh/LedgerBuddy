#!/usr/bin/env bash
set -euo pipefail

# Main orchestration script for the profile-based launch system.
# Parses --engine, --ocr, --extraction, --preset flags, resolves profiles,
# validates combinations, then delegates to the appropriate launch script.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="$ROOT_DIR/dev/scripts"

source "$SCRIPTS_DIR/profile-resolver.sh"
source "$SCRIPTS_DIR/validators.sh"

# First positional arg is the target command
TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Usage: run-profile.sh <target> [--engine=X] [--ocr=X] [--extraction=X] [--preset=X]" >&2
  echo "Targets: docker, slm, benchmark" >&2
  exit 1
fi
shift

# Parse flags
_PROFILE_ENGINE=""
_PROFILE_OCR=""
_PROFILE_EXTRACTION=""
_PROFILE_PRESET=""

for arg in "$@"; do
  case "$arg" in
    --engine=*)    _PROFILE_ENGINE="${arg#--engine=}" ;;
    --ocr=*)       _PROFILE_OCR="${arg#--ocr=}" ;;
    --extraction=*)_PROFILE_EXTRACTION="${arg#--extraction=}" ;;
    --preset=*)    _PROFILE_PRESET="${arg#--preset=}" ;;
    *)
      echo "Unknown flag: $arg" >&2
      echo "Valid flags: --engine=, --ocr=, --extraction=, --preset=" >&2
      exit 1
      ;;
  esac
done

export _PROFILE_ENGINE _PROFILE_OCR _PROFILE_EXTRACTION _PROFILE_PRESET

# Validate all selections
validate_all

# Resolve and export env vars from profiles
resolve_profiles

# Print summary
echo ""
echo "--- Profile Summary ---"
[[ -n "$_PROFILE_PRESET" ]]    && echo "  preset:     $_PROFILE_PRESET"
[[ -n "$_PROFILE_ENGINE" ]]    && echo "  engine:     $_PROFILE_ENGINE"
[[ -n "$_PROFILE_OCR" ]]       && echo "  ocr:        $_PROFILE_OCR"
[[ -n "$_PROFILE_EXTRACTION" ]]&& echo "  extraction: $_PROFILE_EXTRACTION"
echo ""

# Show resolved env vars that matter
summary_vars=(SLM_ENGINE OCR_ENGINE OCR_PROVIDER APP_MANIFEST_PATH SLM_EXTRACTION_PIPELINE SLM_MULTI_STEP_EXTRACTION RESTART_LOCAL_ML LLAMA_PARSE_EXTRACT_ENABLED LLAMA_PARSE_EXTRACT_TIER FIELD_VERIFIER_PROVIDER)
has_vars=false
for var in "${summary_vars[@]}"; do
  if [[ -n "${!var+x}" && -n "${!var}" ]]; then
    if [[ "$has_vars" == false ]]; then
      echo "  Resolved env:"
      has_vars=true
    fi
    printf "    %-35s %s\n" "$var" "${!var}"
  fi
done
[[ "$has_vars" == true ]] && echo ""
echo "-----------------------"
echo ""

# Dispatch to target
case "$TARGET" in
  docker)
    exec bash "$SCRIPTS_DIR/docker-up.sh"
    ;;
  slm)
    exec bash "$SCRIPTS_DIR/slm-restart.sh"
    ;;
  benchmark)
    exec bash "$SCRIPTS_DIR/benchmark-ml.sh"
    ;;
  *)
    echo "Unknown target: $TARGET" >&2
    echo "Valid targets: docker, slm, benchmark" >&2
    exit 1
    ;;
esac
