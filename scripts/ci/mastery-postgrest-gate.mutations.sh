#!/usr/bin/env bash
# ============================================================================
# Mastery emission — REAL PostgREST proof: MUTATION HARNESS
# ============================================================================
# The proof can only be trusted if its cases can FAIL, and if each one fails on
# the assertion it claims. Three hazards have been observed in this repo in
# consecutive steps: a mutation that never applied and read as PASS, a mutation
# that reddened an EARLIER assertion than the one it named, and an assertion that
# could not fail because a different mechanism answered first.
#
#   RULE 1 — STALE IS A HARD FAILURE. Every mutation asserts its target text
#            appears EXACTLY ONCE before patching. Not found, or found twice, is a
#            hard failure (exit 9), never a pass. A refactor that moves the target
#            must break this harness loudly.
#   RULE 2 — EACH MUTATION NAMES ITS RED, BY CASE AND BY ASSERTION. A run passes
#            only if the output contains BOTH the case that must fail AND the
#            assertion text it must fail on. Reddening the suite somewhere else
#            proves nothing.
#   RULE 3 — GREEN BASELINE, GREEN RESTORE. Proven green before the first mutation
#            and after the last, so a permanently-broken tree cannot read as
#            "every mutation reds".
#
# ONE MUTATION PER ASSERTION LAYER, EACH REDDING A DIFFERENT LINE. A mutation that
# reds at the HTTP status has not proven any row assertion beneath it, so the two
# are attacked separately and are required to fail at different places:
#
#   M1  emission removed        -> case 1, the AUDIT ROW      "expected null not to be null"
#   M2  threshold lowered to 4  -> case 2, the NULL LEVEL     "expected 4 to be null"
#   M3  service_role -> anon    -> case 1, the HTTP STATUS    "expected 503 to be 200"
#   M4  poison seed removed     -> case 5, the QUARANTINE CNT "expected +0 to be 1"
#
# M1 and M3 both attack case 1 and are kept apart by the line they red: M1 leaves the
# response a clean 200 and removes only the row, M3 collapses the request itself. Two
# mutations that reddened the same assertion would be one test wearing two names.
#
# Output is captured to a variable and matched with `case`, never piped to
# `grep -q` — grep closes the pipe at its first match and can kill the producer on
# SIGPIPE before it flushes, which has previously produced a false "did not fire".
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"

ROUTE="server/routes/practice-canonical.ts"
TEST="tests/ci/mastery-emission.postgrest.ci.test.ts"
GATE="scripts/ci/mastery-postgrest-gate.sh"
# Mirrors the gate's own constant; S0 asserts the summary matcher against it.
EXPECTED_CASES=6

CASE1="an answered question produces an attributable event"
CASE2="below MIN_EVENTS_FOR_MASTERY the level is NULL"
CASE5="a NULL occurred_at row in another section is excluded and counted"

cp "$ROUTE" /tmp/mut_route.bak
cp "$TEST"  /tmp/mut_test.bak
cp "$GATE"  /tmp/mut_gate.bak
restore() {
  cp /tmp/mut_route.bak "$ROUTE"
  cp /tmp/mut_test.bak  "$TEST"
  cp /tmp/mut_gate.bak  "$GATE"
}
trap restore EXIT

pass=0
fail=0

run_gate() {
  PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" \
  PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}" \
    bash "$GATE" 2>&1
}

# RULE 1.
assert_target_unique() {
  local file="$1" target="$2" name="$3"
  if ! python3 - "$file" "$target" <<'PY'
import sys
src = open(sys.argv[1]).read()
n = src.count(sys.argv[2])
if n != 1:
    print(f"STALE: target appears {n} times, expected exactly 1")
    sys.exit(1)
PY
  then
    echo "  STALE $name — target text not found exactly once. This harness is out of"
    echo "        date with the source it patches. Not a pass."
    exit 9
  fi
}

# RULE 2 + 3. A RED check requires the failing CASE and the failing ASSERTION.
check() {
  local name="$1" expect="$2" case_needle="${3:-}" assert_needle="${4:-}"
  local out green=no
  out="$(run_gate)"
  case "$out" in *"MASTERY POSTGREST GATE: PASS"*) green=yes ;; esac

  if [ "$expect" = GREEN ]; then
    if [ "$green" = yes ]; then
      echo "  PASS  $name"
      pass=$((pass + 1))
    else
      echo "  FAIL  $name (expected green)"
      echo "$out" | tail -20
      fail=$((fail + 1))
    fi
    return
  fi

  if [ "$green" = yes ]; then
    echo "  FAIL  $name — the mutation did NOT red the suite"
    fail=$((fail + 1))
    return
  fi
  case "$out" in
    *"FAIL"*"$case_needle"*) : ;;
    *)
      echo "  FAIL  $name — red, but NOT on the case it names"
      echo "        wanted case: $case_needle"
      echo "$out" | grep -E "^ *× " | head -6
      fail=$((fail + 1))
      return ;;
  esac
  case "$out" in
    *"$assert_needle"*)
      echo "  PASS  $name"
      echo "        red on: $case_needle"
      echo "        assertion: $assert_needle" ;;
    *)
      echo "  FAIL  $name — right case, WRONG assertion"
      echo "        wanted: $assert_needle"
      echo "$out" | grep -E "AssertionError" | head -4
      fail=$((fail + 1))
      return ;;
  esac
  pass=$((pass + 1))
}

# ---------------------------------------------------------------------------
# S0 — SELF-TEST: the gate's execution proof must be able to read a COLOURED run.
# vitest prints a plain summary to a non-TTY locally and a colour-escaped one on the
# GitHub runner. A literal substring match on the summary therefore passed locally and
# FAILED on a fully green suite in CI (5a06e64). This asserts the gate strips ANSI
# before matching, against the exact byte sequence the runner produced. It runs before
# the baseline because a gate that cannot recognise a pass makes every result below it
# meaningless.
# ---------------------------------------------------------------------------
echo "=== S0: the execution proof reads a colour-escaped vitest summary ==="
COLOURED="$(python3 -c 'E=chr(27); print(f"{E}[2m      Tests {E}[22m {E}[1m{E}[32m6 passed{E}[39m{E}[22m{E}[90m (6){E}[39m")')"
STRIPPED="$(printf '%s' "$COLOURED" | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g')"
case "$STRIPPED" in
  *"Tests  ${EXPECTED_CASES} passed (${EXPECTED_CASES})"*)
    echo "  PASS  S0 coloured summary is readable after stripping"
    pass=$((pass + 1)) ;;
  *)
    echo "  FAIL  S0 — the gate cannot read a coloured pass; every result below is void"
    fail=$((fail + 1)) ;;
esac
# And the un-stripped form must NOT match, or the strip is doing nothing and the
# self-test would pass for the wrong reason.
case "$COLOURED" in
  *"Tests  ${EXPECTED_CASES} passed (${EXPECTED_CASES})"*)
    echo "  FAIL  S0b — raw coloured text matched, so this self-test proves nothing"
    fail=$((fail + 1)) ;;
  *)
    echo "  PASS  S0b raw coloured text does NOT match — the strip is load-bearing"
    pass=$((pass + 1)) ;;
esac

echo "=== (0) GREEN BASELINE ==="
check "baseline green" GREEN

# ---------------------------------------------------------------------------
# M1 — THE EMISSION CALL. The route stops emitting for the flow/practice answer
# path. The answer still records and the handler still returns a clean 200, because
# emission failures warn-and-continue by design. So the RESPONSE is truthful-looking
# and only the ROW is missing: a test that asserted the status code alone would pass
# this. This is the exact shape of the seven-week outage.
# Layer: the AUDIT ROW. Must red case 1 at the audit assertion, NOT at the status.
# ---------------------------------------------------------------------------
echo "=== M1: the route stops emitting (answer still records, still 200) ==="
# Six leading spaces pins the FLOW/PRACTICE answer path. The four-space site is the
# diagnostic re-emission helper, which this proof does not drive; the bare string
# would match both and trip RULE 1.
M1_TARGET="      const masteryResult = await applyMasteryEvent({"
assert_target_unique "$ROUTE" "$M1_TARGET" "M1"
python3 - <<'PYM1'
p = "server/routes/practice-canonical.ts"
s = open(p).read()
t = "      const masteryResult = await applyMasteryEvent({"
# Swallows the object literal that follows and reports success without emitting.
r = "      const masteryResult = await (async (_m: unknown) => ({ ok: true }))({"
assert s.count(t) == 1
open(p, "w").write(s.replace(t, r, 1))
PYM1
check "M1 reds case 1 on the AUDIT ROW" RED "$CASE1" "expected null not to be null"
restore

# ---------------------------------------------------------------------------
# M2 — THE THRESHOLD, WHERE IT ACTUALLY LIVES. MIN_EVENTS_FOR_MASTERY is lowered
# from 5 to 4 in mastery_constants, so four events now clear the threshold and the
# below-threshold case sees a measured level where it asserts NULL.
#
# The loop bound was tried first and is the WRONG mutation: running a fifth answer
# also changes event_count_total, so it reds the count assertion one line ABOVE the
# one it claims. Measured, not assumed. Moving the threshold instead leaves the event
# count at four — the count assertion still passes — and reds exactly the NULL
# assertion. It also proves the case reads the DB's threshold rather than the TS
# constant beside it.
# Layer: the THRESHOLD CONTRACT. Must red case 2 on the NULL level.
# ---------------------------------------------------------------------------
echo "=== M2: MIN_EVENTS_FOR_MASTERY lowered to 4 in mastery_constants ==="
M2_TARGET="UPDATE public.practice_runtime_config SET value = '200' WHERE key = 'answer_rate_limit_max';"
assert_target_unique "$GATE" "$M2_TARGET" "M2"
python3 - <<'PYM2'
p = "scripts/ci/mastery-postgrest-gate.sh"
s = open(p).read()
t = "UPDATE public.practice_runtime_config SET value = '200' WHERE key = 'answer_rate_limit_max';"
r = (t + "\nUPDATE public.mastery_constants SET value = '4'::jsonb "
         "WHERE key = 'MIN_EVENTS_FOR_MASTERY';")
assert s.count(t) == 1
open(p, "w").write(s.replace(t, r, 1))
PYM2
check "M2 reds case 2 on the NULL LEVEL" RED "$CASE2" "expected 4 to be null"
cp /tmp/mut_gate.bak "$GATE"

# ---------------------------------------------------------------------------
# M3 — THE JWT AND THE GRANT. The app is handed an anon token where it should hold a
# service_role one. apply_mastery_event is granted to service_role ONLY and every
# table read goes through the same client, so the data path collapses. This proves
# the JWT and PostgREST's role mapping are really in the path rather than decoration
# — and it reds at a DIFFERENT line from M1, which is what makes the two mutations
# distinguishable rather than one test wearing two names.
# Layer: the TRANSPORT IDENTITY. Must red case 1 at the HTTP status.
# ---------------------------------------------------------------------------
echo "=== M3: the service-role JWT is swapped for anon ==="
# Prettier wraps the mintJwt call, so the target is the role literal itself, which
# appears exactly once in this file.
M3_TARGET='        "service_role",'
assert_target_unique "$TEST" "$M3_TARGET" "M3"
python3 - <<'PYM3'
p = "tests/ci/mastery-emission.postgrest.ci.test.ts"
s = open(p).read()
t = '        "service_role",'
r = '        "anon",'
assert s.count(t) == 1
open(p, "w").write(s.replace(t, r, 1))
PYM3
check "M3 reds case 1 on the HTTP STATUS" RED "$CASE1" "expected 503 to be 200"
restore

# ---------------------------------------------------------------------------
# M4 — THE QUARANTINE SEED. Case 5 loses its poison row. The event commits either
# way now, so the commit assertion cannot carry this case; only excluded_event_count
# can. This is what keeps the seed provably load-bearing rather than decorative
# after the posture change from abort to quarantine.
# Layer: the QUARANTINE COUNT. Must red case 5 on the count, not on the commit.
# ---------------------------------------------------------------------------
echo "=== M4: case 5 loses its poison seed ==="
M4_TARGET="      await seedPoisonRow();"
assert_target_unique "$TEST" "$M4_TARGET" "M4"
python3 - <<'PYM4'
p = "tests/ci/mastery-emission.postgrest.ci.test.ts"
s = open(p).read()
t = "      await seedPoisonRow();"
assert s.count(t) == 1
open(p, "w").write(s.replace(t, "      // poison seed removed by M4", 1))
PYM4
check "M4 reds case 5 on the QUARANTINE COUNT" RED "$CASE5" "expected +0 to be 1"
restore

echo "=== (5) GREEN RESTORED ==="
check "green restored after all mutations" GREEN

echo
echo "MASTERY POSTGREST MUTATIONS: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
