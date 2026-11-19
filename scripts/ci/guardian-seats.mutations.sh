#!/usr/bin/env bash
# ============================================================================
# Mutation harness for parent paid seats (owner brief "Parent paid seat + teen invite +
# book-a-call — build", Karl, 2026-11-19, §6: one planted defect per rule)
# ============================================================================
# @spec [that brief §1-§4, §6; supabase/migrations/20261205000000_guardian_seats.sql]
#       | @implemented [2026-11-19]
#
# Each mutation plants a defect, runs the check that guards it, and requires that check to go
# RED on a NAMED assertion. Same three rules as the other *.mutations.sh harnesses:
#   RULE 1 — APPLIED. An anchor not found exactly once is STALE: a hard failure, never a pass.
#   RULE 2 — NAMED RED. The check must fail AND its output must contain the declared test name.
#   RULE 3 — RESTORED. Every file is put back after each plant and the suite re-checked green.
#
# SQL plants edit the migration that DEFINES each function today and are checked by the
# real-Postgres suite (which rebuilds the schema from supabase/migrations). Before each one the
# harness confirms that migration is still the function's LAST definition (CLAUDE.md, "a
# migration that replaces a function body orphans its mutations"). Without Postgres they are
# SKIPPED (a skip, not a pass).
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261205000000_guardian_seats.sql"
JOIN="server/routes/seat-join-routes.ts"
SEAT_ROUTES="server/routes/guardian-seat-routes.ts"
BILLING="server/routes/billing-routes.ts"
WEBHOOK="server/lib/stripe/webhook-handler.ts"
HOME_PAGE="client/src/features/guardian/GuardianHome.tsx"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/guardian-seats-mut.XXXX)"

FILES=("$MIG" "$JOIN" "$SEAT_ROUTES" "$BILLING" "$WEBHOOK" "$HOME_PAGE")
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
PG_SUITE=tests/ci/guardian-seats.pg.ci.test.ts
WEBHOOK_SUITE=tests/ci/guardian-seat-webhook.contract.test.ts
CALL_SUITE=tests/ci/parent-call-link.contract.test.ts

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
OUT="$(ts_check "$WEBHOOK_SUITE" "$CALL_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "webhook + call-link contract tests green" || { bad "contract baseline not green"; echo "$OUT" | tail -30; }
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(ts_check "$PG_SUITE")"; RC=$?
  [ "$RC" = 0 ] && ok "guardian seats PG suite green" || { bad "PG baseline not green"; echo "$OUT" | tail -30; }
else
  echo "  SKIP  PG baseline — no Postgres (a skip, not a pass)"
fi
if [ "$FAIL" -gt 0 ]; then echo "GUARDIAN SEATS MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== the claim (real Postgres) ==="
  sql_plant guardian_seat_claim "S1 the seat link recorded as student-initiated" \
    "              'guardian', 'guardian_seat_invite')).id" \
    "              'student', 'guardian_seat_invite')).id" \
    "CL1 one transaction"
  sql_plant guardian_seat_claim "S2 a retry by the same student refused (not idempotent)" \
    "  IF v_seat.status = 'claimed' AND v_seat.student_profile_id = p_student_id THEN" \
    "  IF false THEN" \
    "CL2 idempotent"
  sql_plant guardian_seat_claim "S3 an already-paid student claims the seat" \
    "  IF public.entitlement_active(p_student_id) THEN" \
    "  IF false THEN" \
    "CL3 a student who already has Pro"
  sql_plant guardian_seat_claim "S4 an expired invite can be claimed" \
    "  IF v_seat.status <> 'unassigned' OR v_seat.invite_expires_at <= now() THEN" \
    "  IF v_seat.status <> 'unassigned' THEN" \
    "TK1 expired, cancelled, used, unknown and malformed tokens"
  sql_plant guardian_seat_invite_valid "S5 an expired invite reported valid" \
    "       AND invite_expires_at > now()"$'\n' \
    "" \
    "TK1 expired, cancelled, used, unknown and malformed tokens"
  sql_plant guardian_seat_cancel_invite "S6 cancel leaves the link working" \
    "     SET invite_token_hash = NULL,"$'\n'"         invite_expires_at = NULL,"$'\n'"         invite_email = NULL,"$'\n'"         updated_at = now()"$'\n'"   WHERE id = p_seat_id" \
    "     SET invite_email = NULL,"$'\n'"         updated_at = now()"$'\n'"   WHERE id = p_seat_id" \
    "IN4 cancel"
  sql_plant guardian_seat_record "S7 the webhook records a seat twice" \
    "  ON CONFLICT ON CONSTRAINT guardian_seats_subscription_key DO NOTHING;" \
    "  ;" \
    "DB1 the webhook's record is once per subscription"
  plant_check "S8 the per-address limit raised" "$MIG" \
    "'guardian_seat_invite_email', jsonb_build_object('limit', 3,  'window_seconds', 86400)" \
    "'guardian_seat_invite_email', jsonb_build_object('limit', 4,  'window_seconds', 86400)" \
    "RL1 3 sends a day to one address" "$PG_SUITE"
  plant_check "S9 the per-guardian limit raised" "$MIG" \
    "'guardian_seat_invite_daily', jsonb_build_object('limit', 10, 'window_seconds', 86400)" \
    "'guardian_seat_invite_daily', jsonb_build_object('limit', 11, 'window_seconds', 86400)" \
    "RL2 10 sends a day per guardian" "$PG_SUITE"

  echo "=== the routes (real Postgres) ==="
  plant_check "S10 the raw token logged on a claim" "$JOIN" \
    "        logger.info(\"SEAT_JOIN\", \"claim\", \"Seat not claimed\", {"$'\n'"          outcome: result.outcome," \
    "        logger.info(\"SEAT_JOIN\", \"claim\", \"Seat not claimed\", {"$'\n'"          token: token.data,"$'\n'"          outcome: result.outcome," \
    "TK2 the raw token and the address are never logged" "$PG_SUITE"
  plant_check "S11 the under-13 link gate put on the claim" "$JOIN" \
    "  requireStudentRole,"$'\n'"  requireProfileComplete," \
    "  requireStudentRole,"$'\n'"  requireProfileComplete,"$'\n'"  requireGuardianLinkForUnder13," \
    "CL5 an under-13 student claims" "$PG_SUITE"
  plant_check "S12 the invite email sent without the rate limit" "$SEAT_ROUTES" \
    "      await applyGuardianSeatInviteRateLimit(" \
    "      false && await applyGuardianSeatInviteRateLimit(" \
    "RL1 3 sends a day to one address" "$PG_SUITE"
  plant_check "S13 seat checkout without the Parent/Guardian Terms" "$BILLING" \
    "  if (!input.termsAccepted) {" \
    "  if (false) {" \
    "CK3 refusals before any Stripe object" "$PG_SUITE"
  plant_check "S14 seat checkout without the 18+ rule" "$BILLING" \
    "  if (ageRefusal) {"$'\n'"    return {"$'\n'"      status: 403," \
    "  if (false) {"$'\n'"    return {"$'\n'"      status: 403," \
    "CK4 the 18+ rule" "$PG_SUITE"
  plant_check "S15 a seat session without its purchase kind" "$BILLING" \
    "          purchase_kind: GUARDIAN_SEAT_PURCHASE_KIND," \
    "" \
    "CK1 a guardian with no linked student gets one seat session" "$PG_SUITE"
else
  echo "  SKIP  S1-S15 (Postgres) — no Postgres (a skip, not a pass)"
fi

echo "=== the webhook ==="
plant_check "S16 an unclaimed seat written as an entitlement" "$WEBHOOK" \
    "    if (seat === \"unclaimed\") {" \
    "    if (seat === \"unclaimed\" && false) {" \
    "W1 a paid seat is recorded, and no entitlement is written" "$WEBHOOK_SUITE"
plant_check "S17 an unpaid seat recorded" "$WEBHOOK" \
    "  \"past_due\","$'\n'"]);" \
    "  \"past_due\","$'\n'"  \"incomplete\","$'\n'"]);" \
    "W5 a seat that is not yet paid records nothing" "$WEBHOOK_SUITE"

echo "=== book a call ==="
plant_check "S18 a placement spells the URL out instead of reading the constant" "$HOME_PAGE" \
    "          href={PARENT_CALL_URL}" \
    "          href=\"https://calendly.com/amingwa-lyceon/lyceon-for-parents-15-minute-call\"" \
    "is the brief's URL, defined once" "$CALL_SUITE"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$WEBHOOK_SUITE" "$CALL_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "GUARDIAN SEATS MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
