#!/usr/bin/env bash
# Diagnostic projection + free/paid projection split — mutation harness.
#
# @spec [SCL-235; SCL-236; owner rulings 2026-10-16 (1-5) and 2026-10-17 (binding constraints 1-7)]
#       | @implemented [2026-10-17]
#
# Each plant breaks ONE rule the rulings lock and must turn a NAMED check red:
#   (A) SQL plants on the migration that LAST defines the function (need_last), each reddening a
#       named id of scripts/ci/diagnostic-projection-gates.sh (a throwaway Postgres, every
#       migration applied).
#   (B) server plants on the read split, each reddening a named vitest case.
#   (C) guard plants: the single-completion-path check must go red on a second writer.
# Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other check is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function must edit the migration that LAST defines it,
#            or it edits a body the pipeline overwrites and proves nothing (CLAUDE.md).
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261106010000_diagnostic_projection.sql"
ROUTES="server/routes/student-resources.ts"
READ="apps/api/src/services/projection-read.ts"
PROGRESS="server/routes/legacy/progress.ts"
PANEL="client/src/components/home/HomePanel.tsx"
CANON="server/routes/practice-canonical.ts"
DIAG_ROUTES="server/routes/diagnostic-routes.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/dp-mut.XXXX)"

FILES=("$MIG" "$ROUTES" "$READ" "$PROGRESS" "$PANEL" "$CANON" "$DIAG_ROUTES")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
# A plant that ADDS a migration file is removed by name, never by glob.
PLANTED_MIG="supabase/migrations/29991231000000_dp_mutation_plant.sql"
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; rm -f "$PLANTED_MIG"; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

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

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }
need_last() {
  [ "$(last_definer "$1")" = "$3" ] || { bad "$2 targets $3 but $1 is last defined in $(last_definer "$1")"; exit 1; }
}

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

gates() { bash scripts/ci/diagnostic-projection-gates.sh 2>&1; }
vt() { pnpm exec vitest run "$@" 2>&1; }
guard() { node scripts/ci/diagnostic-completion-single-path.mjs 2>&1; }

run_gates() { local out rc; out="$(gates)"; rc=$?; expect_red "$1" "$2" "$out" "$rc"; restore; }
run_vt()    { local name="$1" sub="$2"; shift 2; local out rc; out="$(vt "$@")"; rc=$?; expect_red "$name" "$sub" "$out" "$rc"; restore; }
run_guard() { local out rc; out="$(guard)"; rc=$?; expect_red "$1" "$2" "$out" "$rc"; restore; }

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "DIAGNOSTIC PROJECTION MUTATIONS: no Postgres at $PGHOST:$PGPORT — the SQL plants need it (a skip is not a pass)"
  exit 1
fi

CONTRACT=tests/ci/student-resources.contract.test.ts
GATING=tests/ci/kpi.gating.contract.test.ts
DASHBOARD_TEST=client/src/pages/lyceon-dashboard.test.tsx
HANDLER=tests/ci/diagnostic.handler-pg.ci.test.ts

echo "=== (0) GREEN BASELINE ==="
OUT="$(gates)"; RC=$?
[ "$RC" = 0 ] && ok "gates green" || { bad "gates not green"; echo "$OUT" | tail -30; }
OUT="$(vt "$CONTRACT" "$GATING" "$DASHBOARD_TEST" "$HANDLER")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
OUT="$(guard)"; RC=$?
[ "$RC" = 0 ] && ok "single-path guard green" || { bad "single-path guard not green"; echo "$OUT"; }
if [ "$FAIL" -gt 0 ]; then echo "DIAGNOSTIC PROJECTION MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (A) SQL — constraint 2: only the diagnostic session's answers ==="
need_last compute_diagnostic_projection S1 "$MIG"
plant "$MIG" "        JOIN   public.practice_session_items pi ON pi.id = ce.event_id
        WHERE  pi.session_id = p_session_id
          AND  pi.status     = 'answered'
      )," "      )," || { bad "S1 STALE"; exit 1; }
run_gates "S1 every canonical event, not just the session's" "DPG FAIL [D3]"

echo "=== (A) SQL — replays and races cannot duplicate or change the stored rows ==="
need_last complete_diagnostic_session S2 "$MIG"
plant "$MIG" "    SELECT * FROM public.compute_diagnostic_projection(p_session_id)
    ON CONFLICT (practice_session_id, section) DO NOTHING;" "    SELECT * FROM public.compute_diagnostic_projection(p_session_id);" || { bad "S2 STALE"; exit 1; }
run_gates "S2 no ON CONFLICT on completion" "DPG FAIL [D13]"

echo "=== (A) SQL — write-once ==="
plant "$MIG" "CREATE TRIGGER student_diagnostic_projections_no_update
  BEFORE UPDATE ON public.student_diagnostic_projections
  FOR EACH ROW EXECUTE FUNCTION public.student_diagnostic_projections_immutable();" "" || { bad "S3 STALE"; exit 1; }
run_gates "S3 immutability trigger removed" "DPG FAIL [D5]"

echo "=== (A) SQL — at most one diagnostic in flight (constraint 7) ==="
plant "$MIG" "CREATE UNIQUE INDEX practice_sessions_one_inflight_diagnostic_uq
  ON public.practice_sessions (user_id)
  WHERE (mode = 'diagnostic' AND status IN ('created', 'active'));" "" || { bad "S4 STALE"; exit 1; }
run_gates "S4 in-flight index removed" "DPG FAIL [D9]"

echo "=== (A) SQL — an abandoned diagnostic is never completed ==="
need_last complete_diagnostic_session S5 "$MIG"
plant "$MIG" "  IF v_status = 'abandoned' THEN" "  IF false THEN" || { bad "S5 STALE"; exit 1; }
run_gates "S5 abandoned completes" "DPG FAIL [D7]"

echo "=== (A) SQL — D2: completion refreshes the live projection ==="
need_last complete_diagnostic_session S6 "$MIG"
plant "$MIG" "      PERFORM public.compute_section_projection(v_student, 'M',  p_now);
      PERFORM public.compute_section_projection(v_student, 'RW', p_now);" "      NULL;" || { bad "S6 STALE"; exit 1; }
run_gates "S6 no live refresh at completion" "DPG FAIL [D2]"

echo "=== (A) SQL — the repair sweep fills a gap ==="
need_last diagnostic_projection_repair S7 "$MIG"
plant "$MIG" "      AND  NOT EXISTS (SELECT 1 FROM public.student_diagnostic_projections sdp" "      AND  false AND NOT EXISTS (SELECT 1 FROM public.student_diagnostic_projections sdp" || { bad "S7 STALE"; exit 1; }
run_gates "S7 repair examines nothing" "DPG FAIL [D8]"

echo "=== (A) SQL — service_role only ==="
plant "$MIG" "GRANT EXECUTE ON FUNCTION public.complete_diagnostic_session(uuid, timestamptz, jsonb) TO service_role;" "GRANT EXECUTE ON FUNCTION public.complete_diagnostic_session(uuid, timestamptz, jsonb) TO service_role, authenticated;" || { bad "S8 STALE"; exit 1; }
run_gates "S8 authenticated may complete" "DPG FAIL [D10]"

echo "=== (A) SQL — account deletion removes the stored rows (L1-14) ==="
need_last execute_account_deletion_cascade S9 "$MIG"
plant "$MIG" "  DELETE FROM public.student_diagnostic_projections WHERE student_id = p_profile_id;" "" || { bad "S9 STALE"; exit 1; }
run_gates "S9 anonymize keeps the rows" "DPG FAIL [D12]"

echo "=== (B) server — free sees only the diagnostic projection (SCL-235) ==="
plant "$ROUTES" "  if (await subjectCanAccess(LIVE_PROJECTION_FEATURE_KEY, subject.studentId)) {" "  if (true) {" || { bad "R1 STALE"; exit 1; }
run_vt "R1 sections serves live to everyone" "FREE: /projections/sections serves the stored diagnostic projection and only that" "$CONTRACT"

plant "$ROUTES" "  [STUDENT_RESOURCE_PATHS.projectionsSnapshots]: LIVE_PROJECTION_FEATURE_KEY," "  [STUDENT_RESOURCE_PATHS.projectionsSnapshots]: null," || { bad "R2 STALE"; exit 1; }
run_vt "R2 snapshots open to free" "FREE: /projections/snapshots is denied" "$CONTRACT"

plant "$READ" '    .neq("snapshot_kind", RETIRED_SNAPSHOT_KIND)
' "" || { bad "R3 STALE"; exit 1; }
run_vt "R3 snapshots serve the retired baseline rows" "excludes the retired diagnostic_baseline kind" "$CONTRACT"

plant "$READ" "    .filter((row) => row.practice_session_id === sessionId)
" "" || { bad "R4 STALE"; exit 1; }
run_vt "R4 two sessions' rows mixed" "rows from two sessions are never mixed" "$CONTRACT"

plant "$PROGRESS" "    if (canSeeLiveProgression) {" "    if (true) {" || { bad "R5 STALE"; exit 1; }
run_vt "R5 progress serves live to free" "gates free-tier student to baseline_only" "$GATING"

plant "$PROGRESS" "        diagnostic: null,
        estimateStatus,
" "        diagnostic: await readDiagnosticProjection({ studentId: user.id }),
        estimateStatus,
" || { bad "R6 STALE"; exit 1; }
run_vt "R6 paid also gets the diagnostic number" "returns computed estimate payload when paid access is active" "$GATING"

echo "=== (B) client — the free panel says it is the diagnostic result ==="
plant "$PANEL" '        {diagnostic ? "Your diagnostic result" : "Projected score"}' '        {"Projected score"}' || { bad "U1 STALE"; exit 1; }
run_vt "U1 free panel unlabelled" "free, after the diagnostic: 'Your diagnostic result'" "$DASHBOARD_TEST"

echo "=== (B) server — every diagnostic completion goes through the SQL path ==="
plant "$CANON" '  if (args.mode === "diagnostic") {
    const { data, error } = await supabaseServer.rpc(' '  if (false) {
    const { data, error } = await supabaseServer.rpc(' || { bad "R7 STALE"; exit 1; }
run_vt "R7 diagnostic completion bypasses complete_diagnostic_session" "40th answer: stores exactly two computed diagnostic projection rows" "$HANDLER"

echo "=== (C) guard — one completion path (constraint 3) ==="
plant "$CANON" '    .neq("mode", "diagnostic")' '    .neq("mode", "nothing")' || { bad "G1 STALE"; exit 1; }
run_guard "G1 completeSession's own update loses its diagnostic exclusion" "lost its .neq"

python3 - "$DIAG_ROUTES" <<'PY'
import io, sys
p = sys.argv[1]
s = io.open(p, encoding="utf-8").read()
s += '\nexport const dpMutationPlant = () =>\n  supabaseServer\n    .from("practice_sessions")\n    .update({ status: "completed" });\n'
io.open(p, "w", encoding="utf-8").write(s)
PY
run_guard "G2 a second TS writer of status completed" "outside completeSession"

cat > "$PLANTED_MIG" <<'SQL'
CREATE OR REPLACE FUNCTION public.dp_mutation_plant(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.practice_sessions SET status = 'completed' WHERE id = p;
END;
$$;
SQL
run_guard "G3 a second SQL writer of status completed" "dp_mutation_plant"

echo
echo "DIAGNOSTIC PROJECTION MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
