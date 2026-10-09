#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the marketing email lane (Resend sync + unsubscribe back-sync)
# ============================================================================
# @spec [owner brief "SEO vertical — email lane" 2026-10-07, acceptance: "A planted defect turns
#   each guard red"; contracts/notifications.contract.md §14] | @implemented [2026-10-07]
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
# mutations"). The PG suite rebuilds its database from the migration files on every run.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261028000000_marketing_email_sync.sql"
# set_marketing_consent was REPLACED by 20261029000000 (F-83: a grant needs a version). M5 is
# re-pointed there; every other object is still last defined in $MIG. need_last checks per plant.
MIG_F83="supabase/migrations/20261029000000_test_dates_and_consent_guard.sql"
SYNC="server/lib/marketing-email-sync.ts"
HOOK="server/routes/resend-webhook.ts"
EXEC="server/lib/account-deletion-execute.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/mes-mut.XXXX)"

FILES=("$MIG" "$MIG_F83" "$SYNC" "$HOOK" "$EXEC")
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
PG_SUITE=tests/ci/marketing-email-sync.pg.ci.test.ts
PLAN=tests/ci/marketing-email-sync.plan.test.ts
NOTICE=tests/ci/deletion-completed-notice.pg.ci.test.ts

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "MARKETING EMAIL MUTATIONS: no Postgres at $PGHOST:$PGPORT — every guard here needs it (a skip is not a pass)"
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
  local target="${3:-$MIG}"
  [ "$(last_definer "$1")" = "$target" ] || { bad "$2 targets $target but $1 is last defined in $(last_definer "$1")"; exit 1; }
}

run() {
  local name="$1" sub="$2"; shift 2
  local out rc
  out="$(check "$@")"; rc=$?
  expect_red "$name" "$sub" "$out" "$rc"
  restore
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$PG_SUITE" "$PLAN" "$NOTICE")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "MARKETING EMAIL MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (1) the audience forgets the age rule ==="
need_last marketing_email_audience M1
plant "$MIG" "   WHERE p.marketing_opt_in
     AND public.marketing_opt_in_age_eligible(p.date_of_birth)" "   WHERE p.marketing_opt_in
     AND true" || { bad "M1 STALE"; exit 1; }
run "M1 under-13 / no DOB synced" "S3 under-13 and no date of birth are never synced" "$PG_SUITE"

echo "=== (2) the audience keeps marketing to a pending deletion ==="
plant "$MIG" "        WHERE r.profile_id = p.id AND r.status = 'pending'" "        WHERE false" || { bad "M2 STALE"; exit 1; }
run "M2 pending deletion still synced" "S4 a pending deletion request removes the contact" "$PG_SUITE"

echo "=== (3) the back-sync stops deduplicating by event id ==="
need_last apply_marketing_email_optout M3
plant "$MIG" "  IF NOT FOUND THEN
    RETURN 'duplicate';
  END IF;" "  NULL;" || { bad "M3 STALE"; exit 1; }
run "M3 replay not deduplicated" "W3 replaying the same webhook" "$PG_SUITE"

echo "=== (4) a complaint is logged as an unsubscribe ==="
plant "$MIG" "    v_source := 'email_complaint';" "    v_source := 'email_unsubscribe';" || { bad "M4 STALE"; exit 1; }
run "M4 complaint source lost" "W4 email.complained" "$PG_SUITE"

echo "=== (5) a provider event can grant ==="
need_last set_marketing_consent M5 "$MIG_F83"
plant "$MIG_F83" "  IF p_granted AND p_source IN ('email_unsubscribe', 'email_complaint') THEN" "  IF false THEN" || { bad "M5 STALE"; exit 1; }
run "M5 provider grant allowed" "D1 a provider source can only withdraw" "$PG_SUITE"

echo "=== (6) the webhook skips signature verification ==="
plant "$HOOK" "  if (!verified.ok) {" "  if (false) {" || { bad "M6 STALE"; exit 1; }
run "M6 signature bypass" "W1 a bad or missing signature is rejected" "$PG_SUITE"

echo "=== (7) the webhook ignores unsubscribes ==="
plant "$HOOK" "    if (!contact.data.unsubscribed) {" "    if (true) {" || { bad "M7 STALE"; exit 1; }
run "M7 unsubscribe ignored" "W2 contact.updated with unsubscribed" "$PG_SUITE"

echo "=== (8) the webhook ignores complaints ==="
plant "$HOOK" "  if (eventType === RESEND_EMAIL_COMPLAINED) {" "  if (false) {" || { bad "M8 STALE"; exit 1; }
run "M8 complaint ignored" "W4 email.complained" "$PG_SUITE"

echo "=== (9) the reconcile deletes unsubscribed contacts WITHOUT bringing the unsubscribe back ==="
plant "$SYNC" "  for (const item of plan.optOut) {" "  for (const item of [] as typeof plan.optOut) {" || { bad "M9 STALE"; exit 1; }
run "M9 unsubscribe lost on delete" "S5 an unsubscribe in Resend comes back BEFORE" "$PG_SUITE"

echo "=== (10) an opted-out profile's contact is kept ==="
plant "$SYNC" "    if (!owner) {
      plan.delete.push({ contactId: contact.id, profileId: knownOwner });" "    if (!owner) {
      void knownOwner;" || { bad "M10 STALE"; exit 1; }
run "M10 opt-out not removed" "S2 opt-out in Lyceon" "$PG_SUITE" "$PLAN"

echo "=== (11) everyone lands in the students segment ==="
plant "$SYNC" "      segmentIds[item.segment]," "      segmentIds.students," || { bad "M11 STALE"; exit 1; }
run "M11 wrong segment" "S1 opt-in" "$PG_SUITE"

echo "=== (12) a failed contact read no longer stops the run ==="
plant "$SYNC" "  if (!all.ok || !inStudents.ok || !inGuardians.ok) {" "  if (false) {" || { bad "M12 STALE"; exit 1; }
run "M12 partial read acted on" "S7 a failed read writes nothing" "$PG_SUITE"

echo "=== (13) the run summary logs the audience's addresses ==="
plant "$SYNC" "      requestId,
      ...summary,
    }," "      requestId,
      ...summary,
      audience: audience.map((a) => a.email),
    }," || { bad "M13 STALE"; exit 1; }
run "M13 address in a log" "L1 no address appears in any log line" "$PG_SUITE"

echo "=== (14) account deletion stops removing the contact ==="
plant "$EXEC" "        const removed = await removeMarketingContactForDeletion(recipientEmail);" "        const removed = \"absent\";" || { bad "M14 STALE"; exit 1; }
run "M14 deletion keeps the contact" "A4.1 the address is read BEFORE the RPCs" "$NOTICE"

echo
echo "MARKETING EMAIL MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
