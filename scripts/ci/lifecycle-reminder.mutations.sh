#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the founding reminder (lifecycle emails PR 1)
# ============================================================================
# @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
#   2026-10-21) PR 1 "Tests and planted defects: no event before 3 days; none if entitled; none
#   during quiet hours; never twice; age, deletion and denylist exclusions; grants as
#   service_role"; contracts/notifications.contract.md C14A.4; SCL-239] | @implemented [2026-10-21]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared substring.
#   RULE 3 — GREEN BASELINE + RESTORE. Every check is green before the plants and the files are
#            restored after each one (and on exit).
#
# SQL plants edit the migration that DEFINES the function today, and the harness re-checks that
# it is still the LAST definer (CLAUDE.md, "a migration that replaces a function body orphans its
# mutations"). The PG suite rebuilds its database from the migration files on every run.
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261109000000_lifecycle_reminder_due.sql"
LIB="server/lib/lifecycle-email.ts"
ROUTE="server/routes/internal-cron-routes.ts"
PG_LR=tests/ci/lifecycle-reminder.pg.ci.test.ts
WIRING=tests/ci/lifecycle-reminder.contract.test.ts
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/lr-mut.XXXX)"

FILES=("$MIG" "$LIB" "$ROUTE")
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

pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null || { echo "LIFECYCLE REMINDER MUTATIONS: Postgres is required (PGHOST=$PGHOST)"; exit 1; }

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
OUT="$(check "$PG_LR" "$WIRING")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; fi
if [ "$FAIL" -gt 0 ]; then echo "LIFECYCLE REMINDER MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

need_last lifecycle_reminder_claim LR1
need_last lifecycle_reminder_release LR11

echo "=== LR (1) the reminder is due after 2 days, not 3 ==="
plant "$MIG" \
  "       AND p.profile_completed_at <= p_now - interval '3 days'" \
  "       AND p.profile_completed_at <= p_now - interval '2 days'" || { bad "LR1 STALE"; exit 1; }
run "LR1 3 days" "R1 nothing before 3 days" "$PG_LR"

echo "=== LR (2) an entitled student is reminded ==="
plant "$MIG" "       AND NOT public.entitlement_active(p.id)
" "" || { bad "LR2 STALE"; exit 1; }
run "LR2 not entitled" "R2–R6" "$PG_LR"

echo "=== LR (3) an under-13 or unknown-age student is reminded ==="
plant "$MIG" "       AND public.marketing_opt_in_age_eligible(p.date_of_birth)
" "" || { bad "LR3 STALE"; exit 1; }
run "LR3 age 13+" "R2–R6" "$PG_LR"

echo "=== LR (4) a deleted account is reminded ==="
plant "$MIG" "       AND p.deleted_at IS NULL
" "" || { bad "LR4 STALE"; exit 1; }
run "LR4 not deleted" "R2–R6" "$PG_LR"

echo "=== LR (5) a deletion-pending account is reminded ==="
plant "$MIG" "       AND NOT EXISTS (SELECT 1 FROM public.account_deletion_requests d
                        WHERE d.profile_id = p.id AND d.status = 'pending')
" "" || { bad "LR5 STALE"; exit 1; }
run "LR5 no pending deletion" "R2–R6" "$PG_LR"

echo "=== LR (6) a guardian is reminded ==="
plant "$MIG" "     WHERE p.role = 'student'
" "     WHERE p.role IN ('student', 'guardian')
" || { bad "LR6 STALE"; exit 1; }
run "LR6 students only" "R2–R6" "$PG_LR"

echo "=== LR (7) a student onboarded before the cutover is reminded a second time ==="
plant "$MIG" "       AND p.profile_completed_at >= public.lifecycle_reminder_since()
" "" || { bad "LR7 STALE"; exit 1; }
run "LR7 cutover" "R2–R6" "$PG_LR"

echo "=== LR (8) the reminder is sent twice ==="
plant "$MIG" "       AND NOT EXISTS (SELECT 1 FROM public.notification_events e
                        WHERE e.event_id = public.notification_event_id(
                                             'lifecycle_reminder_due', p.id::text))
" "" || { bad "LR8 STALE"; exit 1; }
# Both "never twice" guards go: the claim's filter and the re-check under the lock (which exists
# for overlapping runs and would otherwise hold the line on its own).
plant "$MIG" "    CONTINUE WHEN EXISTS (SELECT 1 FROM public.notification_events e
                           WHERE e.event_id = public.notification_event_id(
                                                'lifecycle_reminder_due', v_id::text));
" "" || { bad "LR8 STALE (re-check)"; exit 1; }
run "LR8 never twice" "R7 never twice" "$PG_LR"

echo "=== LR (9) the reminder is sent during quiet hours ==="
plant "$LIB" "  if (quietHoursDeferral(now) !== null) {" "  if (quietHoursDeferral(now) === undefined) {" || { bad "LR9 STALE"; exit 1; }
run "LR9 quiet hours" "R9 quiet hours" "$PG_LR"

echo "=== LR (10) a denylisted address is reminded ==="
plant "$LIB" '  if (isDenylisted(profile.email, facts.denylist)) return "denylisted";
' "" || { bad "LR10 STALE"; exit 1; }
run "LR10 denylist" "R8 denylisted" "$PG_LR"

echo "=== LR (11) a refused send keeps the claim (never retried) ==="
plant "$LIB" "      if (!sent.ok) {
        await deps.release(profileId);" "      if (!sent.ok) {" || { bad "LR11 STALE"; exit 1; }
run "LR11 release on refusal" "R10 a refused send releases the claim" "$PG_LR"

echo "=== LR (12) the reminder row gets an email message (the dispatcher would send it) ==="
plant "$MIG" "      v_id,
      '[]'::jsonb," "      v_id,
      jsonb_build_array(jsonb_build_object('profile_id', v_id, 'channels', jsonb_build_array('email')))," || { bad "LR12 STALE"; exit 1; }
run "LR12 no message" "R11 the ledger row has no message" "$PG_LR"

echo "=== LR (13) authenticated may claim reminders ==="
plant "$MIG" "  public.lifecycle_reminder_release(uuid)
  TO service_role;" "  public.lifecycle_reminder_release(uuid)
  TO service_role, authenticated;" || { bad "LR13 STALE"; exit 1; }
run "LR13 grants" "R12 grants" "$PG_LR"

echo "=== LR (14) service_role loses the claim ==="
plant "$MIG" "GRANT EXECUTE ON FUNCTION
  public.lifecycle_reminder_since(),
  public.lifecycle_reminder_claim(timestamptz, integer)," "GRANT EXECUTE ON FUNCTION
  public.lifecycle_reminder_since()," || { bad "LR14 STALE"; exit 1; }
run "LR14 service_role runs it" "R12 grants" "$PG_LR"

echo "=== LR (15) the sweep no longer runs the rule ==="
plant "$ROUTE" "        lifecycleReminder = await runLifecycleReminderRule(
          new Date(),
          defaultReminderDeps(),
        );" "        lifecycleReminder = { error: true };" || { bad "LR15 STALE"; exit 1; }
run "LR15 in the sweep" "runs the rule once, after the dispatch" "$WIRING"

echo "=== LR (16) the address reaches the log ==="
plant "$LIB" "        event: REMINDER_DUE_EVENT,
" "        event: REMINDER_DUE_EVENT,
        email: target.profile.email,
" || { bad "LR16 STALE"; exit 1; }
run "LR16 no address logged" "L1 no address" "$PG_LR"

echo "=== LR (17) no upper bound: a swept record lets the reminder go out again ==="
plant "$MIG" "       AND p.profile_completed_at >  p_now - interval '14 days'
" "" || { bad "LR17 STALE"; exit 1; }
run "LR17 days 3 to 14 only" "R13 due only on days 3 to 14" "$PG_LR"

echo "=== RESTORED: re-check green ==="
OUT="$(check "$PG_LR" "$WIRING")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "LIFECYCLE REMINDER MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
