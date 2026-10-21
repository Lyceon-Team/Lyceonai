#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the lifecycle emails: the founding reminder (PR 1) and the behaviour
# triggers, the cap and the priority order (PR 2)
# ============================================================================
# @spec [owner brief "Lifecycle emails: reminder timing fix + behaviour triggers" (Karl,
#   2026-10-21) PR 1 and PR 2 "Tests and planted defects"; contracts/notifications.contract.md
#   C14A.4, C14A.5; SCL-239, SCL-240] | @implemented [2026-10-21]
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
# mutations"). PR 2 (20261110000000) replaced PR 1's claim: every reminder plant is re-pointed
# into `lifecycle_due` / `lifecycle_claim` there. Where a rule has two guards (the claim's cheap
# candidate filter and the condition itself), the plant removes both, or the second would hold
# the line alone and the plant would read as "not caught".
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261110000000_lifecycle_triggers.sql"
LIB="server/lib/lifecycle-email.ts"
ROUTE="server/routes/internal-cron-routes.ts"
PG_LR=tests/ci/lifecycle-reminder.pg.ci.test.ts
PG_LT=tests/ci/lifecycle-triggers.pg.ci.test.ts
WIRING=tests/ci/lifecycle-reminder.contract.test.ts
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/lc-mut.XXXX)"

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

pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null || { echo "LIFECYCLE EMAIL MUTATIONS: Postgres is required (PGHOST=$PGHOST)"; exit 1; }

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
stale() { bad "$1 STALE"; exit 1; }

echo "=== (0) GREEN BASELINE ==="
OUT="$(check "$PG_LR" "$PG_LT" "$WIRING")"; RC=$?
if [ "$RC" = 0 ]; then ok "baseline green"; else bad "baseline not green"; echo "$OUT" | tail -30; fi
if [ "$FAIL" -gt 0 ]; then echo "LIFECYCLE EMAIL MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

need_last lifecycle_due LC
need_last lifecycle_claim LC
need_last lifecycle_release LC

# ── The founding reminder (PR 1's rules, now in lifecycle_due / lifecycle_claim) ──────────────

echo "=== LR (1) the reminder is due after 2 days, not 3 ==="
plant "$MIG" "       AND v_at <= p_now - interval '3 days'" "       AND v_at <= p_now - interval '2 days'" || stale LR1
run "LR1 3 days" "R1 nothing before 3 days" "$PG_LR"

echo "=== LR (2) an entitled student is reminded ==="
plant "$MIG" "       AND NOT public.entitlement_active(p_profile_id);" "       AND true;" || stale LR2
run "LR2 not entitled" "R2–R6" "$PG_LR"

echo "=== LR (3) an under-13 or unknown-age student gets lifecycle email ==="
plant "$MIG" "          AND p.deleted_at IS NULL
          AND public.marketing_opt_in_age_eligible(p.date_of_birth))" "          AND p.deleted_at IS NULL)" || stale LR3
run "LR3 age 13+" "R2–R6" "$PG_LR"

echo "=== LR (4) a deleted account gets lifecycle email ==="
plant "$MIG" "          AND p.deleted_at IS NULL
" "" || stale LR4
plant "$MIG" "       AND p.deleted_at IS NULL
       AND (   p.profile_completed_at" "       AND (   p.profile_completed_at" || stale "LR4 (candidates)"
run "LR4 not deleted" "R2–R6" "$PG_LR"

echo "=== LR (5) a deletion-pending account gets lifecycle email ==="
plant "$MIG" "     OR EXISTS (SELECT 1 FROM public.account_deletion_requests d
                 WHERE d.profile_id = p_profile_id AND d.status = 'pending') THEN" " THEN" || stale LR5
run "LR5 no pending deletion" "R2–R6" "$PG_LR"

echo "=== LR (6) a guardian gets lifecycle email ==="
plant "$MIG" "          AND p.role = 'student'
" "" || stale LR6
plant "$MIG" "     WHERE p.role = 'student'
" "     WHERE p.role IN ('student', 'guardian')
" || stale "LR6 (candidates)"
run "LR6 students only" "R2–R6" "$PG_LR"

echo "=== LR (7) a student onboarded before the reminder's cutover is reminded a second time ==="
plant "$MIG" "       AND v_at >= public.lifecycle_reminder_since()
" "" || stale LR7
run "LR7 cutover" "R2–R6" "$PG_LR"

echo "=== LR (8) a sent lifecycle email goes out again once the cap clears ==="
plant "$MIG" "       WHERE e.event_id = v_id AND e.payload ->> 'state' = 'pending';" "       WHERE e.event_id = v_id AND e.payload ->> 'state' IN ('pending', 'sent')
         AND public.lifecycle_due(v_type, v_student, p_now);" || stale LR8
run "LR8 never twice" "R7 never twice" "$PG_LR"

echo "=== LR (9) lifecycle email during quiet hours ==="
plant "$LIB" "  if (quietHoursDeferral(now) !== null) {" "  if (quietHoursDeferral(now) === undefined) {" || stale LR9
run "LR9 quiet hours" "R9 quiet hours" "$PG_LR"

echo "=== LR (10) a denylisted address gets lifecycle email ==="
plant "$LIB" '  if (isDenylisted(profile.email, facts.denylist)) return "denylisted";
' "" || stale LR10
run "LR10 denylist" "R8 denylisted" "$PG_LR"

echo "=== LR (11) a refused send keeps the claim (never retried) ==="
plant "$LIB" "      if (!sent.ok) {
        await deps.release(claim);" "      if (!sent.ok) {" || stale LR11
run "LR11 release on refusal" "R10 a refused send releases the claim" "$PG_LR"

echo "=== LR (12) the lifecycle row gets an email message (the dispatcher would send it) ==="
plant "$MIG" "          v_id, v_type, v_student, '[]'::jsonb, jsonb_build_object('state', 'pending'));" "          v_id, v_type, v_student,
          jsonb_build_array(jsonb_build_object('profile_id', v_student, 'channels', jsonb_build_array('email'))),
          jsonb_build_object('state', 'pending'));" || stale LR12
run "LR12 no message" "R11 the ledger row has no message" "$PG_LR"

echo "=== LR (13) authenticated may run the claim ==="
plant "$MIG" "  public.lifecycle_release(uuid, text)
  TO service_role;" "  public.lifecycle_release(uuid, text)
  TO service_role, authenticated;" || stale LR13
run "LR13 grants" "R12 grants" "$PG_LR"

echo "=== LR (14) service_role loses the claim ==="
plant "$MIG" "GRANT EXECUTE ON FUNCTION
  public.lifecycle_triggers_since(),
  public.lifecycle_due(text, uuid, timestamptz),
  public.lifecycle_claim(timestamptz, integer)," "GRANT EXECUTE ON FUNCTION
  public.lifecycle_triggers_since(),
  public.lifecycle_due(text, uuid, timestamptz)," || stale LR14
run "LR14 service_role runs it" "R12 grants" "$PG_LR"

echo "=== LR (15) the sweep no longer runs the rule ==="
plant "$ROUTE" "        lifecycleReminder = await runLifecycleRule(
          new Date(),
          defaultLifecycleRuleDeps(),
        );" "        lifecycleReminder = { error: true };" || stale LR15
run "LR15 in the sweep" "runs the rule once, after the dispatch" "$WIRING"

echo "=== LR (16) the address reaches the log ==="
plant "$LIB" "        profileId: claim.profileId,
        event,
" "        profileId: claim.profileId,
        event,
        email: target.profile.email,
" || stale LR16
run "LR16 no address logged" "L1 no address" "$PG_LR"

echo "=== LR (17) no upper bound on the reminder: late, and again after a sweep ==="
plant "$MIG" "       AND v_at >  p_now - interval '14 days'
       AND NOT public.entitlement_active(p_profile_id);" "       AND NOT public.entitlement_active(p_profile_id);" || stale LR17
plant "$MIG" "       AND (   p.profile_completed_at > p_now - interval '14 days'" "       AND (   p.profile_completed_at IS NOT NULL" || stale "LR17 (candidates)"
run "LR17 days 3 to 14 only" "R13 due only on days 3 to 14" "$PG_LR"

# ── The behaviour triggers ────────────────────────────────────────────────────────────────────

echo "=== LT (1) diagnostic nudge after 47 hours ==="
plant "$MIG" "       AND v_at <= p_now - interval '48 hours'
       AND v_at >  p_now - interval '14 days'
       AND public.student_diagnostic_state" "       AND v_at <= p_now - interval '47 hours'
       AND v_at >  p_now - interval '14 days'
       AND public.student_diagnostic_state" || stale LT1
run "LT1 diagnostic 48 h" "D1 diagnostic" "$PG_LT"

echo "=== LT (2) a completed or abandoned diagnostic is nudged ==="
plant "$MIG" "       AND ps.status IN ('created', 'active');" "       ;" || stale LT2
plant "$MIG" "
       AND public.student_diagnostic_state(p_profile_id) = 'in_progress';" ";" || stale "LT2 (state)"
plant "$MIG" "                          AND ps.status IN ('created', 'active')
" "" || stale "LT2 (candidates)"
run "LT2 in flight only" "D2 diagnostic" "$PG_LT"

echo "=== LT (3) a diagnostic started before the cutover is nudged ==="
plant "$MIG" "       AND v_at >= public.lifecycle_triggers_since()
       AND v_at <= p_now - interval '48 hours'
       AND v_at >  p_now - interval '14 days'
       AND public.student_diagnostic_state" "       AND v_at <= p_now - interval '48 hours'
       AND v_at >  p_now - interval '14 days'
       AND public.student_diagnostic_state" || stale LT3
run "LT3 diagnostic cutover" "D2 diagnostic" "$PG_LT"

echo "=== LT (4) a diagnostic nudge weeks late ==="
plant "$MIG" "       AND v_at >  p_now - interval '14 days'
       AND public.student_diagnostic_state" "       AND public.student_diagnostic_state" || stale LT4
plant "$MIG" "                          AND ps.created_at > p_now - interval '14 days')" "                          AND true)" || stale "LT4 (candidates)"
run "LT4 diagnostic window" "D2 diagnostic" "$PG_LT"

echo "=== LT (5) Pro nudge after 47 hours ==="
plant "$MIG" "       AND v_at <= p_now - interval '48 hours'
       AND v_at >  p_now - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM public.calendar_current_plan c" "       AND v_at <= p_now - interval '47 hours'
       AND v_at >  p_now - interval '14 days'
       AND NOT EXISTS (SELECT 1 FROM public.calendar_current_plan c" || stale LT5
run "LT5 Pro 48 h" "P1 Pro" "$PG_LT"

echo "=== LT (6) a Pro student with a plan is nudged ==="
plant "$MIG" "       AND NOT EXISTS (SELECT 1 FROM public.calendar_current_plan c
                        WHERE c.student_id = p_profile_id);" "       AND true;" || stale LT6
run "LT6 no plan" "P2 Pro" "$PG_LT"

echo "=== LT (7) a cancelled entitlement counts as Pro ==="
plant "$MIG" "       AND public.entitlement_active(p_profile_id)
" "" || stale LT7
run "LT7 entitled" "P2 Pro" "$PG_LT"

echo "=== LT (8) entitled before the cutover is nudged ==="
plant "$MIG" "       AND public.entitlement_active(p_profile_id)
       AND v_at >= public.lifecycle_triggers_since()
" "       AND public.entitlement_active(p_profile_id)
" || stale LT8
run "LT8 Pro cutover" "P2 Pro" "$PG_LT"

echo "=== LT (9) practising after 9 items ==="
plant "$MIG" "    OFFSET 9 LIMIT 1;" "    OFFSET 8 LIMIT 1;" || stale LT9
run "LT9 10 items" "F1 practising" "$PG_LT"

echo "=== LT (10) QOTD answers count toward the 10 ==="
plant "$MIG" "       AND ps.mode <> 'qotd'
" "" || stale LT10
run "LT10 QOTD excluded" "F1 practising" "$PG_LT"

echo "=== LT (11) the diagnostic's answers stop counting (owner: they count) ==="
plant "$MIG" "       AND ps.mode <> 'qotd'
" "       AND ps.mode NOT IN ('qotd', 'diagnostic')
" || stale LT11
run "LT11 diagnostic counts" "F1 practising" "$PG_LT"

echo "=== LT (12) an entitled student gets the practising-on-free nudge ==="
plant "$MIG" "       AND NOT public.entitlement_active(p_profile_id)
       AND v_at >= public.lifecycle_triggers_since()
       AND v_at <= p_now
" "       AND v_at >= public.lifecycle_triggers_since()
       AND v_at <= p_now
" || stale LT12
run "LT12 free only" "F2 practising" "$PG_LT"

echo "=== LT (13) no cap ==="
plant "$MIG" "    CONTINUE WHEN EXISTS (" "    CONTINUE WHEN false AND EXISTS (" || stale LT13
run "LT13 cap" "C1 the cap" "$PG_LT"

echo "=== LT (14) the cap is 2 days ==="
plant "$MIG" "                  AND (e.payload ->> 'sent_at')::timestamptz > p_now - interval '3 days')));" "                  AND (e.payload ->> 'sent_at')::timestamptz > p_now - interval '2 days')));" || stale LT14
run "LT14 3 days" "C1 the cap" "$PG_LT"

echo "=== LT (15) the reminder does not count toward the cap ==="
plant "$MIG" "         AND (   (e.payload = '{}'::jsonb AND e.created_at > p_now - interval '3 days')
              OR (e.payload ->> 'state' = 'sent'" "         AND e.event_type <> 'lifecycle_reminder_due'
         AND (   (e.payload = '{}'::jsonb AND e.created_at > p_now - interval '3 days')
              OR (e.payload ->> 'state' = 'sent'" || stale LT15
run "LT15 cap across all" "C1 the cap" "$PG_LT"

echo "=== LT (16) the diagnostic nudge outranks the reminder ==="
plant "$MIG" "ARRAY['lifecycle_reminder_due',
                                   'lifecycle_diagnostic_unfinished'," "ARRAY['lifecycle_diagnostic_unfinished',
                                   'lifecycle_reminder_due'," || stale LT16
run "LT16 priority" "O1 the priority order" "$PG_LT"

# (Pro and practising are never due together — one needs an entitlement, the other none — so
# their relative order cannot change an outcome and has no plant.)

echo "=== LT (18) no self-cancel: a waiting nudge the student acted on still goes out ==="
plant "$MIG" "      ELSIF v_state = 'pending' AND NOT v_due THEN" "      ELSIF false THEN" || stale LT18
run "LT18 self-cancel" "S1 self-cancel" "$PG_LT"

echo "=== LT (19) the Pro nudge reaches Resend as the wrong event ==="
plant "$LIB" '  lifecycle_pro_no_plan: "lyceon.pro_no_plan",' '  lifecycle_pro_no_plan: "lyceon.practising_free",' || stale LT19
run "LT19 event names" "E1 each trigger" "$PG_LT"

echo "=== LT (20) PR 1's reminder rows stop counting toward the cap ==="
plant "$MIG" "         AND (   (e.payload = '{}'::jsonb AND e.created_at > p_now - interval '3 days')
              OR (e.payload ->> 'state' = 'sent'" "         AND (   (e.payload ->> 'state' = 'sent'" || stale LT20
run "LT20 legacy rows in the cap" "L2 PR 1's reminder rows" "$PG_LT"

echo "=== LT (21) the sweep takes FOR UPDATE and blocks students' own writes ==="
plant "$MIG" "     FOR NO KEY UPDATE OF p SKIP LOCKED" "     FOR UPDATE OF p SKIP LOCKED" || stale LT21
run "LT21 lock mode" "K1 the sweep never blocks" "$PG_LT"

echo "=== LT (22) the candidate filter reads answered_at alone ==="
plant "$MIG" "                          AND COALESCE(i.answered_at, i.occurred_at) > p_now - interval '14 days')" "                          AND i.answered_at > p_now - interval '14 days')" || stale LT22
run "LT22 occurred_at" "F3 practising" "$PG_LT"

echo "=== RESTORED: re-check green ==="
OUT="$(check "$PG_LR" "$PG_LT" "$WIRING")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "LIFECYCLE EMAIL MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
