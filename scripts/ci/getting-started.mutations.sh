#!/usr/bin/env bash
# Getting started checklist, onboarding score, "Find your blind spots" — mutation harness.
#
# @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
#       brief v2, Karl, 2026-10-13) "Acceptance": "a test for each rule, planted defects for
#       each"; rulings 1–4 (2026-10-13)] | @implemented [2026-10-13]
#
# Each plant breaks ONE rule the brief locks and must turn a NAMED test red. Same three rules as
# the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function must edit the migration that LAST defines it
#            (need_last), or it edits a body the pipeline overwrites and proves nothing.
# After every plant the file is restored and `cmp`'d byte-identical to its snapshot.
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261102000000_home_getting_started.sql"
GRANTS="supabase/migrations/20261104000000_getting_started_service_role_grants.sql"
# Last definer of getting_started_observe since 2026-10-15 (QOTD no longer completes step 4).
FIX="supabase/migrations/20261105000000_getting_started_blind_spots_not_qotd.sql"
SCHEMA="packages/shared/src/getting-started-schema.ts"
ROUTE="server/routes/getting-started-routes.ts"
INDEX="server/index.ts"
CARD="client/src/components/home/GettingStartedCard.tsx"
FREE_HOME="client/src/components/home/FreeHome.tsx"
PRACTICE="client/src/pages/practice.tsx"
ONBOARD="client/src/pages/profile-complete.tsx"
PROFILE="client/src/components/settings/ProfileSection.tsx"
SECTION="client/src/components/home/qotd/HomeQotdSection.tsx"
COPY="client/src/lib/blind-spots-copy.ts"
PICKER="client/src/components/sat-dates/SatDatePicker.tsx"
FL_ROW="client/src/components/practice/FullLengthRow.tsx"
PROFILE_SVC="server/services/calendar/profile-service.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/gs-mut.XXXX)"

FILES=("$MIG" "$GRANTS" "$FIX" "$SCHEMA" "$ROUTE" "$INDEX" "$CARD" "$FREE_HOME" "$PRACTICE" "$ONBOARD" "$PROFILE" "$SECTION" "$COPY" "$PROFILE_SVC" "$PICKER" "$FL_ROW")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() {
  for f in "${FILES[@]}"; do
    cp "$BACKUPS/$f" "$f"
    cmp -s "$BACKUPS/$f" "$f" || { echo "  !! REVERT NOT BYTE-IDENTICAL: $f"; FAIL=$((FAIL+1)); }
  done
}
trap 'for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> [<old2> <new2> ...] — each old exactly once, or STALE.
plant() {
  python3 - "$@" <<'PY'
import io, sys
p = sys.argv[1]
pairs = sys.argv[2:]
s = io.open(p, encoding="utf-8").read()
for i in range(0, len(pairs), 2):
    old, new = pairs[i], pairs[i + 1]
    n = s.count(old)
    if n != 1:
        sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
        sys.exit(9)
    s = s.replace(old, new)
io.open(p, "w", encoding="utf-8").write(s)
PY
}

check() { pnpm exec vitest run "$@" 2>&1; }
PG_SUITE=tests/ci/getting-started.pg.ci.test.ts
QOTD_PG=tests/ci/home-qotd.pg.ci.test.ts
CONTRACT=tests/ci/getting-started.contract.test.ts
RENAME=tests/ci/blind-spots-rename.contract.test.ts
CARD_UI=client/src/components/home/GettingStartedCard.test.tsx
DASH=client/src/pages/lyceon-dashboard.test.tsx
PRACTICE_UI=client/src/pages/practice.test.tsx
ONBOARD_UI=client/src/pages/profile-complete.getting-started.test.tsx
SETTINGS=client/src/pages/settings.test.tsx
SECTION_UI=client/src/components/home/qotd/HomeQotdSection.test.tsx

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "GETTING STARTED MUTATIONS: no Postgres at $PGHOST:$PGPORT — the SQL plants need it (a skip is not a pass)"
  exit 1
fi

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }
need_last() {
  [ "$(last_definer "$1")" = "$3" ] || { bad "$2 targets $3 but $1 is last defined in $(last_definer "$1")"; exit 1; }
}

run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$PG_SUITE" "$QOTD_PG" "$CONTRACT" "$RENAME" "$CARD_UI" "$DASH" "$PRACTICE_UI" "$ONBOARD_UI" "$SETTINGS" "$SECTION_UI")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "GETTING STARTED MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

# G1 reversed 2026-10-15 (Karl): today's question must NOT complete step 4. It used to plant
# the exclusion; it now plants its removal. G1/G2/G4/G6/G7 re-pointed from $MIG to $FIX, which
# replaces getting_started_observe.
echo "=== (1) today's question completes step 4 again ==="
need_last getting_started_observe G1 "$FIX"
plant "$FIX" "       WHERE i.user_id = p_profile_id AND i.status = 'answered' AND ps.mode <> 'qotd');" \
  "       WHERE i.user_id = p_profile_id AND i.status = 'answered');" || { bad "G1 STALE"; exit 1; }
run "G1 QOTD does not count for step 4" "GS3: today's question counts for step 2 only" "$PG_SUITE"

echo "=== (2) 'Not sure yet' for the date stops counting for step 1 ==="
need_last getting_started_observe G2 "$FIX"
plant "$FIX" "           OR s.test_date_not_sure_at IS NOT NULL )" "           OR false )" || { bad "G2 STALE"; exit 1; }
run "G2 not-sure counts" "GS4: 'Not sure yet' counts for step 1" "$PG_SUITE"

echo "=== (3) a repeated 'Not sure yet' overwrites the first ==="
need_last getting_started_record_not_sure G3 "$MIG"
plant "$MIG" "     SET test_date_not_sure_at    = COALESCE(s.test_date_not_sure_at,    EXCLUDED.test_date_not_sure_at)," \
  "     SET test_date_not_sure_at    = EXCLUDED.test_date_not_sure_at," || { bad "G3 STALE"; exit 1; }
run "G3 not-sure idempotent" "GS4: 'Not sure yet' counts for step 1" "$PG_SUITE"

echo "=== (4) the email step is done without an opt-in ==="
need_last getting_started_observe G4 "$FIX"
plant "$FIX" "CASE WHEN COALESCE((v_pref ->> 'enabled')::boolean, false) THEN now() END" "CASE WHEN true THEN now() END" || { bad "G4 STALE"; exit 1; }
run "G4 email done only on opt-in" "GS5: step 3" "$PG_SUITE"

echo "=== (5) the email step shows to a student who cannot opt in ==="
plant "$SCHEMA" '  if (id === "email") return obs.email_eligible;' '  if (id === "email") return true;' || { bad "G5 STALE"; exit 1; }
run "G5 email hidden when ineligible" "the email step is hidden for a student who cannot opt in" "$CONTRACT"

echo "=== (6) a step is not sticky (a deleted LISA message reopens it) ==="
need_last getting_started_observe G6 "$FIX"
plant "$FIX" "         lisa_done_at        = COALESCE(s.lisa_done_at,        CASE WHEN v_lisa THEN now() END)," \
  "         lisa_done_at        = CASE WHEN v_lisa THEN now() END," || { bad "G6 STALE"; exit 1; }
run "G6 sticky" "GS6: sticky" "$PG_SUITE"

echo "=== (7) a tutor message or a suggestion counts for LISA ==="
need_last getting_started_observe G7 "$FIX"
plant "$FIX" "     WHERE m.student_id = p_profile_id AND m.role = 'student' AND m.content_kind = 'message');" \
  "     WHERE m.student_id = p_profile_id);" || { bad "G7 STALE"; exit 1; }
run "G7 student's own message only" "GS11: only a message the student sent counts for LISA" "$PG_SUITE"

echo "=== (8) a free account sees the Pro steps ==="
plant "$SCHEMA" '  if (audience.plan === "free" && PRO_ONLY_STEPS.includes(id)) return false;' '' || { bad "G8 STALE"; exit 1; }
run "G8 Pro steps free" "free accounts never see steps 6–8" "$CONTRACT"

echo "=== (9) LISA's step shows to a student the age lock keeps from LISA ==="
plant "$SCHEMA" '  if (id === "lisa") return audience.lisaAvailable;' '  if (id === "lisa") return true;' || { bad "G9 STALE"; exit 1; }
run "G9 LISA hidden under the age lock" "LISA for one who cannot use it" "$CONTRACT"

echo "=== (10) a skipped step holds completion ==="
plant "$SCHEMA" '    complete: steps.every((s) => s.status !== "open"),' '    complete: steps.every((s) => s.status === "done"),' || { bad "G10 STALE"; exit 1; }
run "G10 skip counts toward finishing" "is reached when every visible step is done or skipped" "$CONTRACT"

echo "=== (11) a step links somewhere that is not its page ==="
plant "$SCHEMA" '  review: "/review",' '  review: "/reviews",' || { bad "G11 STALE"; exit 1; }
run "G11 hrefs are real routes" "review → /reviews is a route in App.tsx" "$CONTRACT"

echo "=== (12) dismiss is accepted before the card is complete ==="
plant "$ROUTE" "      if (!before.value.complete) {" "      if (false) {" || { bad "G12 STALE"; exit 1; }
run "G12 dismiss refused until complete" "GS8: dismiss is refused until complete" "$PG_SUITE"

echo "=== (13) the route is mounted without the students-only guard ==="
plant "$INDEX" $'  requireStudentAccount,\n  gettingStartedRoutes,' '  gettingStartedRoutes,' || { bad "G13 STALE"; exit 1; }
run "G13 students only" "server/index.ts mounts it behind auth and requireStudentAccount" "$CONTRACT"

echo "=== (14) Home draws the checklist below today's question ==="
plant "$FREE_HOME" \
  $'      {checklist !== null ? (\n        <GettingStartedCard\n          data={checklist}\n          diagnosticTotal={practice.diagnosticTotalQuestions}\n        />\n      ) : null}\n' '' \
  $'      <HomeQotdSection onStreakExtended={() => setCelebrate(true)} />\n' \
  $'      <HomeQotdSection onStreakExtended={() => setCelebrate(true)} />\n      {checklist !== null ? (\n        <GettingStartedCard\n          data={checklist}\n          diagnosticTotal={practice.diagnosticTotalQuestions}\n        />\n      ) : null}\n' || { bad "G14 STALE"; exit 1; }
run "G14 checklist above today's question" "free, active: greeting → checklist → today's question" "$DASH"

echo "=== (15) the blind spots button stays filled while the checklist shows ==="
plant "$FREE_HOME" "        <DiagnosticCard practice={practice} primary={checklist === null} />" "        <DiagnosticCard practice={practice} primary />" || { bad "G15 STALE"; exit 1; }
run "G15 one primary" "free, active: greeting → checklist → today's question" "$DASH"

echo "=== (16) the dismissed checklist still shows ==="
plant "$FREE_HOME" "    gettingStarted.data !== undefined && !gettingStarted.data.dismissed" "    gettingStarted.data !== undefined" || { bad "G16 STALE"; exit 1; }
run "G16 dismissed stays gone" "after dismissal: no checklist" "$DASH"

# Re-pointed 2026-10-15 (owner ruling, Karl, on #1233, "Home: three equal entry points"): the
# ruling supersedes final brief v2 §4's removal of the full-length card, so G17 now plants the
# free Home losing its Practice / Review / Full-Length rows (its only Full-Length entry on a phone).
echo "=== (17) the free Home loses its three entry points ==="
plant "$FREE_HOME" $'      <HomeEntryPoints reviewWaiting={pool.pool?.total ?? null} />\n' "" || { bad "G17 STALE"; exit 1; }
run "G17 free entry points" "free: the same rows last in the column" "$DASH"

echo "=== (18) Practice's blind spots row shows after the diagnostic ==="
plant "$PRACTICE" '      {freeHomeStage(projection.estimateStatus) === "diagnostic" ? (' '      {true ? (' || { bad "G18 STALE"; exit 1; }
run "G18 row until the diagnostic" "after the diagnostic: no row" "$PRACTICE_UI"

# Re-pointed 2026-10-13 (Karl on #1230, item 4): "Not sure yet" is recorded only when chosen, so
# the plant now drops an EXPLICIT score choice (O5); G26 below plants the untouched case.
echo "=== (19) onboarding drops an explicit 'Not sure yet' for the score ==="
plant "$ONBOARD" '          const notSureScore = scoreChoice.kind === "not_sure";' "          const notSureScore = false;" || { bad "G19 STALE"; exit 1; }
run "G19 onboarding explicit not-sure" "O5: both explicitly 'Not sure yet'" "$ONBOARD_UI"

echo "=== (20) Settings hides the score from a student without a calendar ==="
plant "$PROFILE" \
  $'        <TargetScorePicker\n          legend="Target score"' $'        {false && <TargetScorePicker\n          legend="Target score"' \
  $'          data-testid="settings-target"\n        />' $'          data-testid="settings-target"\n        />}' || { bad "G20 STALE"; exit 1; }
run "G20 score for every student" "ruling 1 (2026-10-13): with no calendar profile the target score still shows" "$SETTINGS"

echo "=== (21) the SAT-date card's 'Not sure yet' records nothing ==="
plant "$SECTION" "    mutationFn: () => recordGettingStartedNotSure({ test_date: true })," "    mutationFn: async () => undefined," || { bad "G21 STALE"; exit 1; }
run "G21 SAT card not sure" "ruling 3: 'Not sure yet' records it for the checklist" "$SECTION_UI"

echo "=== (22) 'Not now' on the email step sends nothing ==="
plant "$CARD" "                        onClick={() => skip.mutate()}" "                        onClick={() => undefined}" || { bad "G22 STALE"; exit 1; }
run "G22 Not now skips" "C5: 'Not now' on the email step sends skip-email" "$CARD_UI"

echo "=== (23) ruling 4's line drifts ==="
plant "$COPY" '  "One question a day keeps the blind spots at bay.";' '  "One question a day keeps your streak going.";' || { bad "G23 STALE"; exit 1; }
run "G23 ruling 4 line" "C4: step 2 says ruling 4's line" "$CARD_UI"

echo "=== (24) the in-app name drifts back ==="
plant "$COPY" 'export const BLIND_SPOTS_NAME = "Find your blind spots";' 'export const BLIND_SPOTS_NAME = "Diagnostic";' || { bad "G24 STALE"; exit 1; }
run "G24 rename" "is 'Find your blind spots'" "$RENAME"

echo "=== (25) a score-only save is refused for want of a schedule ==="
plant "$PROFILE_SVC" '  "target_score",' '' || { bad "G25 STALE"; exit 1; }
run "G25 score is a goal field" "A8: several dates stored" "$QOTD_PG"

echo "=== (26) onboarding records 'Not sure yet' for an untouched date ==="
plant "$ONBOARD" "          const notSureDate = dateNotSureChosen && satDates.dates.length === 0;" "          const notSureDate = satDates.dates.length === 0;" || { bad "G26 STALE"; exit 1; }
run "G26 onboarding untouched records nothing" "O3: both untouched" "$ONBOARD_UI"

echo "=== (27) Settings records 'Not sure yet' for an untouched date on a name-only save ==="
plant "$PROFILE" "  const notSureDate = dateNotSureChosen && dates.dates.length === 0;" "  const notSureDate = dates.dates.length === 0;" || { bad "G27 STALE"; exit 1; }
run "G27 Settings untouched records nothing" "the name saves through PATCH /api/profile/name" "$SETTINGS"

echo "=== (28) the date picker never reports an explicit 'Not sure yet' ==="
plant "$PICKER" "              onNotSureChosen?.();" "" || { bad "G28 STALE"; exit 1; }
run "G28 explicit date choice reported" "#1230 item 4: an explicit 'Not sure yet' for both" "$SETTINGS"

echo "=== (29) the SAT-date card saves with nothing chosen ==="
plant "$SECTION" "              disabled={!answered || save.isPending || notSure.isPending}" "              disabled={save.isPending || notSure.isPending}" || { bad "G29 STALE"; exit 1; }
run "G29 SAT card needs an answer" "#1230 item 4: Save with nothing chosen is not an answer" "$SECTION_UI"

echo "=== (30) dismiss is not rate-limited ==="
plant "$ROUTE" $'    "/dismiss",\n    singleBucketRateLimit(ACTION_BUCKET, COMPONENT),\n' $'    "/dismiss",\n' || { bad "G30 STALE"; exit 1; }
run "G30 the POSTs share one bucket" "GS12: the three POSTs share the getting_started_action bucket" "$PG_SUITE"

echo "=== (31) a locked full-length row navigates instead of opening the modal ==="
plant "$FL_ROW" "        {reason === null ? (" "        {true ? (" || { bad "G31 STALE"; exit 1; }
run "G31 full-length lock" "free: the lock opens the full-length upgrade modal in place" "$PRACTICE_UI"

echo "=== (32) the full-length row is gone from Practice ==="
plant "$PRACTICE" $'      <FullLengthRow />\n' "" || { bad "G32 STALE"; exit 1; }
run "G32 full-length entry on Practice" "paid: a compact row whose Start is a link to the Full-Length page" "$PRACTICE_UI"

# Added 2026-10-15 (#1230 hotfix): production failed with 42501 because service_role could only
# SELECT the state table the SECURITY INVOKER functions write. GS13 runs them as service_role.
echo "=== (33) service_role loses INSERT/UPDATE on the state table ==="
plant "$GRANTS" $'GRANT INSERT, UPDATE ON TABLE public.student_getting_started_state TO service_role;\n' "" || { bad "G33 STALE"; exit 1; }
run "G33 service_role can write the state" "GS13: the four functions run as service_role" "$PG_SUITE"

# Added 2026-10-15 (Karl): QOTD must not complete "Find your blind spots".
echo "=== (34) a practice answer no longer completes step 4 ==="
need_last getting_started_observe G34 "$FIX"
plant "$FIX" "       WHERE i.user_id = p_profile_id AND i.status = 'answered' AND ps.mode <> 'qotd');" \
  "       WHERE i.user_id = p_profile_id AND i.status = 'answered' AND false);" || { bad "G34 STALE"; exit 1; }
run "G34 practice answer ticks step 4" "GS14: step 4 (as service_role)" "$PG_SUITE"

echo "=== (35) a completed diagnostic without a baseline yet does not complete step 4 ==="
need_last getting_started_observe G35 "$FIX"
plant "$FIX" "IN ('baseline_pending', 'baseline_ready')" "IN ('baseline_ready')" || { bad "G35 STALE"; exit 1; }
run "G35 completed diagnostic ticks step 4" "GS14: step 4 (as service_role)" "$PG_SUITE"

echo "=== (36) the data fix also clears students with a practice answer ==="
plant "$FIX" "      WHERE i.user_id = s.profile_id AND i.status = 'answered' AND ps.mode <> 'qotd');" \
  "      WHERE i.user_id = s.profile_id AND i.status = 'answered' AND false);" || { bad "G36 STALE"; exit 1; }
run "G36 data fix keeps non-QOTD completions" "GS15: clears step 4 only where every answered item is a QOTD item" "$PG_SUITE"

echo "=== (37) the data fix clears nothing ==="
plant "$FIX" "   AND EXISTS (" "   AND false AND EXISTS (" || { bad "G37 STALE"; exit 1; }
run "G37 data fix clears QOTD-only rows" "GS15: clears step 4 only where every answered item is a QOTD item" "$PG_SUITE"

echo
echo "GETTING STARTED MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
