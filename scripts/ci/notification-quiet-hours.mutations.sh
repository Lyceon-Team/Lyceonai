#!/usr/bin/env bash
# Notification schedules, quiet hours, expiry and week-notice order — mutation harness.
#
# @spec [owner rulings, Karl 2026-10-09, schedule audit Step 2: item 1 (the four schedules), item 2
#       (quiet hours in the shared sender: 21:00–08:00 America/Chicago, deferred never dropped,
#       user-triggered exempt), item 3(1) (expiry), 3(3) (the 17:00 QOTD run sends qotd_daily only),
#       3(4) (the week notice after the weekly re-plan); "each observed failing once under a plant
#       at an exact line"] | @implemented [2026-10-09]
#
# Each plant breaks ONE rule and must turn a NAMED test red. The same three rules as the other
# *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function must edit the migration that LAST defines it
#            (need_last), or it edits a body the pipeline overwrites and proves nothing.
# The plant prints the line it landed on (RULE 1 by line number, not by pattern).
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261031000000_notification_quiet_hours_expiry.sql"
VERCEL="vercel.json"
SHARED="packages/shared/src/notifications-schema.ts"
QUIET="server/lib/notifications/quiet-hours.ts"
TRANSPORT="server/lib/notifications/transport.ts"
DIRECT="server/lib/notifications/direct-sends.ts"
DISPATCH="server/lib/notifications/dispatch.ts"
QOTD_JOB="server/services/qotd/qotd-email-job.ts"
WEEKLY="server/services/calendar/weekly-job.ts"
NOTIFY="server/services/calendar/exam-notify-job.ts"
ROUTES="server/routes/internal-cron-routes.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/nqh-mut.XXXX)"

FILES=("$MIG" "$VERCEL" "$SHARED" "$QUIET" "$TRANSPORT" "$DIRECT" "$DISPATCH" "$QOTD_JOB" "$WEEKLY" "$NOTIFY" "$ROUTES")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new> — exactly one occurrence, or STALE. Prints file:line of the landing.
plant() {
  python3 - "$1" "$2" "$3" <<'PY'
import io, sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = io.open(p, encoding="utf-8").read()
n = s.count(old)
if n != 1:
    sys.stderr.write("STALE: target found %d times in %s (expected exactly 1)\n" % (n, p))
    sys.exit(9)
line = s[: s.index(old)].count("\n") + 1
print("    planted at %s:%d" % (p, line))
io.open(p, "w", encoding="utf-8").write(s.replace(old, new))
PY
}

check() { pnpm exec vitest run "$@" 2>&1; }
PG_SUITE=tests/ci/notification-quiet-hours.pg.ci.test.ts
QOTD_SUITE=tests/ci/home-qotd.pg.ci.test.ts
VERCEL_SUITE=tests/ci/vercel-cron-schedules.contract.test.ts
ROUTE_SUITE=tests/ci/execute-deletions-quiet-hours.contract.test.ts
UNIT_SUITE=tests/ci/calendar.exam-notify-job.test.ts

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "QUIET-HOURS MUTATIONS: no Postgres at $PGHOST:$PGPORT — the SQL plants need it (a skip is not a pass)"
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
OUT="$(check "$PG_SUITE" "$QOTD_SUITE" "$VERCEL_SUITE" "$ROUTE_SUITE" "$UNIT_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "QUIET-HOURS MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (1) a moved schedule reverts ==="
plant "$VERCEL" '"path": "/api/internal/calendar-exam-notify",
      "schedule": "0 21 * * *"' '"path": "/api/internal/calendar-exam-notify",
      "schedule": "0 6 * * *"' || { bad "Q1 STALE"; exit 1; }
run "Q1 schedules pinned" "the four moved schedules" "$VERCEL_SUITE"

echo "=== (2) 21:00 is treated as daytime ==="
plant "$QUIET" "    hour < EMAIL_QUIET_HOURS_START_HOUR" "    hour <= EMAIL_QUIET_HOURS_START_HOUR" || { bad "Q2 STALE"; exit 1; }
run "Q2 21:00 defers" "20:59 sends; 21:00 postpones (CDT)" "$PG_SUITE"

echo "=== (3) the window ignores DST (a fixed UTC-5) ==="
plant "$SHARED" 'export const EMAIL_QUIET_HOURS_TIME_ZONE = "America/Chicago";' 'export const EMAIL_QUIET_HOURS_TIME_ZONE = "Etc/GMT+5";' || { bad "Q3 STALE"; exit 1; }
run "Q3 DST" "CST 2026-12-15: 01:00" "$PG_SUITE"

echo "=== (4) the dispatcher sends in quiet hours ==="
plant "$DISPATCH" "  const notBefore = quietHoursDeferral(now);" "  const notBefore: Date | null = null;" || { bad "Q4 STALE"; exit 1; }
run "Q4 dispatch defers" "CDT 2026-07-15: 01:00" "$PG_SUITE"

echo "=== (5) the queue ignores not_before ==="
need_last notification_dispatch_queue Q5 "$MIG"
plant "$MIG" "     AND (m.not_before IS NULL OR m.not_before <= p_now)
" "" || { bad "Q5 STALE"; exit 1; }
run "Q5 not selected before 08:00" "CDT 2026-07-15: 01:00" "$PG_SUITE"

echo "=== (6) user-triggered mail is held too ==="
plant "$TRANSPORT" "    const deferredTo = quietHoursApply(input.audience)" "    const deferredTo = true" || { bad "Q6 STALE"; exit 1; }
run "Q6 exemption" "the guardian invite a student sends" "$PG_SUITE"

echo "=== (7) the deletion-completed notice is exempted ==="
plant "$DIRECT" '    audience: "student_or_guardian",' '    audience: "user_triggered",' || { bad "Q7 STALE"; exit 1; }
run "Q7 completed notice not exempt" "deletion-completed notice is NOT exempt" "$PG_SUITE"

echo "=== (8) the exam reminder is born without an expiry ==="
need_last calendar_emit_exam_notification Q8 "$MIG"
plant "$MIG" "    (p_local_date::timestamp AT TIME ZONE p_timezone)
  );" "    NULL::timestamptz
  );" || { bad "Q8 STALE"; exit 1; }
run "Q8 emitter sets expiry" "the emitter sets it" "$PG_SUITE"

echo "=== (9) an expired email is sent anyway ==="
plant "$DISPATCH" "  if (expiresAt !== null && now.getTime() >= expiresAt.getTime()) {" "  if (false) {" || { bad "Q9 STALE"; exit 1; }
run "Q9 expired is dropped" "the emitter sets it" "$PG_SUITE"

echo "=== (10) a deferral past the expiry is postponed instead of dropped ==="
plant "$DISPATCH" "    if (expiresAt !== null && notBefore.getTime() >= expiresAt.getTime()) {" "    if (false) {" || { bad "Q10 STALE"; exit 1; }
run "Q10 deferral past expiry" "a quiet-hours deferral that would land after the test day" "$PG_SUITE"

echo "=== (11) the week notice ignores the re-plan ==="
need_last calendar_emit_exam_notification Q11 "$MIG"
plant "$MIG" "  IF p_kind = 'full_length_week' AND EXISTS (" "  IF false AND EXISTS (" || { bad "Q11 STALE"; exit 1; }
run "Q11 week after re-plan" "the audit's case" "$PG_SUITE"

echo "=== (12) the job's re-plan step re-plans nobody ==="
plant "$WEEKLY" '  if (candidate.outcome !== null) return "already";' '  return "already";' || { bad "Q12 STALE"; exit 1; }
run "Q12 ensureWeeklyReplan" "the job's re-plan-first step" "$PG_SUITE"

echo "=== (13) the job skips the re-plan step ==="
plant "$NOTIFY" '      row.kind === "full_length_week" &&' '      row.kind === "never" &&' || { bad "Q13 STALE"; exit 1; }
run "Q13 job asks first" "asks the weekly predicate for a week-notice student" "$UNIT_SUITE"

echo "=== (14) the 17:00 QOTD run flushes every type ==="
plant "$QOTD_JOB" '        eventType: "qotd_daily",
' "" || { bad "Q14 STALE"; exit 1; }
run "Q14 QOTD only" "the 17:00 run sends qotd_daily only" "$QOTD_SUITE"

echo "=== (15) the QOTD event is born without an expiry ==="
need_last qotd_daily_notify Q15 "$MIG"
plant "$MIG" "      ((v_today + 1)::timestamp AT TIME ZONE 'America/Chicago')" "      NULL::timestamptz" || { bad "Q15 STALE"; exit 1; }
run "Q15 QOTD expiry" "the rule's qotd_daily event expires at the end of its Chicago day" "$QOTD_SUITE"

echo "=== (16) the recipient may move their own deferral ==="
need_last notification_messages_guard_recipient_update Q16 "$MIG"
plant "$MIG" "    OR NEW.not_before           IS DISTINCT FROM OLD.not_before
" "" || { bad "Q16 STALE"; exit 1; }
run "Q16 recipient guard" "not_before is a delivery column" "$PG_SUITE"

echo "=== (17) the deletion executor runs in quiet hours ==="
plant "$ROUTES" "    if (quietHoursDeferral(new Date()) !== null) {" "    if (false) {" || { bad "Q17 STALE"; exit 1; }
run "Q17 executor guard" "01:00 CDT: skipped" "$ROUTE_SUITE"

echo
echo "QUIET-HOURS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
