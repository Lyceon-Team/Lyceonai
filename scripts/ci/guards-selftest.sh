#!/usr/bin/env bash
# ============================================================================
# Guard self-test (Codex requirement: a guard is only proven if it FAILS on a
# planted violation, not merely passes on clean code) — B-WS3-1 contract §E.
# ============================================================================
# E1: no-hardcoded-constants turns RED when a constant literal is planted in a
#     PL/pgSQL formula body.
# E2: tutor-never-writes-mastery turns RED when a tutor/LISA path is planted with
#     a mastery write.
# For each: assert the guard exits NON-ZERO on the plant, then exits ZERO once the
# plant is removed (proving the guard's signal is the plant, not ambient state).
#
# The planted files are created at runtime and trap-removed; nothing is committed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PLANT_SQL="supabase/migrations/_planted_hardcode_violation.sql"
PLANT_TUTOR="server/routes/_planted_lisa_violation.ts"
fails=0

cleanup() { rm -f "$ROOT/$PLANT_SQL" "$ROOT/$PLANT_TUTOR"; }
trap cleanup EXIT

run_guard() { node "$1" >/dev/null 2>&1; echo $?; }  # echoes exit code

# --- baseline: both guards green on clean tree ---
echo "==> baseline (clean tree): both guards must PASS"
[ "$(run_guard scripts/ci/no-hardcoded-constants.mjs)" = "0" ] || { echo "  FAIL: no-hardcoded-constants red on clean tree"; fails=1; }
[ "$(run_guard scripts/ci/tutor-never-writes-mastery.mjs)" = "0" ] || { echo "  FAIL: tutor-never-writes-mastery red on clean tree"; fails=1; }
echo "    OK both green on clean tree"

# --- E1: plant a hardcoded constant in a PL/pgSQL function body ---
echo "==> E1: no-hardcoded-constants must turn RED on a planted formula-body literal"
cat > "$ROOT/$PLANT_SQL" <<'SQL'
-- TRANSIENT guard self-test artifact (never committed; trap-removed). LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public._planted_hardcode() RETURNS numeric
LANGUAGE plpgsql AS $$
BEGIN
  -- planted: source weight 0.50 hardcoded instead of read from mastery_constants
  RETURN 0.50;
END;
$$;
SQL
rc="$(run_guard scripts/ci/no-hardcoded-constants.mjs)"
if [ "$rc" != "0" ]; then echo "    OK guard turned RED (exit $rc) on the plant"; else echo "  FAIL: guard stayed GREEN with a hardcoded 0.50 in a function body"; fails=1; fi
rm -f "$ROOT/$PLANT_SQL"
[ "$(run_guard scripts/ci/no-hardcoded-constants.mjs)" = "0" ] || { echo "  FAIL: guard still red after removing the plant (signal not the plant)"; fails=1; }
echo "    OK green again once plant removed"

# --- E2: plant a tutor/LISA path that writes mastery ---
echo "==> E2: tutor-never-writes-mastery must turn RED on a planted tutor mastery write"
cat > "$ROOT/$PLANT_TUTOR" <<'TS'
// TRANSIENT guard self-test artifact (never committed; trap-removed).
export async function plantedLisaTurn(): Promise<void> {
  // planted: a tutor/LISA path invoking the mastery write boundary (C-7 violation)
  await supabase.rpc("apply_mastery_event", { p_student_id: "x" });
}
TS
rc="$(run_guard scripts/ci/tutor-never-writes-mastery.mjs)"
if [ "$rc" != "0" ]; then echo "    OK guard turned RED (exit $rc) on the plant"; else echo "  FAIL: guard stayed GREEN with a tutor-path mastery write"; fails=1; fi
rm -f "$ROOT/$PLANT_TUTOR"
[ "$(run_guard scripts/ci/tutor-never-writes-mastery.mjs)" = "0" ] || { echo "  FAIL: guard still red after removing the plant (signal not the plant)"; fails=1; }
echo "    OK green again once plant removed"

if [ "$fails" != "0" ]; then echo "GUARDS SELF-TEST: FAIL"; exit 1; fi
echo "GUARDS SELF-TEST: PASS (both guards proven by planted violations)"
