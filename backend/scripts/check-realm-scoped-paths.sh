#!/usr/bin/env bash
# Sync guard between BE composite-key middleware and the FE classifier.
#
# - Enumerates every BE route registered with `requireActiveClientOrg`.
# - Reads the FE classifier's REALM_SCOPED_PATH_PREFIXES list.
# - Fails CI if any BE-protected route literal is not classified as
#   realm-scoped by a FE prefix (i.e. the FE interceptor would forget to
#   inject the active clientOrgId, BE would 400, user gets stuck).
#
# Long-term, prefer code-generating the FE list from the BE middleware
# contract (see follow-up issue referenced in classifyApiPath.ts).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BE_ROUTES_DIR="$REPO_ROOT/backend/src/routes"
FE_CLASSIFIER="$REPO_ROOT/frontend/src/api/classifyApiPath.ts"

if [ ! -d "$BE_ROUTES_DIR" ]; then
  echo "error: backend routes dir not found at $BE_ROUTES_DIR" >&2
  exit 2
fi
if [ ! -f "$FE_CLASSIFIER" ]; then
  echo "error: FE classifier not found at $FE_CLASSIFIER" >&2
  exit 2
fi

# 1. Extract FE realm-scoped prefixes from the classifier source (between the
#    REALM_SCOPED_PATH_PREFIXES opening bracket and its closing `] as const`).
FE_PREFIXES="$(sed -n '/REALM_SCOPED_PATH_PREFIXES = \[/,/^\] as const;/p' "$FE_CLASSIFIER" \
  | grep -oE '"[^"]+"' \
  | sed -E 's/^"//; s/"$//')"

if [ -z "$FE_PREFIXES" ]; then
  echo "error: could not parse REALM_SCOPED_PATH_PREFIXES from $FE_CLASSIFIER" >&2
  exit 2
fi

# 2. Enumerate BE realm-scoped route literals.
#    Two patterns to capture:
#      a) router.<verb>("/path", requireActiveClientOrg, ...)
#      b) router.use(requireActiveClientOrg) — which protects every subsequent
#         router.<verb>("/path", ...) in that file.
#    For (b) we walk each file and, after seeing `router.use(requireActiveClientOrg)`,
#    treat all later route registrations as realm-scoped.
BE_ROUTES="$(
  python3 - "$BE_ROUTES_DIR" <<'PY'
import os, re, sys
root = sys.argv[1]
verb_re = re.compile(r'router\.(get|post|put|patch|delete)\(\s*"([^"]+)"')
file_use_re = re.compile(r'router\.use\(\s*requireActiveClientOrg')
inline_re = re.compile(r'router\.(get|post|put|patch|delete)\(\s*"([^"]+)"\s*,[^)]*requireActiveClientOrg')
for dirpath, _, files in os.walk(root):
    for f in files:
        if not f.endswith(".ts") or f.endswith(".test.ts"):
            continue
        path = os.path.join(dirpath, f)
        with open(path) as fh:
            text = fh.read()
        # Per-file flag: after `router.use(requireActiveClientOrg)`, every later route is realm-scoped.
        idx = text.find("router.use(requireActiveClientOrg")
        protected_after = idx if idx >= 0 else None
        for m in verb_re.finditer(text):
            verb, route = m.group(1), m.group(2)
            offset = m.start()
            # Inline middleware on this route?
            line_end = text.find("\n", offset)
            line = text[offset:line_end if line_end >= 0 else None]
            inline_protected = "requireActiveClientOrg" in line
            file_protected = protected_after is not None and offset > protected_after
            if inline_protected or file_protected:
                print(route)
PY
)"

if [ -z "$BE_ROUTES" ]; then
  echo "error: could not extract any requireActiveClientOrg routes from $BE_ROUTES_DIR" >&2
  exit 2
fi

# Known divergences: BE routes whose path contains an Express `:param` segment
# in the middle and so cannot be matched by the FE classifier's static-prefix
# strategy. Listed here with the tracking issue for the long-term code-gen
# fix; remove a line as soon as the FE switches to a wildcard-aware matcher.
KNOWN_DIVERGENCES=(
  "/tenant/:tenantId/export-config"  # follow-up: #170 (post-pivot code-gen)
)

# 3. For each BE route literal, check that some FE prefix matches it
#    (path === prefix OR path startsWith prefix + "/").
MISSING=()
while IFS= read -r route; do
  # Skip known-divergence entries.
  skip=0
  for known in "${KNOWN_DIVERGENCES[@]}"; do
    if [ "$route" = "$known" ]; then skip=1; break; fi
  done
  if [ $skip -eq 1 ]; then continue; fi

  matched=0
  while IFS= read -r prefix; do
    if [ "$route" = "$prefix" ] || [[ "$route" == "$prefix"/* ]]; then
      matched=1
      break
    fi
  done <<< "$FE_PREFIXES"
  if [ $matched -eq 0 ]; then
    MISSING+=("$route")
  fi
done <<< "$(echo "$BE_ROUTES" | sort -u)"

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "error: FE classifier is out of sync with BE requireActiveClientOrg middleware." >&2
  echo "       The following BE realm-scoped routes are NOT covered by any FE prefix" >&2
  echo "       in REALM_SCOPED_PATH_PREFIXES (see $FE_CLASSIFIER):" >&2
  for r in "${MISSING[@]}"; do
    echo "         - $r" >&2
  done
  exit 1
fi

echo "ok: FE classifier covers all $(echo "$BE_ROUTES" | sort -u | wc -l | tr -d ' ') BE realm-scoped routes."
