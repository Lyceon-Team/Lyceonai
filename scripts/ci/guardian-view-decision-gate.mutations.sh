#!/usr/bin/env bash
# ============================================================================
# Mutation harness for scripts/ci/guardian-view-decision-gate.sh
# ============================================================================
# @spec [Guardian_Closure_Plan G1-08; audit G-AUD-11] | @implemented 2026-09-29
#
# Each mutation patches the migration that LAST defines guardian_view_decision,
# re-runs the gate, and requires the gate to go RED on a NAMED assertion.
#
# RULE 1 — APPLIED. A mutation whose target text is not found exactly once is
# STALE: a hard failure, never a pass. (CLAUDE.md: a mutation aimed at a
# migration a newer one supersedes applies cleanly and proves nothing, so the
# target file is RESOLVED as the last definer, not hard-coded.)
# RULE 2 — NAMED RED. The gate must fail AND its output must contain the
# declared substring.
# RULE 3 — GREEN BASELINE + RESTORE. Green before any mutation and green again
# after every restore.
#
# M1 removes `status = 'active'` from the gate (the row's named proof).
# M2 plants a one-id backdoor that no behavioural gate's fixtures exercise —
#    the class only the body pin (GATE 0) can see.
# M3 / M4 (SCL-198, guardian final purge) patch the migration that LAST revokes the KPI read
#    grants: M3 re-grants `authenticated` one column after that migration's own post-check has
#    run (the "regains SELECT" case: a later migration or a hand-run GRANT); M4 re-creates a
#    read policy on a skill table. Each must red GATE 14 by name.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GATE="$ROOT/scripts/ci/guardian-view-decision-gate.sh"
# Definers only: a later migration that merely REVOKEs/GRANTs on the function (G1-07 does)
# names it too, and must not be mistaken for its home.
MIG="$(grep -lnE 'CREATE (OR REPLACE )?FUNCTION public\.guardian_view_decision' "$ROOT"/supabase/migrations/*.sql | sort | tail -1)"
# The last migration that revokes the KPI read grants (M3/M4's target), resolved the same way.
GRANT_MIG="$(grep -lnE 'REVOKE SELECT ON TABLE public\.student_skill_kpi FROM authenticated' "$ROOT"/supabase/migrations/*.sql | sort | tail -1)"
BACKUP="$(mktemp /tmp/gvd-mut.XXXX.sql)"
GRANT_BACKUP="$(mktemp /tmp/gvd-mut-grant.XXXX.sql)"
PASS=0; FAIL=0

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "GUARDIAN GATE MUTATIONS: SKIPPED — no Postgres at $PGHOST:$PGPORT. A skip, not a pass."
  exit 0
fi

echo "target (last definer of guardian_view_decision): ${MIG#"$ROOT"/}"
echo "target (last revoker of the KPI read grants): ${GRANT_MIG#"$ROOT"/}"
cp "$MIG" "$BACKUP"
cp "$GRANT_MIG" "$GRANT_BACKUP"
restore() { cp "$BACKUP" "$MIG"; cp "$GRANT_BACKUP" "$GRANT_MIG"; }
trap 'restore; rm -f "$BACKUP" "$GRANT_BACKUP"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

run_gate() { bash "$GATE" 2>&1; }

# apply_mutation <file> <old> <new> — exactly one occurrence, or STALE.
apply_mutation() {
  python3 - "$1" "$2" "$3" <<'PY'
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

baseline() {
  local label="$1" out rc
  out="$(run_gate)"; rc=$?
  case "$out" in
    *"GUARDIAN-VIEW-DECISION GATE: PASS"*) [ "$rc" = 0 ] && ok "$label green" || bad "$label printed PASS but exited $rc" ;;
    *) bad "$label not green"; printf '%s\n' "$out" | tail -5 ;;
  esac
}

# mutate <name> <expected-substring> <file> <old> <new>
mutate() {
  local name="$1" expect="$2" out rc
  if ! apply_mutation "$3" "$4" "$5"; then bad "$name STALE (target not found exactly once)"; restore; return; fi
  out="$(run_gate)"; rc=$?
  restore
  if [ "$rc" = 0 ]; then bad "$name did NOT red the gate"; return; fi
  case "$out" in
    *"$expect"*) ok "$name reds the gate on '$expect'" ;;
    *) bad "$name red, but not on '$expect'"; printf '%s\n' "$out" | grep -E "FAIL|ERROR" | tail -3 ;;
  esac
  baseline "restore after $name"
}

echo "=== (0) GREEN BASELINE ==="
baseline "baseline"

echo "=== (1) M1: drop status = 'active' from the gate body ==="
# The body line is indented under WHERE; the commented copy in the header starts with "--".
mutate "M1" "GATE 0 FAIL" "$MIG" \
"        AND gl.student_profile_id  = p_student_id
        AND gl.status              = 'active'
    ) THEN 'not_linked'" \
"        AND gl.student_profile_id  = p_student_id
    ) THEN 'not_linked'"

echo "=== (2) M2: a one-id backdoor no fixture exercises ==="
mutate "M2" "GATE 0 FAIL" "$MIG" \
"    WHEN NOT public.entitlement_active(p_student_id) THEN 'student_unentitled'
    ELSE 'allow'" \
"    WHEN NOT public.entitlement_active(p_student_id)
         AND p_guardian_id <> '00000000-0000-0000-0000-0000000dead0'::uuid THEN 'student_unentitled'
    ELSE 'allow'"

echo "=== (3) M3: authenticated regains SELECT on one column of a KPI table ==="
mutate "M3" "GATE 14 FAIL: authenticated or anon can SELECT public.student_skill_kpi" "$GRANT_MIG" \
"END \$\$;

COMMIT;" \
"END \$\$;

COMMIT;
GRANT SELECT (student_id) ON public.student_skill_kpi TO authenticated;"

echo "=== (4) M4: a read policy reappears on a skill table ==="
mutate "M4" "GATE 14 FAIL: 1 policies on student_skill_kpi / student_skill_mastery" "$GRANT_MIG" \
"END \$\$;

COMMIT;" \
"END \$\$;

COMMIT;
CREATE POLICY planted_read ON public.student_skill_mastery FOR SELECT TO authenticated USING (true);"

echo "=== SUMMARY: $PASS passed, $FAIL failed ==="
[ "$FAIL" = 0 ] && echo "GUARDIAN GATE MUTATIONS: PASS" || { echo "GUARDIAN GATE MUTATIONS: FAIL"; exit 1; }
