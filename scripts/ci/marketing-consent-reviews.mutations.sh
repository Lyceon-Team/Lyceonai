#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the marketing opt-in (plan Q5) and reviews / feedback (plan Q6)
# ============================================================================
# @spec [docs/plans/seo/seo-marketing-vertical.md rows Q5/Q6; the SEO Wave 2 brief's acceptance
#   item 3 ("A planted mutation turns each guard red")] | @implemented [2026-10-05]
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
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/mcr-mut.XXXX)"

FILES=(
  "$MIG"
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
need_last() {
  [ "$(last_definer "$1")" = "$MIG" ] || { bad "$2 targets $MIG but $1 is last defined in $(last_definer "$1")"; exit 1; }
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
  OUT="$(check "$PG_DB" "$PG_ROUTES" "$SIGNUP_PG")"; RC=$?
  [ "$RC" = 0 ] && ok "PG suites green" || { bad "PG suites not green"; echo "$OUT" | tail -30; }
else
  echo "  SKIP  PG plants — no Postgres at $PGHOST:$PGPORT (a skip, not a pass)"
fi
OUT="$(check "$CONTRACT" "$PROMPT_UI" "$ONBOARD_UI" "$FIRST_TOUCH")"; RC=$?
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
  need_last profiles_marketing_consent_guard R2
  plant "$MIG" \
    "  IF NEW.marketing_opt_in AND NOT public.marketing_opt_in_age_eligible(NEW.date_of_birth) THEN" \
    "  IF false THEN" || { bad "R2 STALE"; exit 1; }
  run "R2 trigger guard" "a direct write is refused for an under-13 date of birth" "$PG_DB"

  echo "=== Q5 (3) the age rule is 10, not 13 ==="
  need_last marketing_opt_in_age_eligible R3
  plant "$MIG" "(current_date - interval '13 years')" "(current_date - interval '10 years')" || { bad "R3 STALE"; exit 1; }
  run "R3 age threshold" "the day before the 13th birthday is refused" "$PG_DB"

  echo "=== Q5 (4) the logged setter grants to an under-13 account ==="
  need_last set_marketing_consent R4
  plant "$MIG" \
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
  plant "$MIG" \
    "  PERFORM set_config('lyceon.marketing_consent_source', p_source, true);" \
    "  PERFORM set_config('lyceon.marketing_consent_source', 'system', true);" || { bad "R6 STALE"; exit 1; }
  run "R6 consent source" "records source signup" "$PG_ROUTES"

  echo "=== Q5 (7) consent_captured fires on a withdrawal too ==="
  plant server/lib/marketing-consent.ts \
    "  if (write === null || !write.ok || !write.changed || !write.granted) return;" \
    "  if (write === null || !write.ok || !write.changed) return;" || { bad "R7 STALE"; exit 1; }
  run "R7 grant-only emission" "turning it off always works" "$PG_ROUTES"

  echo "=== Q6 (8) the prompt claim is no longer compare-and-set ==="
  need_last product_review_prompt_claim C8
  plant "$MIG" \
    "   WHERE product_review_prompt_state.last_shown_at IS NOT DISTINCT FROM p_expected" \
    "   WHERE TRUE" || { bad "C8 STALE"; exit 1; }
  run "C8 compare-and-set" "two tabs reading the same state show it once" "$PG_DB"

  echo "=== Q6 (9) a dismissal counts every click ==="
  need_last product_review_prompt_dismiss C9
  plant "$MIG" \
    "     AND (last_dismissed_at IS NULL OR last_dismissed_at < last_shown_at);" \
    "     AND TRUE;" || { bad "C9 STALE"; exit 1; }
  run "C9 one dismissal per showing" "a dismissal counts once per showing" "$PG_DB"

  echo "=== Q6 (10) account deletion stops removing feedback ==="
  plant "$MIG" \
    "  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  audience        text        NOT NULL CHECK (audience IN ('student', 'guardian')),
  body            text        NOT NULL" \
    "  profile_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE NO ACTION,
  audience        text        NOT NULL CHECK (audience IN ('student', 'guardian')),
  body            text        NOT NULL" || { bad "C10 STALE"; exit 1; }
  run "C10 deletion cascade" "deleting the profile removes its rows" "$PG_DB"

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

echo "=== Q6 (11) the 120-day cooldown is gone ==="
plant packages/shared/src/product-feedback-schema.ts \
  "      state.last_shown_at !== null &&" \
  "      false &&" || { bad "C11 STALE"; exit 1; }
run "C11 cooldown" "none within 120 days" "$CONTRACT"

echo "=== Q6 (12) a review no longer stops the prompt ==="
plant packages/shared/src/product-feedback-schema.ts \
  "    if (state.reviewed_at !== null) return { show: false, reason: \"reviewed\" };" \
  "" || { bad "C12 STALE"; exit 1; }
run "C12 stop after review" "never again after a review (in-app or the Trustpilot button)" "$CONTRACT"

echo "=== Q6 (13) a third dismissal is needed to stop it ==="
plant packages/shared/src/product-feedback-schema.ts \
  "    if (state.dismiss_count >= REVIEW_PROMPT_MAX_DISMISSALS) {" \
  "    if (state.dismiss_count > REVIEW_PROMPT_MAX_DISMISSALS) {" || { bad "C13 STALE"; exit 1; }
run "C13 stop after 2 dismissals" "none after 2 dismissals" "$CONTRACT"

echo "=== Q6 (14) under-13 accounts are prompted ==="
plant packages/shared/src/product-feedback-schema.ts \
  "  if (age === null || age < REVIEW_MIN_AGE) return null;" \
  "  if (age === null) return null;" || { bad "C14 STALE"; exit 1; }
run "C14 13+ only" "never to an under-13 student" "$CONTRACT"

echo "=== Q6 (15) a moment is accepted from the wrong role ==="
plant server/services/product-feedback/product-feedback-service.ts \
  "  if (!momentFitsRole(query, caller.role)) return NO;" \
  "" || { bad "C15 STALE"; exit 1; }
run "C15 moment fits role" "a student's moment never prompts a guardian" "$CONTRACT"

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
plant client/src/lib/product-feedback-api.ts \
  '  if (typeof configured !== "string" || !configured.startsWith("https://")) {' \
  '  if (typeof configured !== "string") {' || { bad "C18 STALE"; exit 1; }
run "C18 Trustpilot env gate" "hides Trustpilot until VITE_TRUSTPILOT_REVIEW_URL is set" "$PROMPT_UI"

echo "=== Q6 (19) the prompt is mounted on the practice runner ==="
plant client/src/pages/resume-practice.tsx \
  "export default function" \
  "// <ReviewPrompt query={{ moment: \"study_week\" }} />
export default function" || { bad "C19 STALE"; exit 1; }
run "C19 mount allowlist" "ReviewPrompt is rendered from exactly these files" "$CONTRACT"

echo "=== Q6 (20) feedback text reaches the log ==="
plant server/routes/product-feedback-routes.ts \
  "          source: parsed.data.source," \
  "          source: parsed.data.source,
          text: parsed.data.body," || { bad "C20 STALE"; exit 1; }
run "C20 no content in logs" "never logs the text" "$CONTRACT"

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
