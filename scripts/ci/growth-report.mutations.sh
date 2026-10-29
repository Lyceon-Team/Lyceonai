#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the Monday growth report (owner brief "One funnel for every social post",
# Karl, 2026-10-28, item 4: "Tests and planted defects")
# ============================================================================
# @spec [that brief items 3-4; supabase/migrations/20261122000000_growth_report.sql;
#   server/lib/growth-report.ts] | @implemented [2026-10-28]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared test name.
#   RULE 3 — RESTORED. Every file is put back after each plant and the suite re-checked green.
#
# SQL plants edit the migration that DEFINES the function today and are checked by the
# real-Postgres suite (which rebuilds the schema from supabase/migrations). Before each one the
# harness confirms the migration is still the function's LAST definition (CLAUDE.md, "a migration
# that replaces a function body orphans its mutations"). Without Postgres they are SKIPPED (a skip,
# not a pass).
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261122000000_growth_report.sql"
LIB="server/lib/growth-report.ts"
ROUTES="server/routes/internal-cron-routes.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/growth-report-mut.XXXX)"

FILES=("$MIG" "$LIB" "$ROUTES")
for f in "${FILES[@]}"; do mkdir -p "$BACKUPS/$(dirname "$f")"; cp "$f" "$BACKUPS/$f"; done
restore() { for f in "${FILES[@]}"; do cp "$BACKUPS/$f" "$f"; done; }
trap 'restore; rm -rf "$BACKUPS"' EXIT

ok()  { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }

# plant <file> <old> <new>  — exactly one occurrence, or STALE (exit 9).
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

expect_red() {
  if [ "$4" = 0 ]; then bad "$1: check stayed GREEN (the plant was not caught)"; return; fi
  case "$3" in
    *"$2"*) ok "$1: red on \"$2\"" ;;
    *) bad "$1: red, but not on \"$2\""; echo "$3" | tail -25 ;;
  esac
}

last_definer() { grep -ln "FUNCTION public\.$1\b" supabase/migrations/*.sql | sort | tail -1; }

HAVE_PG=0
if [ -n "${PGHOST:-}" ] && pg_isready -q -h "$PGHOST" -p "${PGPORT:-5432}" 2>/dev/null; then HAVE_PG=1; fi

ts_check() { pnpm exec vitest run "$@" 2>&1; }
CONTRACT=tests/ci/growth-report.contract.test.ts
PG_SUITE=tests/ci/growth-report.pg.ci.test.ts
NUMBERS="this week: every number from the fixture"

# plant_check <name> <file> <old> <new> <expected test name> <test files...>
plant_check() {
  local name="$1" file="$2" old="$3" new="$4" expect="$5"; shift 5
  plant "$file" "$old" "$new" || { bad "$name STALE"; restore; return; }
  OUT="$(ts_check "$@")"; RC=$?
  expect_red "$name" "$expect" "$OUT" "$RC"
  restore
}

# sql_plant <function> <name> <old> <new> <expected test name>
sql_plant() {
  local fn="$1"; shift
  [ "$(last_definer "$fn")" = "$MIG" ] || { bad "$1 targets $MIG but $fn is last defined in $(last_definer "$fn")"; return; }
  plant_check "$1" "$MIG" "$2" "$3" "$4" "$PG_SUITE"
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check "$CONTRACT")"; RC=$?
[ "$RC" = 0 ] && ok "growth report contract tests green" || { bad "contract baseline not green"; echo "$OUT" | tail -30; }
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(ts_check "$PG_SUITE")"; RC=$?
  [ "$RC" = 0 ] && ok "growth report PG suite green" || { bad "PG baseline not green"; echo "$OUT" | tail -30; }
else
  echo "  SKIP  PG baseline — no Postgres (a skip, not a pass)"
fi
if [ "$FAIL" -gt 0 ]; then echo "GROWTH REPORT MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== the numbers (real Postgres) ==="
  sql_plant growth_report_weekly "G1 under-13 students counted" \
    "         AND p.is_under_13 IS NOT TRUE"$'\n' "" "$NUMBERS"
  sql_plant growth_report_weekly "G2 guardians counted" \
    "       WHERE p.role = 'student'" "       WHERE TRUE" "$NUMBERS"
  sql_plant growth_report_weekly "G3 deleted accounts counted" \
    "         AND p.deleted_at IS NULL" "         AND TRUE" "$NUMBERS"
  sql_plant growth_report_weekly "G4 the internal-account list ignored" \
    "         AND NOT (p.id = ANY (COALESCE(p_excluded, ARRAY[]::uuid[])))" "         AND TRUE" \
    "$NUMBERS"
  sql_plant growth_report_weekly "G5 the week ends at UTC midnight, not Chicago's" \
    "    t1 := ((v_start + 7)::timestamp) AT TIME ZONE 'America/Chicago';" \
    "    t1 := ((v_start + 7)::timestamp) AT TIME ZONE 'UTC';" "$NUMBERS"
  sql_plant growth_report_week_start "G6 the reported week is the current one" \
    "  SELECT (date_trunc('week', (p_now AT TIME ZONE 'America/Chicago'))::date - 7);" \
    "  SELECT (date_trunc('week', (p_now AT TIME ZONE 'America/Chicago'))::date);" \
    "the reported week is the last complete Monday–Sunday in Chicago"
  sql_plant growth_report_weekly "G7 skips counted as answers" \
    "        FROM public.practice_session_items"$'\n'"       WHERE status = 'answered' AND answered_at >= p0" \
    "        FROM public.practice_session_items"$'\n'"       WHERE answered_at >= p0" "$NUMBERS"
  sql_plant growth_report_weekly "G8 study time uncapped" \
    "sum(LEAST(a.time_spent_ms, 300000))" "sum(a.time_spent_ms)" "$NUMBERS"
  sql_plant growth_report_weekly "G9 the 24-hour window widened" \
    "                          AND a.answered_at < s.created_at + interval '24 hours'" \
    "                          AND a.answered_at < s.created_at + interval '48 hours'" "$NUMBERS"
  sql_plant growth_report_weekly "G10 returning without the week before" \
    "      SELECT a.sid FROM active a JOIN act_prev b ON b.sid = a.sid GROUP BY a.sid" \
    "      SELECT a.sid FROM active a JOIN act_cur b ON b.sid = a.sid GROUP BY a.sid" "$NUMBERS"
  sql_plant growth_report_weekly "G11 an upgrade outside the week counted" \
    "         WHERE e.tier = 'premium' AND e.created_at >= t0 AND e.created_at < t1)" \
    "         WHERE e.tier = 'premium')" "$NUMBERS"
  sql_plant growth_report_claim "G12 the ledger lets a week post twice" \
    "  RETURN v_rows = 1;" "  RETURN true;" \
    "the ledger: claim once, a second claim refused"
  sql_plant growth_report_weekly "G13 a client role can run the report" \
    "REVOKE ALL ON FUNCTION public.growth_report_weekly(date, uuid[]) FROM PUBLIC, anon, authenticated;"$'\n' \
    "" "no client role can run the functions or read the ledger"
else
  echo "  SKIP  G1-G13 (SQL) — no Postgres (a skip, not a pass)"
fi

echo "=== the run and the route ==="
plant_check "G14 a failed post keeps its claim" "$LIB" \
  "    if (outcome !== \"posted\") await deps.release(weekStart);" \
  "    void outcome;" \
  "a Slack failure releases the week, so a re-run posts it" "$CONTRACT"
plant_check "G15 a percentage of zero" "$LIB" \
  "  if (previous === 0) return \`\${sign}\${amount}\`;"$'\n' "" \
  "shows each change; a week before of 0 gets the difference only" "$CONTRACT"
plant_check "G16 the route runs without the cron secret" "$ROUTES" \
  "  \"/growth-report\","$'\n'"  async (req: Request, res: Response): Promise<void> => {"$'\n'"    if (!cronAuthorized(req)) {" \
  "  \"/growth-report\","$'\n'"  async (req: Request, res: Response): Promise<void> => {"$'\n'"    if (req.method === \"POST\") {" \
  "without the secret: 404 and nothing runs" "$CONTRACT"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$CONTRACT")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "GROWTH REPORT MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
