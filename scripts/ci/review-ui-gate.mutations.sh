#!/usr/bin/env bash
# Review UI mutation gate — proves every U-test is load-bearing.
#
# @spec [brief R4 §3 ("Every assertion is planted"), U1-U9] | @implemented [2026-09-22]
#
# A gate counts only after its plant has turned THAT SPECIFIC test red and been
# reverted byte-identically. This script does that for U1-U9: it snapshots every
# product source file it will touch, applies one plant at a time, asserts the named
# test file FAILS, restores the snapshot, and `cmp`s the restore.
#
# PLANTS MUTATE PRODUCT SOURCE, NEVER A TEST FILE. A plant that edits the test proves
# only that the test can be broken, which was never in doubt.
#
# Usage:  bash scripts/ci/review-ui-gate.mutations.sh
# Exit 0 only if every plant produced a failure and every revert was byte-identical.

set -uo pipefail
cd "$(dirname "$0")/../.."
REPO="$PWD"

SNAP="$(mktemp -d)"
trap 'restore_all; rm -rf "$SNAP"' EXIT

FILES=(
  "client/src/lib/engine-config.ts"
  "client/src/lib/review-session-picker.ts"
  "client/src/hooks/useReview.ts"
  "client/src/pages/review.tsx"
  "client/src/pages/resume-review.tsx"
  "client/src/pages/resume-practice.tsx"
  "client/src/components/practice/CanonicalPracticePage.tsx"
  "client/src/components/layout/app-shell.tsx"
  "packages/shared/src/return-path.ts"
)

snapshot_all() {
  for f in "${FILES[@]}"; do
    mkdir -p "$SNAP/$(dirname "$f")"
    cp "$REPO/$f" "$SNAP/$f"
  done
}

restore_all() {
  for f in "${FILES[@]}"; do
    [ -f "$SNAP/$f" ] && cp "$SNAP/$f" "$REPO/$f"
  done
}

verify_clean_revert() {
  local bad=0
  for f in "${FILES[@]}"; do
    if ! cmp -s "$SNAP/$f" "$REPO/$f"; then
      echo "  !! REVERT NOT BYTE-IDENTICAL: $f"
      bad=1
    fi
  done
  return $bad
}

PASS=0
FAIL=0

# plant <id> <description> <test-path> <file> <python-mutation>
plant() {
  local id="$1" desc="$2" tests="$3" file="$4" mutation="$5"

  printf '\n── %s ── %s\n' "$id" "$desc"

  if ! python3 - "$REPO/$file" <<PY
import sys
p = sys.argv[1]
s = open(p).read()
$mutation
open(p, "w").write(s)
PY
  then
    echo "  !! PLANT DID NOT APPLY (anchor missed) — $id"
    FAIL=$((FAIL + 1)); restore_all; return
  fi

  if pnpm -s exec vitest run $tests >/dev/null 2>&1; then
    echo "  !! NO-OP PLANT: $tests still GREEN with $id applied"
    FAIL=$((FAIL + 1))
  else
    echo "  ✓ red on plant"
    PASS=$((PASS + 1))
  fi

  restore_all
  if ! verify_clean_revert; then FAIL=$((FAIL + 1)); fi
}

snapshot_all
echo "Snapshot: $SNAP"

# ── U1 — practice's existing UI tests pass unchanged with the engine config ──────────
plant "U1" "point practice's create endpoint at a wrong URL" \
  "client/src/components/practice client/src/pages/resume-practice.test.tsx" \
  "client/src/lib/engine-config.ts" \
  'a = "    create: () => \"/api/practice/sessions\","
assert s.count(a) == 1
s = s.replace(a, "    create: () => \"/api/practice/sessions-WRONG\",", 1)'

# ── U2 — no reveal before submit ─────────────────────────────────────────────────────
plant "U2" "render the reveal pre-submit (force showResult in the loop)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/components/practice/CanonicalPracticePage.tsx" \
  'a = "            showResult={showResult}"
assert s.count(a) == 1
s = s.replace(a, "            showResult={true}", 1)'

# ── U3 — the session id lives in the URL ─────────────────────────────────────────────
plant "U3" "keep the id out of the URL (component-local only)" \
  "client/src/pages/resume-review.test.tsx" \
  "client/src/pages/resume-review.tsx" \
  'a = "  const sessionId = params?.sessionId;"
assert s.count(a) == 1
s = s.replace(a, "  const sessionId: string | undefined = undefined;", 1)'

# ── U4 — all three entry modes render ────────────────────────────────────────────────
plant "U4" "drop the topic section from the landing" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "<div className=\"space-y-5\" data-testid=\"review-topic-picker\">"
assert s.count(a) == 1
s = s.replace(a, "<div className=\"space-y-5\" data-testid=\"review-topic-picker-REMOVED\">", 1)'

# ── U5 — day grouping uses the BROWSER timezone ──────────────────────────────────────
plant "U5" "compute today in UTC instead of the browser timezone" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "    () => localDateKey(new Date(), browserTimeZone()),"
assert s.count(a) == 1
s = s.replace(a, "    () => localDateKey(new Date(), \"UTC\"),", 1)'

# ── U6 — an empty pool is not an error ───────────────────────────────────────────────
plant "U6" "render the error component for an empty pool" \
  "client/src/pages/review.test.tsx" \
  "client/src/pages/review.tsx" \
  'a = "      data-testid=\"review-empty-state\""
assert s.count(a) == 1
s = s.replace(a, "      data-testid=\"review-pool-error\"", 1)'

# ── U7 — abandoned sessions appear in no open list, in either engine ─────────────────
plant "U7a" "review: stop dropping closed rows before the parse" \
  "client/src/hooks/useReview.test.tsx" \
  "client/src/hooks/useReview.ts" \
  'a = "export function dropClosedSessions(raw: unknown): unknown {"
assert s.count(a) == 1
s = s.replace(a, "export function dropClosedSessions(raw: unknown): unknown {\n  return raw;", 1)'

plant "U7b" "practice: remove the read-only guard from the resume shell" \
  "client/src/pages/resume-practice.readonly.test.tsx" \
  "client/src/pages/resume-practice.tsx" \
  'a = "  if (session.readOnly) {"
assert s.count(a) == 1
s = s.replace(a, "  if (false) {", 1)'

# ── U8 — review is reachable from the global nav ─────────────────────────────────────
plant "U8" "remove the Review entry from the live global nav" \
  "client/src/review-entry-points.test.ts" \
  "client/src/components/layout/app-shell.tsx" \
  'a = "    { href: \"/review\", label: \"Review\", icon: RotateCcw },\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

# ── U9 — /review is in RETURN_PATH_ALLOWLIST ─────────────────────────────────────────
plant "U9" "remove /review from RETURN_PATH_ALLOWLIST" \
  "client/src/review-entry-points.test.ts" \
  "packages/shared/src/return-path.ts" \
  'a = "  \"/review\",\n"
assert s.count(a) == 1
s = s.replace(a, "", 1)'

printf '\n────────────────────────────────\n'
echo "plants red as expected: $PASS"
echo "failures:               $FAIL"

if [ "$FAIL" -ne 0 ]; then
  echo "GATE FAILED"
  exit 1
fi

# Final proof: with every plant reverted, the suite is green again.
echo
echo "Re-running the full client suite on the restored tree..."
if pnpm -s exec vitest run client/src >/dev/null 2>&1; then
  echo "GATE PASSED — all plants red, all reverts byte-identical, suite green"
  exit 0
fi
echo "!! suite is NOT green after revert"
exit 1
