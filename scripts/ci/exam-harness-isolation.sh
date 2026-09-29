#!/usr/bin/env bash
# =============================================================================
# E7b — the exam e2e harness cannot be reached from a production build.
# =============================================================================
# @spec [E7b owner ruling 6: "Confirm the stub can't be reached from a production
#        build."] | @implemented [2026-09-25]
#
# plain English: the harness (tests/e2e/exam-harness) swaps the Supabase clients,
# the auth guards and the entitlement check for a one-student stub. Three facts keep
# that stub out of production, and this gate checks each:
#   I1  no file outside tests/ names the harness (so nothing can import it);
#   I2  the built bundle (dist/, after `pnpm run build:vercel`) contains none of the
#       harness's marker strings;
#   I3  the harness refuses to start with NODE_ENV=production.
# The redirect itself only exists in a process started with
# `--import tests/e2e/exam-harness/register.mjs`, which no build or start script does.
#
# usage: bash scripts/ci/exam-harness-isolation.sh [ROOT] [DIST]
#   (ROOT/DIST default to the repo and its dist/; the self-test points them at plants)
# =============================================================================
set -uo pipefail
ROOT="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
DIST="${2:-$ROOT/dist}"
fail=0

# I1 — sources outside tests/ never name the harness's directory (an import needs it).
hits=$(grep -rIl --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  --exclude-dir=tests --exclude-dir=docs --exclude-dir=test-results \
  --exclude=exam-harness-isolation.sh --exclude=exam-harness-isolation.selftest.sh \
  -e 'e2e/exam-harness' -e 'exam_e2e_harness' "$ROOT" 2>/dev/null || true)
if [ -n "$hits" ]; then
  echo "FAIL [I1] the exam e2e harness is named outside tests/:"; echo "$hits"; fail=1
else
  echo "ok   [I1] nothing outside tests/ names the exam e2e harness"
fi

# I2 — the production bundle carries none of the harness's markers.
if [ ! -d "$DIST" ]; then
  echo "FAIL [I2] no $DIST — run the production build first"; fail=1
else
  markers='exam e2e harness|exam_e2e_harness|not_in_harness|Not served by the exam harness|e2e-harness'
  bundle_hits=$(grep -rIlE "$markers" "$DIST" 2>/dev/null || true)
  if [ -n "$bundle_hits" ]; then
    echo "FAIL [I2] harness markers in the production bundle:"; echo "$bundle_hits"; fail=1
  else
    echo "ok   [I2] the production bundle ($DIST) carries no harness marker"
  fi
fi

# I3 — the harness refuses NODE_ENV=production (checked before any DB work).
if [ -f "$ROOT/tests/e2e/exam-harness/server.ts" ]; then
  out=$(cd "$ROOT" && NODE_ENV=production timeout 60 pnpm -s exec tsx tests/e2e/exam-harness/server.ts 2>&1)
  code=$?
  if [ $code -ne 0 ] && echo "$out" | grep -q "never runs with NODE_ENV=production"; then
    echo "ok   [I3] the harness refuses NODE_ENV=production"
  else
    echo "FAIL [I3] the harness started (or failed for another reason) under NODE_ENV=production"; fail=1
  fi
fi

exit $fail
