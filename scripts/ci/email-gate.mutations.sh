#!/usr/bin/env bash
# The email send gate — mutation harness: one planted defect per rule.
#
# @spec [owner brief "Email send gate" (Karl, 2026-10-30) "Acceptance": "one planted defect per
#       rule"; owner rulings 2026-11-02 rounds 1 and 2; contracts/notifications.contract.md C15;
#       SCL-263] | @implemented [2026-11-02]
#
# Each plant breaks ONE rule and must turn a NAMED test red. The same three rules as the other
# *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function must edit the migration that LAST defines it
#            (need_last), or it edits a body the pipeline overwrites and proves nothing.
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261126000000_email_send_gate.sql"
DISPATCH="server/lib/notifications/dispatch.ts"
LIFECYCLE="server/lib/lifecycle-email.ts"
TRANSPORT="server/lib/notifications/transport.ts"
SEND_CTX="server/lib/notifications/email-gate-send-context.ts"
LINKS="server/services/qotd/qotd-email-links.ts"
WEBHOOK="server/routes/resend-webhook.ts"
SCORE_SVC="server/services/exam-score-renewal/service.ts"
SCORE_JOB="server/services/exam-score-renewal/job.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/eg-mut.XXXX)"

FILES=("$MIG" "$DISPATCH" "$LIFECYCLE" "$TRANSPORT" "$SEND_CTX" "$LINKS" "$WEBHOOK" "$SCORE_SVC" "$SCORE_JOB")
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
PG_SUITE=tests/ci/email-gate.pg.ci.test.ts
CONTRACT=tests/ci/email-gate.contract.test.ts
NOTIF=tests/ci/notifications.pg.ci.test.ts
SCORE=tests/ci/exam-score-renewal.contract.test.ts

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "EMAIL GATE MUTATIONS: no Postgres at $PGHOST:$PGPORT — the SQL plants need it (a skip is not a pass)"
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
OUT="$(check "$PG_SUITE" "$CONTRACT" "$NOTIF" "$SCORE")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "EMAIL GATE MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

# ── Categories ────────────────────────────────────────────────────────────────────────────
echo "=== G01 the SQL map drops a governed kind ==="
need_last email_category G01 "$MIG"
plant "$MIG" "                    'review_ask', 'lifecycle_reminder_due'," "                    'lifecycle_reminder_due'," || { bad "G01 STALE"; exit 1; }
run "G01 one category map" "C1: SQL email_category and the shared map agree" "$PG_SUITE"

echo "=== G02 an always kind is no longer always ==="
plant "$MIG" "    WHEN p_kind IN ('guardian_linked', 'guardian_unlinked', 'exam_score_report_requested'," "    WHEN p_kind IN ('guardian_unlinked', 'exam_score_report_requested'," || { bad "G02 STALE"; exit 1; }
run "G02 always is never blocked" "S6: paused refuses governed" "$PG_SUITE"

# ── States and thresholds ─────────────────────────────────────────────────────────────────
echo "=== G03 no cooling after 7 days ==="
need_last email_gate_compute G03 "$MIG"
plant "$MIG" "    ELSIF v_idle_days >= public.email_gate_config_int('email_gate_active_days') THEN" "    ELSIF false THEN" || { bad "G03 STALE"; exit 1; }
run "G03 cooling at 7 days" "S2: cooling after 7 days" "$PG_SUITE"

echo "=== G04 the cooling cap is gone ==="
need_last email_gate_verdict G04 "$MIG"
plant "$MIG" "      RETURN jsonb_build_object('allow', false, 'reason', 'cooling_cap');" "      RETURN jsonb_build_object('allow', true, 'reason', 'cooling_cap');" || { bad "G04 STALE"; exit 1; }
run "G04 cooling cap" "S2: cooling after 7 days" "$PG_SUITE"

echo "=== G05 the QOTD is no longer exempt from the cap ==="
plant "$MIG" "    IF p_kind = 'qotd_daily' THEN" "    IF false THEN" || { bad "G05 STALE"; exit 1; }
run "G05 QOTD exempt" "S2: cooling after 7 days" "$PG_SUITE"

echo "=== G06 paused without the 14-day floor ==="
plant "$MIG" "    IF v_idle_days >= public.email_gate_config_int('email_gate_pause_inactive_days')" "    IF v_idle_days >= 0" || { bad "G06 STALE"; exit 1; }
run "G06 14 days to pause" "S3: paused needs 14+ days" "$PG_SUITE"

echo "=== G07 paused without 3 unengaged emails ==="
plant "$MIG" $'       AND v_unengaged >= public.email_gate_config_int(\'email_gate_pause_unengaged_sends\') THEN\n      v_state := \'paused\'; v_reason := \'inactive_and_unengaged\';' $' THEN\n      v_state := \'paused\'; v_reason := \'inactive_and_unengaged\';' || { bad "G07 STALE"; exit 1; }
run "G07 3 unengaged to pause" "S3: paused needs 14+ days" "$PG_SUITE"

echo "=== G08 a click no longer resets the count ==="
need_last email_gate_unengaged_count G08 "$MIG"
plant "$MIG" $'             public.email_gate_last_click(p_profile_id, p_now),\n' "" || { bad "G08 STALE"; exit 1; }
run "G08 clicks reset" "S4: a click resets the unengaged count" "$PG_SUITE"

echo "=== G09 an open counts as a click ==="
need_last email_gate_last_click G09 "$MIG"
plant "$MIG" "     AND d.event_type = 'email.clicked'" "     AND d.event_type IN ('email.clicked', 'email.opened')" || { bad "G09 STALE"; exit 1; }
run "G09 clicks, never opens" "S4: a click resets the unengaged count" "$PG_SUITE"

echo "=== G10 no 72-hour window ==="
plant "$MIG" "     AND s.sent_at + make_interval(hours => public.email_gate_config_int('email_gate_engagement_window_hours')) <= p_now" "     AND s.sent_at <= p_now" || { bad "G10 STALE"; exit 1; }
run "G10 72-hour window" "S5: an email counts as unengaged only after its 72-hour window" "$PG_SUITE"

echo "=== G11 paused allows governed email ==="
plant "$MIG" $'  IF p_state = \'paused\' THEN\n    RETURN jsonb_build_object(\'allow\', false, \'reason\', \'paused\');\n  END IF;\n' "" || { bad "G11 STALE"; exit 1; }
run "G11 paused refuses" "S6: paused refuses governed" "$PG_SUITE"

echo "=== G12 milestones are blocked while paused ==="
plant "$MIG" $'  IF v_category = \'milestone\' THEN\n    RETURN jsonb_build_object(\'allow\', true, \'reason\', \'milestone\');\n  END IF;\n' "" || { bad "G12 STALE"; exit 1; }
run "G12 milestone while paused" "S6: paused refuses governed" "$PG_SUITE"

echo "=== G13 the pause note on every refresh ==="
need_last email_gate_refresh G13 "$MIG"
plant "$MIG" $'  IF v_row.state = v_state THEN\n    RETURN v_state;\n  END IF;\n  v_from' "  v_from" || { bad "G13 STALE"; exit 1; }
run "G13 sunset once" "S7: the pause note is emitted once per episode" "$PG_SUITE"

echo "=== G14 an under-13 gets the pause note ==="
plant "$MIG" "    IF v_profile.role = 'student' AND v_profile.deleted_at IS NULL AND v_profile.of_age" "    IF v_profile.role = 'student' AND v_profile.deleted_at IS NULL" || { bad "G14 STALE"; exit 1; }
run "G14 note 13+ only" "S7: the pause note is emitted once per episode" "$PG_SUITE"

echo "=== G15 activity does not wake ==="
plant "$MIG" "  IF v_row.state = 'paused' AND (v_wake IS NULL OR v_wake <= v_row.state_since) THEN" "  IF v_row.state = 'paused' THEN" || { bad "G15 STALE"; exit 1; }
run "G15 wake-up" "S8: wake-up" "$PG_SUITE"

echo "=== G16 paused is not sticky ==="
plant "$MIG" "  IF v_row.state = 'paused' AND (v_wake IS NULL OR v_wake <= v_row.state_since) THEN" "  IF false THEN" || { bad "G16 STALE"; exit 1; }
run "G16 sticky" "S9: paused stays paused without a wake" "$PG_SUITE"

echo "=== G17 transitions are not recorded ==="
plant "$MIG" $'  INSERT INTO public.email_gate_transitions (profile_id, from_state, to_state, reason, actor, occurred_at)\n  VALUES (p_profile_id, v_from, v_state, v_reason, p_actor, p_now);\n' "" || { bad "G17 STALE"; exit 1; }
run "G17 transitions" "S8: wake-up" "$PG_SUITE"

# ── Keep me posted ────────────────────────────────────────────────────────────────────────
echo "=== G18 a tampered Keep me posted link is accepted ==="
plant "$LINKS" "  return timingSafeEqual(given, expected) ? studentId : null;" "  return studentId;" || { bad "G18 STALE"; exit 1; }
run "G18 signed link" "K1: the signed Keep me posted link" "$PG_SUITE"

echo "=== G19 Keep me posted lifts nothing ==="
need_last email_gate_keep_posted G19 "$MIG"
plant "$MIG" $'  UPDATE public.email_gate_state SET resumed_at = p_now, updated_at = p_now\n   WHERE profile_id = p_profile_id;\n' "" || { bad "G19 STALE"; exit 1; }
run "G19 keep posted" "K1: the signed Keep me posted link" "$PG_SUITE"

# ── The Resend mirror ─────────────────────────────────────────────────────────────────────
echo "=== G20 an under-13 is mirrored to Resend ==="
need_last email_gate_enqueue_mirror G20 "$MIG"
plant "$MIG" "                         OR COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false))) THEN" "                         OR true)) THEN" || { bad "G20 STALE"; exit 1; }
run "G20 mirror never under-13" "M1: every change is queued for Resend" "$PG_SUITE"

echo "=== G21 a failed mirror retries at once (no backoff) ==="
need_last email_gate_outbox_mark G21 "$MIG"
plant "$MIG" "           next_attempt_at = p_now + make_interval(mins => LEAST(power(2, attempts + 1)::integer, 1440))," "           next_attempt_at = p_now," || { bad "G21 STALE"; exit 1; }
run "G21 mirror backoff" "M2: a failed mirror backs off" "$PG_SUITE"

# ── Plan-aware rules ──────────────────────────────────────────────────────────────────────
echo "=== G22 missed planned days never cool ==="
plant "$MIG" "    ELSIF v_run >= public.email_gate_config_int('email_gate_plan_cooling_missed_days') THEN" "    ELSIF false THEN" || { bad "G22 STALE"; exit 1; }
run "G22 plan cooling" "P1: on a plan, 2 missed planned days" "$PG_SUITE"

echo "=== G23 a day with off-plan activity counts as missed ==="
need_last email_gate_record_plan_days G23 "$MIG"
plant "$MIG" "    IF d.outcome = 'missed' AND NOT public.email_gate_active_on(p_student_id, d.day, p_timezone) THEN" "    IF d.outcome = 'missed' THEN" || { bad "G23 STALE"; exit 1; }
run "G23 missed means no activity" "P2: a missed planned day with activity" "$PG_SUITE"

echo "=== G24 a rerun counts days twice ==="
plant "$MIG" $'    CONTINUE WHEN v_row.plan_last_evaluated_date IS NOT NULL AND d.day <= v_row.plan_last_evaluated_date;\n' "" || { bad "G24 STALE"; exit 1; }
run "G24 rerun idempotent" "P3: days without a planned block never count" "$PG_SUITE"

echo "=== G25 plan pause without the 14-day floor ==="
plant "$MIG" $'       AND v_idle_days >= public.email_gate_config_int(\'email_gate_plan_pause_min_inactive_days\')\n' "" || { bad "G25 STALE"; exit 1; }
run "G25 plan pause floor" "P4: on a plan, paused needs 3 missed planned days" "$PG_SUITE"

echo "=== G26 off-plan activity no longer breaks the run ==="
plant "$MIG" $'    IF v_row.plan_last_missed_date IS NULL\n       OR (v_wake IS NOT NULL' $'    IF v_row.plan_last_missed_date IS NULL\n       OR (false' || { bad "G26 STALE"; exit 1; }
run "G26 activity breaks the run" "P4: on a plan, paused needs 3 missed planned days" "$PG_SUITE"

# ── Parents ───────────────────────────────────────────────────────────────────────────────
echo "=== G27 the parent pause after 3 days, not 7 ==="
need_last email_gate_guardian_refresh G27 "$MIG"
plant "$MIG" "           AND v_idle >= public.email_gate_config_int('email_gate_guardian_inactive_days'))" "           AND v_idle >= 3)" || { bad "G27 STALE"; exit 1; }
run "G27 parent at 7 days" "G1: after 7 days without student activity" "$PG_SUITE"

echo "=== G28 a new parent pause without new student activity ==="
plant "$MIG" "    IF v_episode IS NOT NULL AND (v_activity IS NULL OR v_activity <= (" "    IF false AND (v_activity IS NULL OR v_activity <= (" || { bad "G28 STALE"; exit 1; }
run "G28 once per episode" "G4: a guardian sign-in resumes it" "$PG_SUITE"

echo "=== G29 the digest reports a paused student ==="
need_last guardian_daily_digest_notify G29 "$MIG"
plant "$MIG" $'         AND NOT EXISTS (SELECT 1 FROM public.email_gate_guardian_pauses gp\n                          WHERE gp.guardian_id = v_guardian.id' $'         AND NOT EXISTS (SELECT 1 FROM public.email_gate_guardian_pauses gp\n                          WHERE false AND gp.guardian_id = v_guardian.id' || { bad "G29 STALE"; exit 1; }
run "G29 digest skips paused" "G2: the digest leaves a paused student out" "$PG_SUITE"

echo "=== G30 student activity does not resume the digest ==="
plant "$MIG" "     AND public.email_gate_activity_between(gp.student_id, gp.paused_at, p_now) IS NOT NULL;" "     AND false;" || { bad "G30 STALE"; exit 1; }
run "G30 resume on activity" "G3: student activity resumes the digest" "$PG_SUITE"

echo "=== G31 a guardian sign-in does not resume ==="
plant "$MIG" "     AND public.email_gate_last_sign_in(gp.guardian_id) > gp.paused_at" "     AND false AND public.email_gate_last_sign_in(gp.guardian_id) > gp.paused_at" || { bad "G31 STALE"; exit 1; }
run "G31 resume on login" "G4: a guardian sign-in resumes it" "$PG_SUITE"

# ── Engagement and campaigns ──────────────────────────────────────────────────────────────
echo "=== G32 a replayed engagement event is stored twice ==="
need_last record_email_engagement_event G32 "$MIG"
plant "$MIG" "  VALUES (p_provider_event_id, p_provider_message_id, p_event_type, p_occurred_at, v_message," "  VALUES (p_provider_event_id || gen_random_uuid()::text, p_provider_message_id, p_event_type, p_occurred_at, v_message," || { bad "G32 STALE"; exit 1; }
run "G32 engagement once" "E1: engagement events are stored once" "$PG_SUITE"

echo "=== G33 the webhook stops storing clicks ==="
plant "$WEBHOOK" "  if (isResendEngagementEvent(eventType)) {" "  if (false) {" || { bad "G33 STALE"; exit 1; }
run "G33 webhook engagement" "an open is recorded once" "$NOTIF"

echo "=== G34 a replayed campaign record counts twice ==="
need_last record_campaign_send G34 "$MIG"
plant "$MIG" "  VALUES (v_profile, p_campaign, p_variant, p_sent_at, p_resend_id)" "  VALUES (v_profile, p_campaign, p_variant, p_sent_at, p_resend_id || gen_random_uuid()::text)" || { bad "G34 STALE"; exit 1; }
run "G34 campaign idempotent" "R1: record_campaign_send counts" "$PG_SUITE"

echo "=== G35 campaign sends are not counted ==="
need_last email_gate_governed_sends G35 "$MIG"
plant "$MIG" "   WHERE c.profile_id = p_profile_id AND c.sent_at <= p_now;" "   WHERE false;" || { bad "G35 STALE"; exit 1; }
run "G35 campaigns count" "R1: record_campaign_send counts" "$PG_SUITE"

echo "=== G36 manual campaigns and milestones reach under-13s ==="
plant "$MIG" "  IF (p_kind = 'manual_campaign' OR v_category = 'milestone') AND NOT v_profile.adult_or_13 THEN" "  IF false THEN" || { bad "G36 STALE"; exit 1; }
run "G36 view flags 13+" "V1: email_gate_status flags" "$PG_SUITE"

echo "=== G37 authenticated can read the status view ==="
plant "$MIG" $'  TO service_role;\n\nREVOKE ALL ON FUNCTION' $'  TO service_role, authenticated;\n\nREVOKE ALL ON FUNCTION' || { bad "G37 STALE"; exit 1; }
run "G37 grants" "A1: grants: service_role only" "$PG_SUITE"

echo "=== G38 a campaign row survives account deletion ==="
plant "$MIG" $'  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,\n  campaign' $'  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE NO ACTION,\n  campaign' || { bad "G38 STALE"; exit 1; }
run "G38 deletion cascade" "X1: deleting a profile removes every gate row" "$PG_SUITE"

# ── Milestones ────────────────────────────────────────────────────────────────────────────
echo "=== G39 the week-before email twice ==="
need_last email_milestones_notify G39 "$MIG"
plant "$MIG" $'      IF NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id =\n           public.notification_event_id(\'sat_week_before\'' $'      IF true OR NOT EXISTS (SELECT 1 FROM public.notification_events e WHERE e.event_id =\n           public.notification_event_id(\'sat_week_before\'' || { bad "G39 STALE"; exit 1; }
run "G39 milestone once" "T1: a week before" "$PG_SUITE"

echo "=== G40 milestones to under-13s ==="
plant "$MIG" $'       AND COALESCE(public.marketing_opt_in_age_eligible(p.date_of_birth), false)\n       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests x' $'       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests x' || { bad "G40 STALE"; exit 1; }
run "G40 milestones 13+" "T1: a week before" "$PG_SUITE"

echo "=== G41 the week-before window opens a day early ==="
plant "$MIG" "    IF v_today BETWEEN r.test_date - v_before AND r.test_date - (v_before - 2) THEN" "    IF v_today BETWEEN r.test_date - (v_before + 1) AND r.test_date - (v_before - 2) THEN" || { bad "G41 STALE"; exit 1; }
run "G41 week-before window" "T1: a week before" "$PG_SUITE"

echo "=== G42 the day-after email drops the release date ==="
plant "$MIG" "                             'release_date', CASE WHEN v_release > v_today THEN v_release END)," "                             'release_date', NULL::date)," || { bad "G42 STALE"; exit 1; }
run "G42 release date line" "T2: the day after" "$PG_SUITE"

echo "=== G43 a release-day email without a published date ==="
plant "$MIG" "    v_release := NULLIF(p_release_dates ->> r.test_date::text, '')::date;" "    v_release := COALESCE(NULLIF(p_release_dates ->> r.test_date::text, '')::date, r.test_date + 13);" || { bad "G43 STALE"; exit 1; }
run "G43 published dates only" "T3: release day" "$PG_SUITE"

# ── The senders ───────────────────────────────────────────────────────────────────────────
echo "=== G44 the dispatcher ignores the gate ==="
plant "$DISPATCH" "  if (!gate.value.allow) {" "  if (false) {" || { bad "G44 STALE"; exit 1; }
run "G44 dispatcher asks" "D1: a governed email to a paused student is refused" "$PG_SUITE"

echo "=== G45 governed email from the untracked sender ==="
plant "$DISPATCH" "    sender: emailSenderTrackingOf(eventRow.event_type)," "    sender: \"untracked\"," || { bad "G45 STALE"; exit 1; }
run "G45 tracked sender (dispatcher)" "D1: a governed email to a paused student is refused" "$PG_SUITE"

echo "=== G46 the transport ignores the tracked address ==="
plant "$TRANSPORT" "    const from = input.sender === \"tracked\" && tracked ? tracked : untracked;" "    const from = untracked;" || { bad "G46 STALE"; exit 1; }
run "G46 tracked sender (transport)" "G3: the transport sends" "$CONTRACT"

echo "=== G47 a pause note goes after the pause ended ==="
plant "$SEND_CTX" "      if (!row || row.state !== \"paused\" || row.pause_episode !== p.episode) {" "      if (!row) {" || { bad "G47 STALE"; exit 1; }
run "G47 note withdrawn" "D2: the pause note goes untracked" "$PG_SUITE"

echo "=== G48 the lifecycle rule sends on a refusal ==="
plant "$LIFECYCLE" "      if (!gate.ok || !gate.value.allow) {" "      if (!gate.ok) {" || { bad "G48 STALE"; exit 1; }
run "G48 lifecycle asks" "L1: the lifecycle rule asks the gate" "$PG_SUITE"

# ── The score form and the day-18 email ──────────────────────────────────────────────────
echo "=== G49 the score form takes any date ==="
plant "$SCORE_SVC" "    !dates.some((d) => String(d).slice(0, 10) === date)" "    false" || { bad "G49 STALE"; exit 1; }
run "G49 own dates only" "W1: the score form takes one of the student's own past test dates" "$SCORE"

echo "=== G50 the score form takes old or future dates ==="
plant "$SCORE_SVC" $'    date >= today ||\n    date < addDaysToLocalDate(today, -SCORE_FORM_WINDOW_DAYS)' "    false" || { bad "G50 STALE"; exit 1; }
run "G50 45-day window" "W1: the score form takes one of the student's own past test dates" "$SCORE"

echo "=== G51 the day-18 email asks for a score already on file ==="
plant "$SCORE_JOB" "  if (candidate.anchor !== \"exam_date\" || scoreOnFile) {" "  if (candidate.anchor !== \"exam_date\") {" || { bad "G51 STALE"; exit 1; }
run "G51 renewal-only" "D18: a score already on file" "$SCORE"

echo
echo "EMAIL GATE MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
