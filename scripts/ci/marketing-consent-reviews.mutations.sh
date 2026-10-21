#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the marketing opt-in (plan Q5) and reviews / feedback (plan Q6)
# ============================================================================
# @spec [docs/plans/seo/seo-marketing-vertical.md rows Q5/Q6; the SEO Wave 2 brief's acceptance
#   item 3 ("A planted mutation turns each guard red"); owner brief "Review ask" (Karl,
#   2026-10-20) acceptance ("planted defects: one per rule")] | @implemented [2026-10-05;
#   review ask 2026-10-20]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants and the files are
#            restored after each one (and on exit).
#
# SQL plants edit the migration that DEFINES the object today, and the harness re-checks that it
# is still the LAST definer (CLAUDE.md, "a migration that replaces a function body orphans its
# mutations"). The PG suites rebuild their database from the migration files on every run, so a
# plant in the file is a plant in the database.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261027000000_marketing_consent_and_product_reviews.sql"
# set_marketing_consent was REPLACED by 20261028000000 (the marketing email lane added two
# withdrawal-only sources). Its plants (R4, R6) are re-pointed there; every other object is still
# last defined in $MIG. need_last checks this per plant.
MIG_SYNC="supabase/migrations/20261028000000_marketing_email_sync.sql"
# set_marketing_consent AND profiles_marketing_consent_guard were REPLACED again by
# 20261029000000 (F-83: a grant needs a user-action source and a version). R2, R4 and R6 are
# re-pointed there.
MIG_F83="supabase/migrations/20261029000000_test_dates_and_consent_guard.sql"
# The review ask (20261107000000) REPLACED product_review_prompt_state_for, _claim,
# product_review_submit, _mark_external and product_feedback_submit, and DROPPED
# product_review_prompt_dismiss. C8 and C9 are re-pointed here (C9 now guards
# product_review_prompt_respond, the dismissal's replacement); the RA plants are new.
MIG_RA="supabase/migrations/20261107000000_review_ask.sql"
# Private feedback's context (20261108000000) REPLACED product_feedback_submit (new signature,
# the old one dropped): RA15 is re-pointed here; the FB plants are new (final brief "Trustpilot
# card + Feedback", Karl 2026-10-20).
MIG_FB="supabase/migrations/20261108000000_feedback_context.sql"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/mcr-mut.XXXX)"

FILES=(
  "$MIG"
  "$MIG_SYNC"
  "$MIG_F83"
  "$MIG_RA"
  "$MIG_FB"
  "server/lib/feedback-slack.ts"
  "shared/slack/client.ts"
  "client/src/components/product-feedback/FeedbackDialog.tsx"
  "client/src/components/marketing/TrustpilotReviewCard.tsx"
  "client/src/components/layout/Footer.tsx"
  "client/src/components/layout/app-shell.tsx"
  "client/src/pages/home.tsx"
  "client/src/pages/contact.tsx"
  "client/src/lib/route-shells.ts"
  "server/lib/notifications/review-ask-send-context.ts"
  "server/lib/notifications/templates/review-ask.ts"
  "server/lib/notifications/dispatch.ts"
  "server/routes/public-review-ask-email-routes.ts"
  "client/src/components/home/HomeReviewAsk.tsx"
  "server/routes/profile-routes.ts"
  "server/lib/marketing-consent.ts"
  "server/services/product-feedback/product-feedback-service.ts"
  "server/routes/product-feedback-routes.ts"
  "packages/shared/src/product-feedback-schema.ts"
  "client/src/lib/product-feedback-api.ts"
  "client/src/components/product-feedback/ReviewPrompt.tsx"
  "client/src/pages/profile-complete.tsx"
  "client/src/pages/resume-practice.tsx"
  "server/lib/analytics/emit-event.ts"
  "client/src/lib/analytics/first-touch.ts"
)
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
PG_DB=tests/ci/marketing-consent-reviews.pg.ci.test.ts
PG_ROUTES=tests/ci/marketing-consent-routes.pg.ci.test.ts
CONTRACT=tests/ci/product-feedback.contract.test.ts
PROMPT_UI=client/src/components/product-feedback/ReviewPrompt.test.tsx
ONBOARD_UI=client/src/pages/profile-complete.marketing-opt-in.test.tsx
SIGNUP_PG=tests/ci/signup-analytics.pg.ci.test.ts
FIRST_TOUCH=client/src/lib/analytics/first-touch.test.ts
PG_RA=tests/ci/review-ask.pg.ci.test.ts
PG_FB=tests/ci/feedback-context.pg.ci.test.ts
FB_CONTRACT=tests/ci/feedback-context.contract.test.ts
FB_DIALOG=client/src/components/product-feedback/FeedbackDialog.test.tsx
HOME_UI=client/src/pages/home.trustpilot.test.tsx
SHELL_UI=client/src/components/layout/app-shell.rail.test.tsx

HAVE_PG=1
pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null || HAVE_PG=0

# expect_red <name> <expected substring> <output> <rc>
expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }
# need_last <function> <plant> [migration] — the plant's migration must be the LAST definer.
need_last() {
  local target="${3:-$MIG}"
  [ "$(last_definer "$1")" = "$target" ] || { bad "$2 targets $target but $1 is last defined in $(last_definer "$1")"; exit 1; }
}

# run <name> <substring> <check files...> — after a plant
run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(check "$PG_DB" "$PG_ROUTES" "$SIGNUP_PG" "$PG_RA" "$PG_FB")"; RC=$?
  [ "$RC" = 0 ] && ok "PG suites green" || { bad "PG suites not green"; echo "$OUT" | tail -30; }
else
  echo "  SKIP  PG plants — no Postgres at $PGHOST:$PGPORT (a skip, not a pass)"
fi
OUT="$(check "$CONTRACT" "$PROMPT_UI" "$ONBOARD_UI" "$FIRST_TOUCH" "$FB_CONTRACT" "$FB_DIALOG" "$HOME_UI" "$SHELL_UI")"; RC=$?
[ "$RC" = 0 ] && ok "contract + UI tests green" || { bad "contract + UI tests not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "MARKETING/REVIEWS MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== Q5 (1) the reset bug returns: an omitted marketingOptIn defaults to false ==="
  plant server/routes/profile-routes.ts \
    "  marketingOptIn: z.boolean().optional(),
});" \
    "  marketingOptIn: z.boolean().optional().default(false),
});" || { bad "R1 STALE"; exit 1; }
  run "R1 reset bug" "omits marketingOptIn leaves a stored TRUE alone" "$PG_ROUTES"

  echo "=== Q5 (2) the database guard lets an under-13 opt-in through ==="
  need_last profiles_marketing_consent_guard R2 "$MIG_F83"
  plant "$MIG_F83" \
    "  IF NEW.marketing_opt_in AND NOT public.marketing_opt_in_age_eligible(NEW.date_of_birth) THEN" \
    "  IF false THEN" || { bad "R2 STALE"; exit 1; }
  run "R2 trigger guard" "a direct write is refused for an under-13 date of birth" "$PG_DB"

  echo "=== Q5 (3) the age rule is 10, not 13 ==="
  need_last marketing_opt_in_age_eligible R3
  plant "$MIG" "(current_date - interval '13 years')" "(current_date - interval '10 years')" || { bad "R3 STALE"; exit 1; }
  run "R3 age threshold" "the day before the 13th birthday is refused" "$PG_DB"

  echo "=== Q5 (4) the logged setter grants to an under-13 account ==="
  need_last set_marketing_consent R4 "$MIG_F83"
  plant "$MIG_F83" \
    "  IF p_granted AND NOT public.marketing_opt_in_age_eligible(v_dob) THEN" \
    "  IF false THEN" || { bad "R4 STALE"; exit 1; }
  run "R4 setter age check" "set_marketing_consent answers age_ineligible" "$PG_DB"

  echo "=== Q5 (5) the onboarding PATCH stops refusing an under-13 grant up front ==="
  plant server/routes/profile-routes.ts \
    "      data.marketingOptIn === true &&
      !marketingOptInEligible(effectiveDateOfBirth, new Date())" \
    "      data.marketingOptIn === true &&
      false" || { bad "R5 STALE"; exit 1; }
  run "R5 PATCH age check" "an under-13 student cannot be set true" "$PG_ROUTES"

  echo "=== Q5 (6) the log loses where the choice was made ==="
  need_last set_marketing_consent R6 "$MIG_F83"
  plant "$MIG_F83" \
    "  PERFORM set_config('lyceon.marketing_consent_source', p_source, true);" \
    "  PERFORM set_config('lyceon.marketing_consent_source', 'system', true);" || { bad "R6 STALE"; exit 1; }
  run "R6 consent source" "records source signup" "$PG_ROUTES"

  echo "=== Q5 (7) consent_captured fires on a withdrawal too ==="
  plant server/lib/marketing-consent.ts \
    "  if (write === null || !write.ok || !write.changed || !write.granted) return;" \
    "  if (write === null || !write.ok || !write.changed) return;" || { bad "R7 STALE"; exit 1; }
  run "R7 grant-only emission" "turning it off always works" "$PG_ROUTES"

  echo "=== Q6 (8) the prompt claim is no longer compare-and-set ==="
  need_last product_review_prompt_claim C8 "$MIG_RA"
  plant "$MIG_RA" \
    "   WHERE product_review_prompt_state.last_shown_at IS NOT DISTINCT FROM p_expected" \
    "   WHERE TRUE" || { bad "C8 STALE"; exit 1; }
  run "C8 compare-and-set" "two tabs reading the same state ask once" "$PG_RA"

  echo "=== Q6 (9) a response counts every click ==="
  need_last product_review_prompt_respond C9 "$MIG_RA"
  plant "$MIG_RA" \
    "     AND last_response IS NULL;" \
    "     AND TRUE;" || { bad "C9 STALE"; exit 1; }
  run "C9 one response per ask" "a live snooze refuses the claim; one response per ask" "$PG_RA"

  echo "=== Q6 (10) account deletion stops removing feedback ==="
  plant "$MIG" \
    "  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  audience        text        NOT NULL CHECK (audience IN ('student', 'guardian')),
  body            text        NOT NULL" \
    "  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE NO ACTION,
  audience        text        NOT NULL CHECK (audience IN ('student', 'guardian')),
  body            text        NOT NULL" || { bad "C10 STALE"; exit 1; }
  run "C10 deletion cascade" "deleting the profile removes its rows" "$PG_DB"

  # ── Review ask (owner brief, Karl 2026-10-20): one plant per rule ──────────────────────────
  echo "=== RA (1) the database lets a third ask through ==="
  need_last product_review_prompt_claim RA1 "$MIG_RA"
  plant "$MIG_RA" \
    "     AND product_review_prompt_state.ask_count < 2" \
    "     AND product_review_prompt_state.ask_count < 3" || { bad "RA1 STALE"; exit 1; }
  run "RA1 2-ask cap (SQL)" "a third ask is refused" "$PG_RA"

  echo "=== RA (2) the database ignores a live snooze ==="
  plant "$MIG_RA" \
    "     AND (product_review_prompt_state.snoozed_until IS NULL
          OR product_review_prompt_state.snoozed_until <= now());" \
    ";" || { bad "RA2 STALE"; exit 1; }
  run "RA2 30-day snooze (SQL)" "a live snooze refuses the claim" "$PG_RA"

  echo "=== RA (3) the daily question counts toward the trigger ==="
  need_last review_ask_completed_sessions RA3 "$MIG_RA"
  plant "$MIG_RA" \
    "ps.status = 'completed' AND ps.mode <> 'qotd'" \
    "ps.status = 'completed'" || { bad "RA3 STALE"; exit 1; }
  run "RA3 QOTD excluded" "not before 7 days, not on daily questions" "$PG_RA"

  echo "=== RA (4) the trigger stops waiting 7 days ==="
  need_last review_ask_usage_met RA4 "$MIG_RA"
  plant "$MIG_RA" \
    "        p.created_at <= p_now - interval '7 days'" \
    "        true" || { bad "RA4 STALE"; exit 1; }
  run "RA4 7 days since signup" "not before 7 days" "$PG_RA"

  echo "=== RA (5) a guardian is asked over a student they may not see ==="
  plant "$MIG_RA" \
    "           AND public.guardian_view_decision(p.id, l.student_profile_id) = 'allow'" \
    "           AND true" || { bad "RA5 STALE"; exit 1; }
  run "RA5 guardian visibility" "a guardian: a link 7+ days old to a student they may see" "$PG_RA"

  echo "=== RA (6) the review email goes to a 17-year-old ==="
  need_last review_ask_email_notify RA6 "$MIG_RA"
  plant "$MIG_RA" "interval '18 years'" "interval '13 years'" || { bad "RA6 STALE"; exit 1; }
  run "RA6 email 18+" "none to a 17-year-old" "$PG_RA"

  echo "=== RA (7) the email follows an ask that was already answered ==="
  plant "$MIG_RA" \
    "       AND s.last_response IS NULL
       AND s.reviewed_at IS NULL" \
    "       AND s.reviewed_at IS NULL" || { bad "RA7 STALE"; exit 1; }
  run "RA7 email only when unanswered" "none after any response" "$PG_RA"

  echo "=== RA (8) a second email to the same person ==="
  plant "$MIG_RA" \
    "      public.notification_event_id('review_ask', v_row.id::text)," \
    "      gen_random_uuid()," || { bad "RA8 STALE"; exit 1; }
  run "RA8 one email, ever" "once per person, ever" "$PG_RA"

  echo "=== RA (9) the email chases an ask weeks later ==="
  plant "$MIG_RA" \
    "       AND s.last_shown_at >  p_now - interval '14 days'" \
    "       AND true" || { bad "RA9 STALE"; exit 1; }
  run "RA9 email window" "none before 3 days or after 14" "$PG_RA"

  echo "=== RA (10) a queued email still goes after the person answered in the app ==="
  plant server/lib/notifications/review-ask-send-context.ts \
    "      ask === null ||
      ask.last_response !== null ||
      ask.reviewed_at !== null" \
    "      ask === null" || { bad "RA10 STALE"; exit 1; }
  run "RA10 send-time re-check" "quiet hours: nothing goes out at 23:00 Chicago" "$PG_RA"

  echo "=== RA (11) the review email ignores quiet hours ==="
  # The dispatcher applies quiet hours itself (dispatch.ts), before the transport is called; the
  # transport's own check never runs under the suite's fake transport, so the plant goes here.
  plant server/lib/notifications/dispatch.ts \
    "  const notBefore = quietHoursDeferral(now);" \
    "  const notBefore: Date | null = now.getTime() < 0 ? quietHoursDeferral(now) : null;" || { bad "RA11 STALE"; exit 1; }
  run "RA11 quiet hours" "quiet hours: nothing goes out at 23:00 Chicago" "$PG_RA"

  echo "=== RA (12) 'Stop review requests' accepts another email's token ==="
  plant server/routes/public-review-ask-email-routes.ts \
    "    const profileId = verifyQotdEmailLinkToken(ACTION, req.query.t);" \
    "    const profileId = verifyQotdEmailLinkToken(\"guardian_digest_unsubscribe\", req.query.t);" || { bad "RA12 STALE"; exit 1; }
  run "RA12 signed stop link" "Stop review requests': the GET changes nothing" "$PG_RA"

  echo "=== RA (13) service_role can call the claim but not write the table it updates (#1248) ==="
  plant "$MIG_RA" \
    "GRANT SELECT, INSERT, UPDATE ON TABLE public.product_review_prompt_state TO service_role;" \
    "REVOKE UPDATE ON TABLE public.product_review_prompt_state FROM service_role;" || { bad "RA13 STALE"; exit 1; }
  run "RA13 table grants as service_role" "as service_role: the whole ask round-trips" "$PG_RA"

  echo "=== RA (14) service_role loses EXECUTE on the response ==="
  plant "$MIG_RA" \
    "GRANT EXECUTE ON FUNCTION
  public.product_review_prompt_state_for(uuid),
  public.product_review_prompt_claim(uuid, timestamptz),
  public.product_review_prompt_respond(uuid, text)," \
    "GRANT EXECUTE ON FUNCTION
  public.product_review_prompt_state_for(uuid),
  public.product_review_prompt_claim(uuid, timestamptz)," || { bad "RA14 STALE"; exit 1; }
  run "RA14 function grants as service_role" "anon and authenticated cannot execute any of them" "$PG_RA"

  echo "=== RA (15) feedback sent from the ask no longer ends the asks ==="
  need_last product_feedback_submit RA15 "$MIG_FB"
  plant "$MIG_FB" "  IF v_rows = 1 AND p_source = 'prompt' THEN" "  IF false THEN" || { bad "RA15 STALE"; exit 1; }
  run "RA15 prompt feedback ends asks" "feedback sent from the ask ends the asks" "$PG_RA"

  # ── Feedback context (final brief, Karl 2026-10-20): one plant per rule ──────────────────────
  echo "=== FB (1) the table stores a real id in the page ==="
  plant "$MIG_FB" \
    "        AND route_pattern ~ '^(/|(/([a-z][a-z-]*|:[a-zA-Z]+))+)\$'));" \
    "        AND route_pattern ~ '^/'));" || { bad "FB1 STALE"; exit 1; }
  run "FB1 route pattern CHECK" "the table refuses a real id, a query string" "$PG_FB"

  echo "=== FB (2) the database lets an under-13 ask for a reply ==="
  need_last product_feedback_submit FB2 "$MIG_FB"
  plant "$MIG_FB" \
    "  IF p_reply_ok AND NOT public.product_feedback_reply_allowed(p_profile_id) THEN" \
    "  IF false THEN" || { bad "FB2 STALE"; exit 1; }
  run "FB2 reply refused (SQL)" "reply-OK is refused for an under-13 or unknown-age student" "$PG_FB"

  echo "=== FB (3) service_role loses EXECUTE on the writer ==="
  plant "$MIG_FB" \
    "GRANT EXECUTE ON FUNCTION
  public.product_feedback_reply_allowed(uuid),
  public.product_feedback_submit(uuid, text, text, text, uuid, text, boolean, text, text)
  TO service_role;" \
    "GRANT EXECUTE ON FUNCTION
  public.product_feedback_reply_allowed(uuid)
  TO service_role;" || { bad "FB3 STALE"; exit 1; }
  run "FB3 grants as service_role" "service_role writes through both functions" "$PG_FB"

  echo "=== FB (4) the reply check forgets the age rule ==="
  need_last product_feedback_reply_allowed FB4 "$MIG_FB"
  plant "$MIG_FB" \
    "    SELECT p.role <> 'student' OR public.marketing_opt_in_age_eligible(p.date_of_birth)" \
    "    SELECT true" || { bad "FB4 STALE"; exit 1; }
  run "FB4 reply check age rule" "reply-OK is refused for an under-13 or unknown-age student" "$PG_FB"



  echo "=== RA (16) review content creeps into the cadence table ==="
  plant "$MIG_RA" \
    "  ADD COLUMN IF NOT EXISTS email_queued_at timestamptz NULL;" \
    "  ADD COLUMN IF NOT EXISTS email_queued_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS rating smallint NULL;" || { bad "RA16 STALE"; exit 1; }
  run "RA16 no review content stored" "the state table holds cadence facts only" "$PG_RA"

  echo "=== RA (17) the backfill forgets who was already asked ==="
  plant "$MIG_RA" \
    "   SET ask_count = LEAST(2, GREATEST(s.dismiss_count," \
    "   SET ask_count = LEAST(0, GREATEST(s.dismiss_count," || { bad "RA17 STALE"; exit 1; }
  run "RA17 backfill" "legacy rows keep their place" "$PG_RA"

  echo "=== RA (18) the email goes out under another sender name ==="
  plant server/lib/notifications/templates/review-ask.ts \
    '    fromCategory: "general",' \
    '    fromCategory: "qotd",' || { bad "RA18 STALE"; exit 1; }
  run "RA18 sent as Lyceon" "the email is the approved draft" "$PG_RA"

  # Owner report 2026-10-05: a production signup emitted nothing and logged nothing.
  echo "=== A (22) analytics misconfiguration is silent again ==="
  plant server/lib/analytics/emit-event.ts \
    "    return refuse(
      eventName,
      \"analytics_not_configured\",
      analyticsConfigProblems(deps.env),
    );" \
    "    return { ok: false, reason: \"analytics_not_configured\" };" || { bad "A22 STALE"; exit 1; }
  run "A22 loud misconfiguration" "NOT configured: nothing is sent" "$SIGNUP_PG"

  echo "=== A (23) a missed user_signed_up is not said at the call site ==="
  plant server/routes/profile-routes.ts \
    "      if (!signedUp.ok && signedUp.reason !== \"excluded_under_13_or_age_unknown\") {" \
    "      if (false) {" || { bad "A23 STALE"; exit 1; }
  run "A23 call-site signup miss" "NOT configured: nothing is sent" "$SIGNUP_PG"
fi

echo "=== A (24) first-touch attribution is memory-only again (lost on a full page load) ==="
plant client/src/lib/analytics/first-touch.ts \
  "    window.sessionStorage.setItem(FIRST_TOUCH_STORAGE_KEY, value);" \
  "    void value;" || { bad "A24 STALE"; exit 1; }
run "A24 first touch survives a reload" "analytics accepted: a paid landing is still paid_ad" "$FIRST_TOUCH"

echo "=== A (25) first-touch attribution is stored without consent ==="
plant client/src/lib/analytics/first-touch.ts \
  "  if (consent.status === \"accepted\" && firstTouch !== null) {" \
  "  if (firstTouch !== null) {" || { bad "A25 STALE"; exit 1; }
run "A25 consent gate" "undecided: nothing is stored" "$FIRST_TOUCH"

echo "=== Q6 (11) an ignored ask is asked again at once ==="
plant packages/shared/src/product-feedback-schema.ts \
  "      state.last_shown_at !== null &&" \
  "      false &&" || { bad "C11 STALE"; exit 1; }
run "C11 30 days after an ignored ask" "an ignored ask waits as long" "$CONTRACT"

echo "=== Q6 (12) a review no longer stops the asks ==="
plant packages/shared/src/product-feedback-schema.ts \
  "    state.reviewed_at !== null ||" \
  "" || { bad "C12 STALE"; exit 1; }
run "C12 stop after review" "never again once answered" "$CONTRACT"

echo "=== Q6 (13) a third ask ==="
plant packages/shared/src/product-feedback-schema.ts \
  "    if (state.ask_count >= REVIEW_ASK_MAX_ASKS) {" \
  "    if (state.ask_count > REVIEW_ASK_MAX_ASKS) {" || { bad "C13 STALE"; exit 1; }
run "C13 2-ask cap" "at most two asks, ever" "$CONTRACT"

echo "=== RA (19) 'Not now' does not snooze ==="
plant packages/shared/src/product-feedback-schema.ts \
  "      now.getTime() < state.snoozed_until.getTime()" \
  "      false" || { bad "RA19 STALE"; exit 1; }
run "RA19 30-day snooze" "'Not now' and the close button snooze 30 days" "$CONTRACT"

echo "=== RA (20) the email's return link counts as an ask ==="
plant packages/shared/src/product-feedback-schema.ts \
  "    return { show: true, trustpilotEligible: trustpilot, counts: false };" \
  "    return { show: true, trustpilotEligible: trustpilot, counts: true };" || { bad "RA20 STALE"; exit 1; }
run "RA20 email return not counted" "the email's return link shows the same card without counting" "$CONTRACT"

echo "=== RA (21) the ask ignores the usage trigger ==="
plant server/services/product-feedback/product-feedback-service.ts \
  "        (await moments.usageMet(caller.profileId)) &&
        !(await moments.checklistActive(caller))" \
  "        !(await moments.checklistActive(caller))" || { bad "RA21 STALE"; exit 1; }
run "RA21 usage trigger" "no ask before the trigger" "$CONTRACT"

echo "=== RA (22) the ask shows while the checklist is active (server) ==="
plant server/services/product-feedback/product-feedback-service.ts \
  "        (await moments.usageMet(caller.profileId)) &&
        !(await moments.checklistActive(caller))" \
  "        (await moments.usageMet(caller.profileId))" || { bad "RA22 STALE"; exit 1; }
run "RA22 checklist (server)" "none while the checklist is active" "$CONTRACT"

echo "=== RA (23) the ask shows while the checklist is active (Home) ==="
plant client/src/components/home/HomeReviewAsk.tsx \
  'enabled={moment === "email_return" || !checklistActive}' \
  'enabled' || { bad "RA23 STALE"; exit 1; }
run "RA23 checklist (Home)" "waits while the checklist has an open step" "$CONTRACT"

echo "=== RA (24) happy reviewers are sent on to Trustpilot (review gating) ==="
plant client/src/components/product-feedback/ReviewPrompt.tsx \
  '    onSuccess: () => setPhase("thanks"),' \
  '    onSuccess: () => {
      if ((rating ?? 0) >= 4) trustpilot.mutate();
      setPhase("thanks");
    },' || { bad "RA24 STALE"; exit 1; }
run "RA24 identical invitation" "the rating never changes what is offered or sent" "$PROMPT_UI"

echo "=== RA (25) the wording drifts from the approved draft ==="
plant client/src/components/product-feedback/ReviewPrompt.tsx \
  "              How&apos;s Lyceon working for you?" \
  "              Enjoying Lyceon?" || { bad "RA25 STALE"; exit 1; }
run "RA25 approved wording" "the approved wording" "$PROMPT_UI"

echo "=== RA (26) the analytics carry what was said ==="
plant server/routes/product-feedback-routes.ts \
  '            destination: "in_app_review",' \
  '            destination: "in_app_review",
            rating: parsed.data.rating,' || { bad "RA26 STALE"; exit 1; }
run "RA26 counts only" "counts which option was chosen, never what was said" "$CONTRACT"

echo "=== RA (27) the shared snooze drifts from the SQL's ==="
plant packages/shared/src/product-feedback-schema.ts \
  "export const REVIEW_ASK_SNOOZE_DAYS = 30;" \
  "export const REVIEW_ASK_SNOOZE_DAYS = 14;" || { bad "RA27 STALE"; exit 1; }
run "RA27 constants parity" "the constants are the SQL's" "$CONTRACT"

echo "=== Q6 (14) under-13 accounts are prompted ==="
plant packages/shared/src/product-feedback-schema.ts \
  "  if (age === null || age < REVIEW_MIN_AGE) return null;" \
  "  if (age === null) return null;" || { bad "C14 STALE"; exit 1; }
run "C14 13+ only" "never to an under-13 student" "$CONTRACT"

echo "=== Q6 (15) a moment is accepted from the wrong role ==="
plant server/services/product-feedback/product-feedback-service.ts \
  "  if (!reviewMomentFitsRole(query.moment, caller.role)) return none;" \
  "" || { bad "C15 STALE"; exit 1; }
run "C15 moment fits role" "a student's moment never asks a guardian" "$CONTRACT"

echo "=== Q6 (16) Trustpilot offered to a 17-year-old ==="
plant packages/shared/src/product-feedback-schema.ts \
  "  return age !== null && age >= TRUSTPILOT_MIN_AGE;" \
  "  return age !== null && age >= REVIEW_MIN_AGE;" || { bad "C16 STALE"; exit 1; }
run "C16 Trustpilot 18+ (server)" "Trustpilot: guardians and students 18+ only" "$CONTRACT"

echo "=== Q6 (17) the client shows Trustpilot whatever the server said ==="
plant client/src/components/product-feedback/ReviewPrompt.tsx \
  "  const trustpilotUrl = prompt.data.trustpilot_eligible
    ? trustpilotReviewUrl()
    : null;" \
  "  const trustpilotUrl = trustpilotReviewUrl();" || { bad "C17 STALE"; exit 1; }
run "C17 Trustpilot 18+ (client)" "hides Trustpilot from an under-18 account" "$PROMPT_UI"

echo "=== Q6 (18) Trustpilot shown before its URL exists ==="
plant packages/shared/src/product-feedback-schema.ts \
  '  if (typeof configured !== "string" || !configured.startsWith("https://")) {' \
  '  if (typeof configured !== "string") {' || { bad "C18 STALE"; exit 1; }
run "C18 Trustpilot env gate" "hides Trustpilot until VITE_TRUSTPILOT_REVIEW_URL is set" "$PROMPT_UI"

echo "=== Q6 (19) the prompt is mounted on the practice runner ==="
plant client/src/pages/resume-practice.tsx \
  "export default function" \
  "// <ReviewPrompt query={{ moment: \"home\" }} />
export default function" || { bad "C19 STALE"; exit 1; }
run "C19 mount allowlist" "ReviewPrompt is rendered from exactly these files" "$CONTRACT"

echo "=== Q6 (20) feedback text reaches the log ==="
plant server/routes/product-feedback-routes.ts \
  "          source: parsed.data.source," \
  "          source: parsed.data.source,
          text: parsed.data.body," || { bad "C20 STALE"; exit 1; }
run "C20 no content in logs" "never logs the text" "$CONTRACT"

echo "=== FB (5) the server lets an under-13 ask for a reply ==="
plant server/services/product-feedback/product-feedback-service.ts \
  "    !feedbackReplyAllowed(caller.role, caller.dateOfBirth, deps.now())" \
  "    false" || { bad "FB5 STALE"; exit 1; }
run "FB5 reply refused (server)" "an under-13 student cannot ask for a reply" "$FB_CONTRACT"

echo "=== FB (6) the dialog shows the reply checkbox to an under-13 ==="
plant client/src/components/product-feedback/FeedbackDialog.tsx \
  "            {replyAllowed ? (" \
  "            {true ? (" || { bad "FB6 STALE"; exit 1; }
run "FB6 reply hidden (UI)" "an under-13 student never sees the reply checkbox" "$FB_DIALOG"

echo "=== FB (7) the client keeps real ids in the page ==="
plant packages/shared/src/product-feedback-schema.ts \
  '    parts.map((seg) => (/^[a-z][a-z-]*$/.test(seg) ? seg : ":id")).join("/");' \
  '    parts.join("/");' || { bad "FB7 STALE"; exit 1; }
run "FB7 route pattern (client)" "a known route reads as its pattern" "$FB_CONTRACT"

echo "=== FB (8) the server accepts any page string ==="
plant packages/shared/src/product-feedback-schema.ts \
  "  .max(ROUTE_PATTERN_MAX_LENGTH)
  .regex(ROUTE_PATTERN_RE);" \
  "  .max(ROUTE_PATTERN_MAX_LENGTH);" || { bad "FB8 STALE"; exit 1; }
run "FB8 route pattern (server)" "the server refuses anything shaped like a URL" "$FB_CONTRACT"

echo "=== FB (9) any string passes as the app version ==="
plant packages/shared/src/product-feedback-schema.ts \
  'export const APP_VERSION_RE = /^([0-9a-f]{7}|dev)$/;' \
  'export const APP_VERSION_RE = /^.+$/;' || { bad "FB9 STALE"; exit 1; }
run "FB9 app version" "the app version is a short commit or dev" "$FB_CONTRACT"

echo "=== FB (10) the 2,000-character cap is gone ==="
plant packages/shared/src/product-feedback-schema.ts \
  "    body: z.string().trim().min(1).max(FEEDBACK_MAX_LENGTH),
    source: feedbackSourceSchema," \
  "    body: z.string().trim().min(1),
    source: feedbackSourceSchema," || { bad "FB10 STALE"; exit 1; }
run "FB10 length cap" "capped at 2,000" "$FB_CONTRACT"

echo "=== FB (11) feedback leaves the per-profile rate-limit bucket ==="
plant server/routes/product-feedback-routes.ts \
  '    singleBucketRateLimit("product_feedback", COMPONENT),' \
  '    singleBucketRateLimit("product_feedback_unlimited", COMPONENT),' || { bad "FB11 STALE"; exit 1; }
run "FB11 rate limit" "on the per-profile bucket" "$FB_CONTRACT"

echo "=== FB (12) an under-18's text reaches Slack ==="
plant server/lib/feedback-slack.ts \
  '  if (ageBand !== "18+") return null;' \
  '' || { bad "FB12 STALE"; exit 1; }
run "FB12 Slack: no text under 18" "never the text" "$FB_CONTRACT"

echo "=== FB (13) Slack text is cut at 400, not 300 ==="
plant server/lib/feedback-slack.ts \
  "export const FEEDBACK_SLACK_TEXT_MAX = 300;" \
  "export const FEEDBACK_SLACK_TEXT_MAX = 400;" || { bad "FB13 STALE"; exit 1; }
run "FB13 Slack: 300 characters" "the text cut at 300 characters" "$FB_CONTRACT"

echo "=== FB (14) an id reaches the Slack line ==="
plant server/routes/product-feedback-routes.ts \
  "              routePattern: parsed.data.route_pattern," \
  "              routePattern: caller.profileId," || { bad "FB14 STALE"; exit 1; }
run "FB14 Slack: no id" "Slack never carries a name, an email or an id" "$FB_CONTRACT"

echo "=== FB (15) a Slack failure fails the submission ==="
plant server/lib/feedback-slack.ts \
  '    return "failed";' \
  '    throw error;' || { bad "FB15 STALE"; exit 1; }
run "FB15 Slack failure is not the user's" "a Slack API error logs Slack's own code" "$FB_CONTRACT"

echo "=== FB (16) feedback text reaches the log ==="
plant server/routes/product-feedback-routes.ts \
  "          type: parsed.data.type,
          requestId: req.requestId," \
  "          type: parsed.data.type,
          note: parsed.data.body,
          requestId: req.requestId," || { bad "FB16 STALE"; exit 1; }
run "FB16 text never logged" "feedback text is never logged" "$FB_CONTRACT"

echo "=== FB (17) analytics carry the page ==="
plant server/routes/product-feedback-routes.ts \
  "              type: parsed.data.type,
              role: caller.role,
            })," \
  "              type: parsed.data.type,
              role: caller.role,
              page: parsed.data.route_pattern,
            })," || { bad "FB17 STALE"; exit 1; }
run "FB17 counts only" "feedback_submitted with the type and role only" "$FB_CONTRACT"

echo "=== FB (18) students lose Send feedback ==="
plant client/src/components/layout/app-shell.tsx \
  "          {feedback.item}" \
  "" || { bad "FB18 STALE"; exit 1; }
run "FB18 student menu" "a student's menu adds Send feedback after Help" "$SHELL_UI"

echo "=== FB (19) the practice runner gets the account menu ==="
plant client/src/lib/route-shells.ts \
  '  "/practice/session/:sessionId": focus("Practice", "/practice", false, null),' \
  '  "/practice/session/:sessionId": app(360, true, "column", null),' || { bad "FB19 STALE"; exit 1; }
run "FB19 not mid-question" "the practice runner, review runner, exam and report routes use the focus layout" "$FB_CONTRACT"

echo "=== FB (20) the homepage card shows without a review URL ==="
plant client/src/pages/home.tsx \
  "  const reviewUrl = trustpilotReviewUrl();
  if (reviewUrl === null) return null;" \
  '  const reviewUrl =
    trustpilotReviewUrl() ?? "https://www.trustpilot.com/evaluate/lyceon.ai";' || { bad "FB20 STALE"; exit 1; }
run "FB20 card needs the URL" "without the review URL" "$HOME_UI"

echo "=== FB (21) the card moves below the final call to action ==="
plant client/src/pages/home.tsx \
  '      <TrustpilotSection />

      <section aria-label="Get started" className={SECTION}>' \
  '      <section aria-label="Get started" className={SECTION}>' || { bad "FB21 STALE"; exit 1; }
plant client/src/pages/home.tsx \
  "    </PublicLayout>" \
  "      <TrustpilotSection />
    </PublicLayout>" || { bad "FB21 STALE"; exit 1; }
run "FB21 card position" "between the FAQ and the final call to action" "$HOME_UI"

echo "=== FB (22) the card loads a Trustpilot image ==="
plant client/src/components/marketing/TrustpilotReviewCard.tsx \
  '      <div className="flex flex-col gap-1.5">' \
  '      <img src="https://widget.trustpilot.com/stars.svg" alt="" />
      <div className="flex flex-col gap-1.5">' || { bad "FB22 STALE"; exit 1; }
run "FB22 no third-party request" "is text only and asks nothing of Trustpilot" "$HOME_UI"

echo "=== FB (23) the footer Trustpilot link shows without a URL ==="
plant client/src/components/layout/Footer.tsx \
  "              {trustpilotUrl !== null ? (" \
  "              {true ? (" || { bad "FB23 STALE"; exit 1; }
run "FB23 footer link needs the URL" "without the review URL" "$HOME_UI"

echo "=== FB (24) Feedback in the footer goes somewhere else ==="
plant client/src/components/layout/Footer.tsx \
  '                  href="/contact"' \
  '                  href="/help"' || { bad "FB24 STALE"; exit 1; }
run "FB24 footer Feedback" "Feedback goes to /contact" "$HOME_UI"

echo "=== FB (25) /contact grows a form ==="
plant client/src/pages/contact.tsx \
  "        </section>
      </div>
    </PublicLayout>" \
  "        </section>
        <form><input name=\"email\" /></form>
      </div>
    </PublicLayout>" || { bad "FB25 STALE"; exit 1; }
run "FB25 /contact has no form" "with no form" "$HOME_UI"

# ── Owner brief "Feedback → Slack: log the real reason when it can't post" (Karl, 2026-10-21):
#    one plant per rule. ──
SLACK_CLIENT=shared/slack/client.ts
SLACK_FB=server/lib/feedback-slack.ts

echo "=== FS (1) an env-schema failure is reported as something else ==="
plant "$SLACK_FB" \
  '    return misconfigured("env_invalid", { fields });' \
  '    return misconfigured("token_missing");' || { bad "FS1 STALE"; exit 1; }
run "FS1 reason env_invalid" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (2) a missing token is reported as a bad channel ==="
plant "$SLACK_CLIENT" \
  '      reason: "token_missing",' \
  '      reason: "channel_invalid",' || { bad "FS2 STALE"; exit 1; }
run "FS2 reason token_missing" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (3) a user token is reported as a missing one ==="
plant "$SLACK_CLIENT" \
  '      reason: "token_not_bot",' \
  '      reason: "token_missing",' || { bad "FS3 STALE"; exit 1; }
run "FS3 reason token_not_bot" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (4) a malformed channel is reported as a missing token ==="
plant "$SLACK_CLIENT" \
  '      reason: "channel_invalid",' \
  '      reason: "token_missing",' || { bad "FS4 STALE"; exit 1; }
run "FS4 reason channel_invalid" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (5) the channel ID is logged unredacted ==="
plant "$SLACK_FB" \
  '        ? { channel: redactChannel(env.data.SOCIAL_SLACK_CHANNEL_ID) }' \
  '        ? { channel: env.data.SOCIAL_SLACK_CHANNEL_ID }' || { bad "FS5 STALE"; exit 1; }
run "FS5 channel redacted" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (6) the token reaches the misconfiguration log ==="
plant "$SLACK_FB" \
  '      { requestId: deps.requestId, reason, ...detail },' \
  '      { requestId: deps.requestId, reason, ...detail, token: process.env.SLACK_BOT_TOKEN },' || { bad "FS6 STALE"; exit 1; }
run "FS6 token never logged (misconfigured)" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (7) the token reaches the post-failure log ==="
plant "$SLACK_FB" \
  '            slack_error: error.code,' \
  '            slack_error: error.code,
            token: config.value.token,' || { bad "FS7 STALE"; exit 1; }
run "FS7 token never logged (failed)" "a Slack API error logs Slack's own code" "$FB_CONTRACT"

echo "=== FS (8) Slack's error code is lost ==="
plant "$SLACK_FB" \
  '            slack_error: error.code,' \
  '            slack_error: "unknown",' || { bad "FS8 STALE"; exit 1; }
run "FS8 Slack's code logged" "a Slack API error logs Slack's own code" "$FB_CONTRACT"

echo "=== FS (9) a network error's message is logged ==="
plant "$SLACK_FB" \
  '            error_name: error instanceof Error ? error.name : "unknown",' \
  '            error_name: error instanceof Error ? error.message : "unknown",' || { bad "FS9 STALE"; exit 1; }
run "FS9 no error message" "a Slack API error logs Slack's own code" "$FB_CONTRACT"

echo "=== FS (10) a misconfiguration warns twice ==="
plant "$SLACK_FB" \
  '    return misconfigured("env_invalid", { fields });' \
  '    misconfigured("env_invalid", { fields });
    return misconfigured("env_invalid", { fields });' || { bad "FS10 STALE"; exit 1; }
run "FS10 one warning per submission" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (11) a misconfiguration fails the submission ==="
plant "$SLACK_FB" \
  '    return "misconfigured";' \
  '    throw new Error("misconfigured");' || { bad "FS11 STALE"; exit 1; }
run "FS11 submission unchanged" "Slack settings that are unusable" "$FB_CONTRACT"

echo "=== FS (12) SlackCallError passes any text through as its code ==="
plant "$SLACK_CLIENT" \
  '    this.code = /^[a-z0-9_]{1,64}$/.test(code) ? code : "unrecognised";' \
  '    this.code = code;' || { bad "FS12 STALE"; exit 1; }
run "FS12 code-shaped only" "SlackCallError keeps only a code-shaped value" "$FB_CONTRACT"

echo "=== Q5 (21) the onboarding checkbox is shown to an under-13 student ==="
plant client/src/pages/profile-complete.tsx \
  "    marketingOptInEligible(dateOfBirth === \"\" ? null : dateOfBirth, new Date());" \
  "    true;" || { bad "R21 STALE"; exit 1; }
run "R21 onboarding 13+" "is hidden for an under-13 student" "$ONBOARD_UI"

echo "=== RESTORED: re-check green ==="
OUT="$(check "$CONTRACT" "$PROMPT_UI" "$ONBOARD_UI" "$FIRST_TOUCH")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "MARKETING/REVIEWS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
