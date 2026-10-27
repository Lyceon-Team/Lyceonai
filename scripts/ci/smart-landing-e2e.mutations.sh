#!/usr/bin/env bash
# ============================================================================
# The planted defect for the smart landing browser spec (tests/e2e/smart-landing.spec.ts)
# ============================================================================
# @spec [owner change "Smart landing: replacing the multi-section sets" (Karl, 2026-10-26) item 4:
#   "an end-to-end test that opens the set_math_5 session and the 5 more session in the real
#   session page and reaches question 1, plus a planted defect that breaks it. That's the gap that
#   let today's bug through"] | @implemented [2026-10-26]
#
# The plant puts today's bug back, exactly as it shipped: the landing set is started with no
# section of its own (`section: null`) across Math and Reading and Writing. Every server-side
# suite of the time passed with it; the session page could not open the session it built. The
# spec must go RED on BOTH cases (the set and "5 more" share the start), each on its own failure
# line, never on a name that only appears in a passing line.
#
# Same rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The spec fails, with `2 failed` and a failure (✘) line for each case.
#   RULE 3 — GREEN BASELINE + RESTORE. The spec is green before the plant; the file is restored
#            after it (and on exit).
#
# needs: what tests/e2e/run-student-harness-e2e.sh needs (Postgres, Chromium).
# usage: bash scripts/ci/smart-landing-e2e.mutations.sh
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/../.."

DEPS="server/services/landing/landing-deps.ts"
RUN=(bash tests/e2e/run-student-harness-e2e.sh smart-landing tests/e2e/smart-landing.spec.ts)
PASS=0; FAIL=0
BACKUP="$(mktemp)"
cp "$DEPS" "$BACKUP"
restore() { cp "$BACKUP" "$DEPS"; }
trap 'restore; rm -f "$BACKUP"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — exactly one occurrence, or STALE.
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

failed_line() { # <output> <case name>: a ✘ line that names the case
  local nl=$'\n'
  [[ "$nl$1" =~ $nl[^$nl]*✘[^$nl]*"› $2" ]]
}

echo "=== (0) GREEN BASELINE ==="
OUT="$("${RUN[@]}" 2>&1)"; RC=$?
case "$OUT" in
  *"2 passed"*) [ "$RC" = 0 ] && ok "baseline green (2 passed)" || bad "baseline exit $RC" ;;
  *) bad "baseline not green"; echo "$OUT" | grep -E "✘|✓|passed|failed|Error" | tail -20 ;;
esac
if [ "$FAIL" -gt 0 ]; then echo "SMART LANDING E2E MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (E1) the landing set spans Math and Reading and Writing with no section (today's bug) ==="
plant "$DEPS" "    const sections: (\"M\" | \"RW\")[] = [...LANDING_SET_SECTIONS];" \
  "    const sections: (\"M\" | \"RW\")[] = [\"M\", \"RW\"];" || { bad "E1a STALE"; exit 1; }
plant "$DEPS" "      section: LANDING_SET_SECTIONS[0]," "      section: null," || { bad "E1b STALE"; exit 1; }
OUT="$("${RUN[@]}" 2>&1)"; RC=$?
restore
if [ "$RC" = 0 ]; then
  bad "E1 the spec stayed GREEN (the plant was not caught)"
else
  case "$OUT" in
    *"2 failed"*)
      if failed_line "$OUT" "L1 set_math_5" && failed_line "$OUT" "L2 qotd_then_more"; then
        ok "E1 red on both cases: L1 set_math_5, L2 qotd_then_more"
      else
        bad "E1 red, but not with a failure line for each case"
        echo "$OUT" | grep -E "✘|✓|passed|failed" | tail -10
      fi ;;
    *) bad "E1 red, but not '2 failed'"; echo "$OUT" | grep -E "✘|✓|passed|failed|Error" | tail -20 ;;
  esac
fi

echo
echo "SMART LANDING E2E MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
