#!/usr/bin/env bash
# QOTD resilience — mutation harness.
#
# @spec [owner brief "QOTD resilience (no-question state, error logging, alerting)" (Karl,
#       2026-10-09) "Tests": "each observed failing once"] | @implemented [2026-10-09]
#
# Each plant breaks ONE rule the brief locks and must turn a NAMED test red. Same rules as the
# other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — RED ON THE NAMED ASSERTION. A plant that reddens some other test is a failure.
#   RULE 3 — LAST DEFINER. A plant on a SQL function edits the migration that LAST defines it.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261030000000_qotd_resilience_alerts.sql"
HEALTH="server/services/qotd/qotd-health.ts"
JOB="server/services/qotd/qotd-email-job.ts"
ALERTS="server/lib/ops-alerts.ts"
HOME_SECTION="client/src/components/home/qotd/HomeQotdSection.tsx"
WIDGET="client/src/components/qotd/QotdWidget.tsx"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/qr-mut.XXXX)"

FILES=("$MIG" "$HEALTH" "$JOB" "$ALERTS" "$HOME_SECTION" "$WIDGET")
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
PG_SUITE=tests/ci/qotd-resilience.pg.ci.test.ts
HOME_UI=client/src/components/home/qotd/HomeQotdSection.test.tsx
WIDGET_UI=client/src/components/qotd/QotdWidget.test.tsx

if ! pg_isready -q -h "$PGHOST" -p "$PGPORT" 2>/dev/null; then
  echo "QOTD RESILIENCE MUTATIONS: no Postgres at $PGHOST:$PGPORT — the SQL plants need it (a skip is not a pass)"
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
OUT="$(check "$PG_SUITE" "$HOME_UI" "$WIDGET_UI")"; RC=$?
[ "$RC" = 0 ] && ok "suites green" || { bad "suites not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "QOTD RESILIENCE MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== (1) a horizon of 6 is accepted ==="
plant "$HEALTH" "  if (params.checks.horizon && h.horizon < QOTD_MIN_HORIZON_DAYS) {" "  if (params.checks.horizon && h.horizon < 6) {" || { bad "R1 STALE"; exit 1; }
run "R1 horizon < 7 alerts" "horizon 6 → one alert on each channel" "$PG_SUITE"

echo "=== (2) the ledger stops being once per day ==="
need_last ops_alert_claim R2 "$MIG"
plant "$MIG" "  ON CONFLICT (condition, alert_day, channel) DO NOTHING" "  ON CONFLICT (condition, alert_day, channel) DO UPDATE SET status = 'pending'" || { bad "R2 STALE"; exit 1; }
run "R2 once per condition per day" "a second failure the same day → no second alert" "$PG_SUITE"

echo "=== (3) recovery is never due ==="
need_last qotd_recovery_due R3 "$MIG"
plant "$MIG" "       AND a.created_at > COALESCE(" "       AND a.created_at < COALESCE(" || { bad "R3 STALE"; exit 1; }
run "R3 one recovery message" "then ONE recovery message" "$PG_SUITE"

echo "=== (4) the daily job never checks the horizon (the scheduler-never-ran case goes quiet) ==="
plant "$JOB" "      horizon: summary.chicago_hour >= HORIZON_CHECK_FROM_CHICAGO_HOUR," "      horizon: false," || { bad "R4 STALE"; exit 1; }
run "R4 independent check" "the scheduler never runs" "$PG_SUITE"

echo "=== (5) the 17:00 reminder runs on a day whose question was withdrawn ==="
plant "$JOB" "  if (!z.boolean().parse(servable)) {" "  if (false) {" || { bad "R5 STALE"; exit 1; }
run "R5 no reminder without a question" "a scheduled but withdrawn question is no question" "$PG_SUITE"

echo "=== (6) a schedule job throw raises no alert ==="
plant "$HEALTH" $'    await params.sendAlert({\n      condition: "qotd_schedule_failed",\n      title: "The Question of the Day schedule job failed",' $'    void ({\n      condition: "qotd_schedule_failed",\n      title: "The Question of the Day schedule job failed",' || { bad "R6 STALE"; exit 1; }
run "R6 schedule failure alerts" "schedule job failure → ERROR log and one alert" "$PG_SUITE"

echo "=== (7) a Slack failure stops the email ==="
plant "$ALERTS" $'  const mailOutcome = await guarded("email", alert, () =>\n    sendEmail(alert, deps),\n  );' $'  const mailOutcome: OpsChannelOutcome =\n    slack === "failed"\n      ? "failed"\n      : await guarded("email", alert, () => sendEmail(alert, deps));' || { bad "R7 STALE"; exit 1; }
run "R7 Slack failure still emails" "a Slack failure still sends the email" "$PG_SUITE"

echo "=== (8) an email failure stops Slack ==="
plant "$ALERTS" $'  const slack = await guarded("slack", alert, () => sendSlack(alert, deps));\n  const mailOutcome = await guarded("email", alert, () =>\n    sendEmail(alert, deps),\n  );' $'  const mailOutcome = await guarded("email", alert, () =>\n    sendEmail(alert, deps),\n  );\n  const slack: OpsChannelOutcome =\n    mailOutcome === "failed"\n      ? "failed"\n      : await guarded("slack", alert, () => sendSlack(alert, deps));' || { bad "R8 STALE"; exit 1; }
run "R8 email failure still posts" "an email failure still posts to Slack" "$PG_SUITE"

echo "=== (9) the unset-webhook warning repeats ==="
plant "$ALERTS" '  if ((await claim(deps.db, condition, "log", deps.now)) !== null) {' '  if (true) {' || { bad "R9 STALE"; exit 1; }
run "R9 one warning a day" "ONE warning a day" "$PG_SUITE"

echo "=== (10) the owner's address reaches a log line ==="
plant "$ALERTS" $'    condition: alert.condition,\n    slack,\n    mailOutcome,' $'    condition: alert.condition,\n    slack,\n    mailOutcome,\n    to: deps.emailTo,' || { bad "R10 STALE"; exit 1; }
run "R10 no address in logs" "no log line and no alert carries question content" "$PG_SUITE"

echo "=== (11) the schedule job's summary line is gone ==="
plant "$HEALTH" '  logger.info(COMPONENT, "qotd_schedule_run", "QOTD schedule run", {' '  logger.info(COMPONENT, "qotd_schedule_ran", "QOTD schedule run", {' || { bad "R11 STALE"; exit 1; }
run "R11 summary line" "and the run's summary line" "$PG_SUITE"

echo "=== (12) Home draws nothing on a no-question day ==="
plant "$HOME_SECTION" "        <NoQuestionToday />" "        null" || { bad "R12 STALE"; exit 1; }
run "R12 Home collapsed" "the card collapses to 'on its way'" "$HOME_UI"

echo "=== (13) the homepage shows the old 'not up yet' line as an error ==="
plant "$WIDGET" "    if (notYet) {" "    if (false) {" || { bad "R13 STALE"; exit 1; }
run "R13 homepage collapsed" "a day with no question collapses to 'on its way'" "$WIDGET_UI"

echo
echo "QOTD RESILIENCE MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
