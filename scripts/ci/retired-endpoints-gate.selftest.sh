#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Self-test for scripts/ci/retired-endpoints-gate.mjs
#
# @spec [owner ruling 2026-08-21 Q4 (a gate asserting no caller remains); owner standing
#        rule — "every gate names the mutation that must turn it red"]
# @implemented 2026-08-21
#
# plain English: stages each mutation the gate claims to catch, runs it, asserts it exits
# non-zero for the stated reason, and restores the tree on every exit path.
# ---------------------------------------------------------------------------
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

GATE="scripts/ci/retired-endpoints-gate.mjs"
CALLER_TARGET="client/src/lib/masteryApi.ts"
FAILURES=0

restore() {
  git checkout -- "$CALLER_TARGET" "$GATE" 2>/dev/null || true
}
trap restore EXIT INT TERM

if ! git diff --quiet -- "$CALLER_TARGET" "$GATE"; then
  echo "FAIL: the self-test's targets have uncommitted changes; refusing to stage over them." >&2
  exit 1
fi

if ! node "$GATE" >/dev/null 2>&1; then
  echo "FAIL: the gate is already red on the committed tree — no mutation below proves anything." >&2
  node "$GATE" >&2
  exit 1
fi
echo "ok  baseline: gate is green on the committed tree"

# 1. a caller comes back. This is the whole point: the endpoint is gone, and a string
#    referencing it is invisible to tsc.
sed -i 's|"/api/me/mastery/domains"|"/api/me/mastery/summary"|' "$CALLER_TARGET"
if git diff --quiet -- "$CALLER_TARGET"; then
  echo "FAIL  caller reintroduced: could not stage the mutation — the case is stale, not passing." >&2
  FAILURES=$((FAILURES + 1))
else
  out="$(node "$GATE" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    echo "FAIL  caller reintroduced: gate exited 0 with a live caller of a retired path." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$out" | grep -q "$CALLER_TARGET"; then
    echo "FAIL  caller reintroduced: gate went red but never named $CALLER_TARGET." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$out" | grep -q "use instead:"; then
    echo "FAIL  caller reintroduced: gate named the file but not the replacement." >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "ok  caller reintroduced -> rc=$rc, names the file and the replacement"
  fi
fi
restore

# 2. scanning nothing is a FAILURE, not a pass.
zero_out="$(RETIRED_ENDPOINTS_PATHSPEC='*.this-matches-nothing' node "$GATE" 2>&1)"
zero_rc=$?
if [ "$zero_rc" -eq 0 ]; then
  echo "FAIL  zero scanned files: gate exited 0. An empty scan is a broken gate, not a clean tree." >&2
  FAILURES=$((FAILURES + 1))
elif ! printf '%s' "$zero_out" | grep -q "ZERO files"; then
  echo "FAIL  zero scanned files: gate went red but did not say why." >&2
  FAILURES=$((FAILURES + 1))
else
  echo "ok  zero scanned files -> rc=$zero_rc, refuses to report a clean tree"
fi

# 3. an empty retired table is a gate that cannot fail. That is not the same as a clean
#    tree, and it must not read as a pass.
sed -i 's|^const RETIRED = \[$|const RETIRED = [];\nconst RETIRED_DISABLED_BY_SELFTEST = [|' "$GATE"
if git diff --quiet -- "$GATE"; then
  echo "FAIL  empty table: could not stage the mutation — the case is stale, not passing." >&2
  FAILURES=$((FAILURES + 1))
else
  empty_out="$(node "$GATE" 2>&1)"
  empty_rc=$?
  if [ "$empty_rc" -eq 0 ]; then
    echo "FAIL  empty table: gate exited 0 with nothing to check." >&2
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s' "$empty_out" | grep -q "checks nothing"; then
    echo "FAIL  empty table: gate went red but did not say why." >&2
    printf '%s\n' "$empty_out" >&2
    FAILURES=$((FAILURES + 1))
  else
    echo "ok  empty retired table -> rc=$empty_rc, refuses to pass on an empty check set"
  fi
fi
restore

if [ "$FAILURES" -ne 0 ]; then
  echo "" >&2
  echo "FAIL: $FAILURES self-test case(s) failed — the retired-endpoints gate does not catch what it claims." >&2
  exit 1
fi

echo ""
echo "OK: retired-endpoints gate self-test — every named mutation turns it red."
