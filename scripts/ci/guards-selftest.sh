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

# --- E1: PROVEN COVERAGE (Codex F-001) — EVERY locked formula constant planted in a FORMULA
#         function body must turn no-hardcoded-constants RED (the allowlist fails closed). ---
echo "==> E1: no-hardcoded-constants must turn RED on EVERY locked formula constant (formula body)"
# The full set of locked formula-class constants (mastery_constants V1.0). 30/5 are the values
# Codex proved false-green before the allowlist rewrite; 1.0/2/4 collide with structural values
# and are caught by context-aware masking.
LOCKED_FORMULA_CONSTANTS="30 5 0.50 0.30 0.20 0.79 1.0 1.20 0.19 0.39 0.40 0.59 0.60 0.80 0.0 4 2 6"
plant_formula_body() {  # $1 = literal to plant inside a FORMULA-named function body
  cat > "$ROOT/$PLANT_SQL" <<SQL
-- TRANSIENT guard self-test artifact (never committed; trap-removed). LYCEON-MIGRATION-REVIEWED
CREATE OR REPLACE FUNCTION public.compute_mastery_for_entity(
  p_student_id uuid, p_entity_type text, p_section text, p_domain text, p_skill text
) RETURNS numeric LANGUAGE plpgsql AS \$\$
BEGIN
  RETURN $1;   -- planted hardcode: must be read from mastery_constants, not a literal
END;
\$\$;
SQL
}
for c in $LOCKED_FORMULA_CONSTANTS; do
  plant_formula_body "$c"
  if [ "$(run_guard scripts/ci/no-hardcoded-constants.mjs)" != "0" ]; then
    echo "    OK $c → RED"
  else
    echo "  FAIL: locked formula constant $c stayed GREEN (allowlist hole)"; fails=1
  fi
  rm -f "$ROOT/$PLANT_SQL"
done
# Counter-proof: a STRUCTURAL value (the percent scale 100.0) must stay GREEN — the allowlist
# permits the algebraic form, it is not a blanket reject.
plant_formula_body "100.0"
[ "$(run_guard scripts/ci/no-hardcoded-constants.mjs)" = "0" ] || { echo "  FAIL: structural 100.0 wrongly turned the guard red (over-block)"; fails=1; }
rm -f "$ROOT/$PLANT_SQL"
[ "$(run_guard scripts/ci/no-hardcoded-constants.mjs)" = "0" ] || { echo "  FAIL: guard still red after removing the plant (signal not the plant)"; fails=1; }
echo "    OK structural form stays green; signal is the plant"

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
