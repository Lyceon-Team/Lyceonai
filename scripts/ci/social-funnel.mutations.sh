#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the social funnel (owner brief "One funnel for every social post: /start +
# CTAs + weekly growth report", Karl, 2026-10-28, item 4: "Tests and planted defects")
# ============================================================================
# @spec [that brief items 1-4] | @implemented [2026-10-28]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared test name.
#   RULE 3 — RESTORED. Every file is put back after each plant and the suite re-checked green.
#
# What a sign-up records from the links' tags is the sign-up attribution's (#1359) and planted in
# its own harness (scripts/ci/signup-attribution.mutations.sh), not here.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/social-funnel-mut.XXXX)"

FILES=(
  "shared/social/funnel.ts"
  "shared/seo/head.ts"
)
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new>  — exactly one occurrence, or STALE (exit 9).
plant() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
    sys.exit(9)
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

ts_check() { pnpm exec vitest run "$@" 2>&1; }
CONTRACT=tests/ci/social-funnel.contract.test.ts

# ts_plant <name> <file> <old> <new> <expected test name> <test files...>
ts_plant() {
  local name="$1" file="$2" old="$3" new="$4" expect="$5"; shift 5
  plant "$file" "$old" "$new" || { bad "$name STALE"; restore; return; }
  OUT="$(ts_check "$@")"; RC=$?
  expect_red "$name" "$expect" "$OUT" "$RC"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check "$CONTRACT")"; RC=$?
[ "$RC" = 0 ] && ok "funnel contract tests green" || { bad "baseline not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "SOCIAL FUNNEL MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== /start and its copy (item 1) ==="
ts_plant "F4 the cohort line ends a day early" shared/social/funnel.ts \
  "  return chicagoToday <= START_COHORT_DATE ? \"cohort\" : \"evergreen\";" \
  "  return chicagoToday < START_COHORT_DATE ? \"cohort\" : \"evergreen\";" \
  "speaks to the Dec 5 cohort through test day" "$CONTRACT"
ts_plant "F5 /start loses noindex" shared/seo/head.ts \
  "    ...(meta.noindex ? [\`<meta name=\"robots\" content=\"noindex\" />\`] : []),"$'\n' \
  "" \
  "its head says noindex" "$CONTRACT"
ts_plant "F6 the headline promises a free study plan" shared/social/funnel.ts \
  "? Find your blind spots free before test day.\`" \
  "? Get your free study plan, built for test day.\`" \
  "no line promises a free study plan" "$CONTRACT"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$CONTRACT")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "SOCIAL FUNNEL MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
