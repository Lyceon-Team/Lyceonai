#!/usr/bin/env bash
# Home QOTD, streak, daily email and SAT test dates — mutation harness.
#
# @spec [owner brief "Question of the Day on Home, daily streak, email, SAT dates in onboarding"
#       (Karl, 2026-10-08/09) "Acceptance": "each test observed failing once"; SCL-223..226;
#       owner ruling on #1166 (Karl, 2026-10-09): the reminder is the `qotd_daily` notification,
#       tests for it "each observed failing once"] | @implemented [2026-10-09]
#
# Re-pointed 2026-10-09: H6, H7 (set_qotd_email_consent, qotd_email_prompt_state) to MIG_C, which
# now last defines them; H8 (was the qotd_email_sends claim, dropped) and H11 (was the job's
# sunset, now inside the rule) to the `qotd_daily_notify` rule in MIG_C.
#
# Each plant breaks ONE rule the brief locks and must turn a NAMED test red. Same three rules as
# the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function must edit the migration that LAST defines it
#            (need_last), or it edits a body the pipeline overwrites and proves nothing.
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG_A="supabase/migrations/20261029000000_test_dates_and_consent_guard.sql"
MIG_B="supabase/migrations/20261029010000_home_qotd_streak_email.sql"
MIG_C="supabase/migrations/20261029020000_qotd_daily_notification.sql"
NOTIF_SECTION="client/src/components/settings/NotificationsSection.tsx"
SEND_CTX="server/lib/notifications/qotd-daily-send-context.ts"
JOB="server/services/qotd/qotd-email-job.ts"
LINKS="server/services/qotd/qotd-email-links.ts"
PROFILE_SVC="server/services/calendar/profile-service.ts"
SECTION="client/src/components/home/qotd/HomeQotdSection.tsx"
PROMPT="client/src/components/home/qotd/QotdEmailPrompt.tsx"
DATES="shared/sat-test-dates.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/hq-mut.XXXX)"

FILES=("$MIG_A" "$MIG_B" "$MIG_C" "$NOTIF_SECTION" "$SEND_CTX" "$JOB" "$LINKS" "$PROFILE_SVC" "$SECTION" "$PROMPT" "$DATES")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
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

check() { pnpm exec vitest run "$@" 2>&1; }
PG_SUITE=tests/ci/home-qotd.pg.ci.test.ts
UI=client/src/components/home/qotd/HomeQotdSection.test.tsx
CONTRACT=tests/ci/sat-test-dates.contract.test.ts
SETTINGS=client/src/pages/settings.test.tsx

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "HOME QOTD MUTATIONS: no Postgres at $PGHOST:$PGPORT — the SQL plants need it (a skip is not a pass)"
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
OUT="$(check "$PG_SUITE" "$UI" "$CONTRACT" "$SETTINGS")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "HOME QOTD MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (1) the QOTD uses the free daily 40 ==="
need_last check_and_reserve_practice_quota H1 "$MIG_B"
plant "$MIG_B" "  AND ps.mode NOT IN ('diagnostic', 'qotd');" "  AND ps.mode NOT IN ('diagnostic');" || { bad "H1 STALE"; exit 1; }
run "H1 quota exclusion" "A3: the QOTD answer does not use the free daily 40" "$PG_SUITE"

echo "=== (2) a replay is treated as a second answer ==="
need_last qotd_student_answer H2 "$MIG_B"
plant "$MIG_B" "    IF v_existing.idempotency_key = p_idempotency_key THEN" "    IF false THEN" || { bad "H2 STALE"; exit 1; }
run "H2 replay" "A1: a replay returns the original" "$PG_SUITE"

echo "=== (3) the day is UTC's, not Chicago's ==="
need_last chicago_day H3 "$MIG_B"
plant "$MIG_B" "  SELECT (p_at AT TIME ZONE 'America/Chicago')::date;" "  SELECT (p_at AT TIME ZONE 'UTC')::date;" || { bad "H3 STALE"; exit 1; }
run "H3 Chicago day" "A1: the day is America/Chicago's" "$PG_SUITE"

echo "=== (4) a review answer does not extend the streak ==="
need_last student_answer_days H4 "$MIG_B"
plant "$MIG_B" "   WHERE r.student_id = p_student_id AND r.status = 'answered'" "   WHERE false" || { bad "H4 STALE"; exit 1; }
run "H4 streak sources" "A4: every source extends the streak" "$PG_SUITE"

echo "=== (5) mastery cannot read a qotd answer ==="
need_last practice_session_mode_to_event_kind H5 "$MIG_B"
plant "$MIG_B" "    WHEN 'qotd'       THEN RETURN 'practice_attempt';" "" || { bad "H5 STALE"; exit 1; }
run "H5 qotd is a practice attempt" "A3: a miss is a practice answer" "$PG_SUITE"

echo "=== (6) 'never' is offered from the first ask ==="
need_last set_qotd_email_consent H6 "$MIG_C"
plant "$MIG_C" "  IF p_decision = 'never' AND COALESCE((v_state->>'ask_count')::integer, 0) < 3 THEN" "  IF false THEN" || { bad "H6 STALE"; exit 1; }
run "H6 never from the 3rd ask" "the first ask has no 'Don't ask again'" "$PG_SUITE"

echo "=== (7) an under-13 can be prompted and can grant ==="
need_last qotd_email_prompt_state H7 "$MIG_C"
plant "$MIG_C" $'    \'eligible\', COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)\n                AND p.role = \'student\' AND p.deleted_at IS NULL,\n    \'consented\', COALESCE(c.enabled, false),' $'    \'eligible\', true,\n    \'consented\', COALESCE(c.enabled, false),' || { bad "H7 STALE"; exit 1; }
run "H7 under-13" "A5: never for an under-13" "$PG_SUITE"

echo "=== (8) the event id stops being one per student per day ==="
need_last qotd_daily_notify H8 "$MIG_C"
plant "$MIG_C" "    v_event := public.notification_event_id('qotd_daily', r.student_id::text || ':' || v_today::text);" "    v_event := public.notification_event_id('qotd_daily', r.student_id::text || ':' || p_now::text);" || { bad "H8 STALE"; exit 1; }
run "H8 one per student per day" "one per student per day across both evening crons" "$PG_SUITE"

echo "=== (9) the job sends at any hour ==="
plant "$JOB" "  if (summary.chicago_hour !== QOTD_EMAIL_SEND_HOUR_CHICAGO) {" "  if (false) {" || { bad "H9 STALE"; exit 1; }
run "H9 17:00 only" "outside the 17:00 Chicago hour nothing is created or sent" "$PG_SUITE"

echo "=== (10) the hour is read in UTC (DST lost) ==="
plant "$JOB" "    timeZone: QOTD_TIME_ZONE," "    timeZone: \"UTC\"," || { bad "H10 STALE"; exit 1; }
run "H10 17:00 Chicago across DST" "at 17:00 CDT" "$PG_SUITE"

echo "=== (11) the sunset never fires ==="
need_last qotd_daily_notify H11 "$MIG_C"
plant "$MIG_C" "      IF COALESCE(v_run, 0) >= 7 THEN" "      IF false THEN" || { bad "H11 STALE"; exit 1; }
run "H11 7-send sunset" "the sunset sends the pause email" "$PG_SUITE"

echo "=== (12) a tampered unsubscribe link is accepted ==="
plant "$LINKS" "  return timingSafeEqual(given, expected) ? studentId : null;" "  return studentId;" || { bad "H12 STALE"; exit 1; }
run "H12 signed link" "a tampered link is refused" "$PG_SUITE"

echo "=== (13) saving SAT dates completes calendar setup ==="
plant "$PROFILE_SVC" "  const completesSetup = !datesOnly && existing?.setup_completed_at == null;" "  const completesSetup = existing?.setup_completed_at == null;" || { bad "H13 STALE"; exit 1; }
run "H13 dates-only save" "A8: several dates stored" "$PG_SUITE"

echo "=== (14) the effective date is the earliest date, past or not ==="
need_last study_profile_effective_exam_date H14 "$MIG_A"
plant "$MIG_A" "  SELECT min(d) FROM unnest(COALESCE(p_dates, '{}'::date[])) AS d WHERE d >= p_today;" "  SELECT min(d) FROM unnest(COALESCE(p_dates, '{}'::date[])) AS d;" || { bad "H14 STALE"; exit 1; }
run "H14 effective date" "A8: several dates stored" "$PG_SUITE"

echo "=== (15) a past SAT date is offered ==="
plant "$DATES" "  return SAT_TEST_DATES.filter((d) => d.date > today)" "  return SAT_TEST_DATES.filter((d) => d.date.length > 0)" || { bad "H15 STALE"; exit 1; }
run "H15 future dates only" "only dates after today are offered" "$CONTRACT"

echo "=== (16) the prompt opens even when the server says not to ==="
plant "$SECTION" "        if (response.show_email_prompt) setPromptOpen(true);" "        setPromptOpen(true);" || { bad "H16 STALE"; exit 1; }
run "H16 server decides the prompt" "no prompt when the server says not to" "$UI"

echo "=== (17) the answered card never collapses ==="
plant "$SECTION" "  if (result !== null && !justAnswered && !expanded) {" "  if (false) {" || { bad "H17 STALE"; exit 1; }
run "H17 collapse" "answered on an earlier visit: collapsed" "$UI"

echo "=== (18) Escape closes the prompt without recording 'Not now' ==="
plant "$PROMPT" "        if (!next && !pending) onDecide(\"not_now\");" "        if (false) onDecide(\"not_now\");" || { bad "H18 STALE"; exit 1; }
run "H18 Escape is Not now" "Escape closes the prompt" "$UI"

echo "=== (19) a student who never consented gets no in-app reminder ==="
need_last qotd_daily_notify N1 "$MIG_C"
plant "$MIG_C" "                         ELSE jsonb_build_array('in_app') END" "                         ELSE jsonb_build_array() END" || { bad "N1 STALE"; exit 1; }
run "N1 in-app without consent" "in-app for a student who never consented" "$PG_SUITE"

echo "=== (20) the email goes out without consent ==="
plant "$MIG_C" "           (COALESCE(c.enabled, false)" "           (true" || { bad "N2 STALE"; exit 1; }
run "N2 email only with consent" "email only with consent" "$PG_SUITE"

echo "=== (21) an under-13 with the preference on is emailed ==="
plant "$MIG_C" $'            AND public.marketing_opt_in_age_eligible(p.date_of_birth)\n' "" || { bad "N3 STALE"; exit 1; }
run "N3 never email under-13" "never email for an under-13" "$PG_SUITE"

echo "=== (22) the unsubscribe link stops writing the one preference ==="
need_last qotd_email_unsubscribe N4 "$MIG_C"
plant "$MIG_C" "  v_result := public.set_qotd_daily_email(p_student_id, false, 'email_unsubscribe', NULL, p_now);" "  v_result := jsonb_build_object('changed', false);" || { bad "N4 STALE"; exit 1; }
run "N4 one preference" "change the same preference" "$PG_SUITE"

echo "=== (23) a second writer of the preference ==="
need_last qotd_email_resume N5 "$MIG_C"
plant "$MIG_C" "  v_result := public.set_qotd_daily_email(p_student_id, true, 'email_resume', NULL, p_now);" $'  UPDATE public.notification_channel_preferences SET enabled = true WHERE profile_id = p_student_id;\n  v_result := jsonb_build_object(\'enabled\', true, \'changed\', true);' || { bad "N5 STALE"; exit 1; }
run "N5 one writer" "one writer" "$PG_SUITE"

echo "=== (24) the Settings switch can only turn the email on ==="
plant "$NOTIF_SECTION" "            onClick={() => save.mutate(!on)}" "            onClick={() => save.mutate(true)}" || { bad "N6 STALE"; exit 1; }
run "N6 Settings toggle" "turns it on with the consent version, then off" "$SETTINGS"

echo "=== (25) yesterday's daily email is sent late ==="
plant "$SEND_CTX" "  if (parsed.data.qotd_date !== qotdToday(now)) {" "  if (false) {" || { bad "N7 STALE"; exit 1; }
run "N7 never sent late" "never sent late" "$PG_SUITE"

echo
echo "HOME QOTD MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
