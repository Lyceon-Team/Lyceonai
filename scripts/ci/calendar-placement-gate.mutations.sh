#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the exam-placement gates in
# scripts/ci/calendar-writer-gates.sql  (Z-56 .. Z-59, Z-70)
# ============================================================================
# @spec [Doc 05F formula sheet §2 Step 2; migration 20261013000000] | @implemented [2026-09-29]
#
# plain English: it breaks `calendar_place_full_lengths` on purpose, one arm at a
# time, and requires the writer gates to go RED on a NAMED assertion. Expected
# outcome: a gate that has stopped biting is a failure here, not a silent pass.
#
# WHY THIS FILE EXISTS. Brief 18's census measured what holds each branch of the
# placement rule (docs/plans/Calendar_Rule_Branch_Coverage_Census.md). Of the rule's
# three answers for an overridden cadence date, two were held — Z-57 the clean +7
# shift, Z-58 the both-blocked suppression — and the third, "a +7 that lands past the
# horizon end is NOT a suppression", was held by nothing at all: not a fixture, not
# the 3000-case seeded suite, not a gate. It could not be held by parity, either:
# the oracle's `generate()` drops `exam_dates`' second return value, so no plan the
# parity gate compares can witness a suppression. Z-70 is that gate, and this is
# what proves Z-70 bites.
#
# RULE 1 — THE TARGET IS RESOLVED, NEVER WRITTEN. A mutation aimed at a migration
# that a newer one supersedes applies cleanly, the suite passes, and the proof is
# gone (CLAUDE.md). So the file to patch is computed as the LAST migration that
# DEFINES the function — today 20261013000000_first_sitting_rule.sql, and whatever
# supersedes it tomorrow without this script being touched.
# RULE 2 — NAMED RED. A red run is not enough: the output must carry the declared
# substring, or the mutation reddened something else and Z-70 is still unproven.
# RULE 3 — A TARGET FOUND ANY NUMBER OF TIMES BUT ONCE IS STALE, and stale is a
# hard failure. An anchor that no longer matches is a dead mutation.
# RULE 4 — GREEN BASELINE. Green before the first mutation, or the reds below mean
# nothing.
#
# Each case gets its OWN database, because the migration pipeline is applied once
# and is not idempotent (20261013000000 INSERTs a config row). ~12s per build.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/scripts/ci/calendar-writer-gates.sql"
# Definers only. A later migration that merely GRANTs on the function, or names it
# in a comment, is not its home.
MIG="$(grep -lE 'CREATE (OR REPLACE )?FUNCTION public\.calendar_place_full_lengths' "$ROOT"/supabase/migrations/*.sql | sort | tail -1)"
BACKUP="$(mktemp /tmp/calplace-mut.XXXX.sql)"
PASS=0; FAIL=0

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "CALENDAR PLACEMENT GATE MUTATIONS: SKIPPED — no Postgres at $PGHOST:$PGPORT. A skip, not a pass."
  exit 0
fi
if [ -z "$MIG" ]; then
  echo "CALENDAR PLACEMENT GATE MUTATIONS: FAIL — no migration defines calendar_place_full_lengths"
  exit 1
fi

echo "target (last definer of calendar_place_full_lengths): ${MIG#"$ROOT"/}"
cp "$MIG" "$BACKUP"
DB=""
restore() { cp "$BACKUP" "$MIG"; }
cleanup() {
  restore; rm -f "$BACKUP"
  [ -n "$DB" ] && psql -qtA -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
}
trap cleanup EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# Build a throwaway database from the CURRENT migration tree and run the gate file
# against it. Mirrors the calendar-parity job's own apply step, including the
# Supabase roles and auth schema a plain Postgres has neither of.
run_gate() {
  local n="$1"
  DB="calplace_mut_$n"
  psql -qtA -d postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1
  psql -v ON_ERROR_STOP=1 -qtA -d postgres -c "CREATE DATABASE $DB;" >/dev/null || return 90
  psql -v ON_ERROR_STOP=1 -d "$DB" -q >/dev/null 2>&1 <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
  local f
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql -v ON_ERROR_STOP=1 -d "$DB" -q -f "$f" >/dev/null 2>&1 || { echo "    (pipeline failed at $(basename "$f"))"; return 91; }
  done
  psql -v ON_ERROR_STOP=1 -d "$DB" -f "$GATE" 2>&1
}

# apply_mutation <old> <new> — exactly one occurrence, or STALE.
apply_mutation() {
  python3 - "$MIG" "$1" "$2" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times (expected exactly 1)\n" % n)
    sys.exit(9)
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

# mutate <name> <expected-substring> <old> <new>
mutate() {
  local name="$1" expect="$2" out rc
  if ! apply_mutation "$3" "$4"; then bad "$name STALE (target not found exactly once)"; restore; return; fi
  out="$(run_gate "${name,,}")"; rc=$?
  restore
  if [ "$rc" -ge 90 ]; then bad "$name could not run the gate (rc=$rc)"; return; fi
  if [ "$rc" = 0 ]; then bad "$name did NOT red the gate"; printf '%s\n' "$out" | grep -E 'Z-70' | tail -2; return; fi
  case "$out" in
    *"$expect"*) ok "$name reds the gate on '$expect'" ;;
    *) bad "$name red, but not on '$expect'"; printf '%s\n' "$out" | grep -E "ERROR|FAILED" | tail -3 ;;
  esac
}

echo "== baseline =="
out="$(run_gate baseline)"; rc=$?
if [ "$rc" = 0 ] && printf '%s\n' "$out" | grep -q 'OK Z-70'; then
  ok "baseline green (Z-70 present and passing)"
  printf '%s\n' "$out" | grep -oE 'OK Z-70.*' | head -1 | sed 's/^/        /'
else
  bad "baseline not green, or Z-70 did not run (rc=$rc)"
  printf '%s\n' "$out" | grep -E "ERROR|FAILED" | tail -3
fi

echo "== mutations =="

# M1 — THE DEFECT Z-70 EXISTS FOR. The out-of-horizon arm records a suppression, so
# a student is told their practice test was cancelled when it was only scheduled for
# the next horizon. Reachable in 162,848 of 3,561,600 placement inputs swept, and
# invisible to every fixture and all 3000 suite cases before Z-70.
mutate M1 "was reported suppressed, but its +7 lands past the horizon end" \
'      IF v_nxt > h_end THEN
        -- NOT a suppression. That exam simply belongs to a later horizon and arrives
        -- as the window rolls forward; calling it a loss would cry wolf every fortnight.
        CONTINUE;
      END IF;' \
'      IF v_nxt > h_end THEN
        v_supp := v_supp || v_d;
        CONTINUE;
      END IF;'

# M2 — the arm deleted outright. Then the shifted date is USED, and a full-length is
# placed beyond the end of the window. This is why Z-70 asserts the window bound as
# well as the suppression list: with only the suppression assertion, M2 passed.
mutate M2 "a full-length was placed past the horizon end" \
'      IF v_nxt > h_end THEN
        -- NOT a suppression. That exam simply belongs to a later horizon and arrives
        -- as the window rolls forward; calling it a loss would cry wolf every fortnight.
        CONTINUE;
      END IF;
' \
''

echo
echo "CALENDAR PLACEMENT GATE MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
