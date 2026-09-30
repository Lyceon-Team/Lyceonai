#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the `exam_placement` comparison in
# scripts/ci/calendar-parity.ts
# ============================================================================
# @spec [Doc 05F formula sheet §2 Step 2; §10.1 snapshot] | @implemented [2026-09-29]
#
# plain English: it proves that the parity gate now reads each fixture's
# `exam_placement` block and compares it against `calendar_place_full_lengths`' own
# return — the suppression list included. Expected outcome: breaking either side, or
# the stored block, turns the gate red.
#
# WHY THE COMPARISON NEEDED PROVING RATHER THAN TRUSTING. Until this change the block
# existed in all 13 fixtures and NOTHING in the repository read it — a repo-wide search
# for `exam_placement` outside docs/Spec/ returned one hit, and it was a migration
# filename in a comment. The gate could not have read it from a plan either: the
# oracle's `generate()` does `exams, _suppressed = exam_dates(...)` and drops the second
# value, so a suppression never reaches a plan at all. The measured consequence: deleting
# the suppression arm from the oracle changed 0 of the 13 fixtures and 0 of 3000 suite
# cases (Brief 18 census, docs/plans/Calendar_Rule_Branch_Coverage_Census.md). A
# comparison added to end that state is worth exactly as much as its plants.
#
# THREE PLANTS, because the change added TWO comparisons and they fail independently:
#   P1  a fixture's stored `suppressed` is wrong  -> stored-vs-reference reds
#   P2  a fixture's stored `placed` is wrong      -> stored-vs-reference reds
#   P3  the DATABASE stops recording suppressions -> RPC-vs-oracle reds
# P3 is the one that matters most: it is the defect the fixtures were blind to.
#
# docs/Spec/ IS RESTORED FROM A BYTE COPY, and the harness FAILS if `git diff` sees the
# corpus changed when it is done — the locked corpus is not a place to leave a mutation,
# and "the trap probably ran" is not evidence that it did.
#
# A SMALL SUITE, not zero: `--suite-n 0` makes the oracle's own property suite divide by
# zero (`sum(tvd) / len(tvd)` over an empty list, calendar_formula_reference.py). That is
# the oracle's edge case and the oracle is read-only, so the harness passes 5.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$ROOT/docs/Spec/calendar_formula_fixtures.json"
SUITE_N=5
PASS=0; FAIL=0

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "CALENDAR PARITY PLACEMENT MUTATIONS: SKIPPED — no Postgres at $PGHOST:$PGPORT. A skip, not a pass."
  exit 0
fi

FIXBAK="$(mktemp /tmp/calfix-mut.XXXX.json)"
FNBAK="$(mktemp /tmp/calfn-mut.XXXX.sql)"
cp "$FIX" "$FIXBAK"
# The live definition, straight from the catalog. Restoring from this needs no file
# parsing and no pipeline rebuild, and it is exactly what was there before.
psql -qtAX -d "${PGDATABASE:-postgres}" \
  -c "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'calendar_place_full_lengths'" > "$FNBAK"
if [ ! -s "$FNBAK" ]; then
  echo "CALENDAR PARITY PLACEMENT MUTATIONS: FAIL — calendar_place_full_lengths is not in ${PGDATABASE:-postgres}"
  exit 1
fi

restore() {
  cp "$FIXBAK" "$FIX"
  psql -v ON_ERROR_STOP=1 -qtAX -d "${PGDATABASE:-postgres}" -f "$FNBAK" >/dev/null 2>&1
}
cleanup() { restore; rm -f "$FIXBAK" "$FNBAK"; }
trap cleanup EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

run_parity() {
  (cd "$ROOT" && pnpm exec tsx scripts/ci/calendar-parity.ts --suite-n "$SUITE_N" --suite-seed 1 2>&1)
}

# fixture_edit <python-expression-body> — mutates the fixtures JSON in place. The file is
# json.dumps(..., indent=1) plus a trailing newline, so a round-trip is byte-identical and
# the diff is only what the mutation changed.
fixture_edit() {
  python3 - "$FIX" "$1" <<'PY'
import io, json, sys
path, op = sys.argv[1], sys.argv[2]
doc = json.loads(io.open(path, encoding="utf-8").read())
fx = doc["fixtures"]
before = json.dumps(doc, sort_keys=True)
exec(op, {"fx": fx, "doc": doc})
if json.dumps(doc, sort_keys=True) == before:
    sys.stderr.write("STALE: the mutation changed nothing\n")
    sys.exit(9)
io.open(path, "w", encoding="utf-8").write(json.dumps(doc, indent=1) + "\n")
PY
}

# expect_red <name> <expected-substring>
expect_red() {
  local name="$1" expect="$2" out rc
  out="$(run_parity)"; rc=$?
  restore
  if [ "$rc" = 0 ]; then bad "$name did NOT red the gate"; return; fi
  case "$out" in
    *"$expect"*) ok "$name reds the gate on '$expect'" ;;
    *) bad "$name red, but not on '$expect'"; printf '%s\n' "$out" | grep -E "FAIL" | head -3 ;;
  esac
}

echo "== baseline =="
out="$(run_parity)"; rc=$?
if [ "$rc" = 0 ] && printf '%s\n' "$out" | grep -q 'exam_placement comparisons'; then
  ok "baseline green, and the placement comparison ran"
  printf '%s\n' "$out" | grep -oE 'OK: .*' | tail -1 | sed 's/^/        /'
else
  bad "baseline not green, or the placement comparison did not run (rc=$rc)"
  printf '%s\n' "$out" | grep -E "FAIL" | head -3
fi

echo "== plants =="

# P1 — the suppression list. This is the fixture that was named for the rule and could
# not test it: all its plan could witness was the ABSENCE of a block on that date.
if fixture_edit 'fx["exam_both_occurrences_overridden_suppressed"]["exam_placement"]["suppressed"] = []'; then
  expect_red P1 "exam_placement: the reference no longer reproduces the stored block"
else
  bad "P1 STALE (the fixture or its exam_placement block has moved)"; restore
fi

# P2 — the placed map, on a fixture whose exam day is not a study day, so the plan alone
# would still look plausible.
if fixture_edit 'fx["exam_day_outside_study_days"]["exam_placement"]["placed"] = {"2026-10-10": "exam_cadence"}'; then
  expect_red P2 "exam_placement: the reference no longer reproduces the stored block"
else
  bad "P2 STALE (the fixture or its exam_placement block has moved)"; restore
fi

# P3 — THE ONE THE FIXTURES WERE BLIND TO. The database stops recording suppressions and
# drops them silently, which is the production defect Z-58 was written for. Before this
# change parity could not see it: no plan carries a suppression.
P3SQL="$(mktemp /tmp/calfn-mut-p3.XXXX.sql)"
python3 - "$FNBAK" > "$P3SQL" <<'PY'
import io, sys
src = io.open(sys.argv[1], encoding="utf-8").read()
old, new = "v_supp := v_supp || v_d;", "NULL;"
n = src.count(old)
if n != 1:
    sys.stderr.write("STALE: %r found %d times in the live definition\n" % (old, n))
    sys.exit(9)
sys.stdout.write(src.replace(old, new))
PY
p3rc=$?
if [ "$p3rc" = 0 ] && [ -s "$P3SQL" ]; then
  if psql -v ON_ERROR_STOP=1 -qtAX -d "${PGDATABASE:-postgres}" -f "$P3SQL" >/dev/null 2>&1; then
    expect_red P3 "calendar_place_full_lengths differs from the oracle"
  else
    bad "P3 could not install the mutated function"; restore
  fi
else
  bad "P3 STALE (the suppression statement is not in the live definition exactly once)"
fi
rm -f "$P3SQL"

# The corpus is locked. Prove it came back, rather than trusting the trap.
if ! (cd "$ROOT" && git diff --quiet -- docs/Spec/calendar_formula_fixtures.json); then
  bad "docs/Spec/calendar_formula_fixtures.json was left MODIFIED — restoring the locked corpus failed"
  (cd "$ROOT" && git checkout -- docs/Spec/calendar_formula_fixtures.json)
else
  ok "docs/Spec/calendar_formula_fixtures.json is byte-identical to HEAD again"
fi

echo
echo "CALENDAR PARITY PLACEMENT MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
