#!/usr/bin/env bash
# ============================================================================
# Mutation harness for the card on file on a guardian invite (owner ruling 2026-11-21 3,
# counsel-approved; SCL-286: one planted defect per rule)
# ============================================================================
# @spec [that ruling; supabase/migrations/20261207000000_guardian_invite_card.sql]
#       | @implemented [2026-11-22]
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
# migration that replaces a function body orphans its mutations"). Without Postgres they, and
# every route plant (the routes run against the real database), are SKIPPED (a skip, not a pass).
#
# Output is captured into a variable and matched with `case`, never piped to `grep -q`.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
MIG="supabase/migrations/20261207000000_guardian_invite_card.sql"
CARD="server/lib/guardian-invite-card.ts"
JOIN="server/routes/join-routes.ts"
INVITE_ROUTES="server/routes/guardian-invite-routes.ts"
WEBHOOK="server/lib/stripe/webhook-handler.ts"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/guardian-invite-card-mut.XXXX)"

FILES=("$MIG" "$CARD" "$JOIN" "$INVITE_ROUTES" "$WEBHOOK")
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

# The migration that last CREATEs the function (a COMMENT ON FUNCTION is not a definition).
last_definer() {
  grep -lE "CREATE (OR REPLACE )?FUNCTION public\.$1\(" supabase/migrations/*.sql | sort | tail -1
}

HAVE_PG=0
if [ -n "${PGHOST:-}" ] && pg_isready -q -h "$PGHOST" -p "${PGPORT:-5432}" 2>/dev/null; then HAVE_PG=1; fi

ts_check() { pnpm exec vitest run "$@" 2>&1; }
PG_SUITE=tests/ci/guardian-invite-card.pg.ci.test.ts

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
if [ "$HAVE_PG" != 1 ]; then
  echo "  SKIP  every plant: no Postgres (a skip, not a pass)"
  echo "GUARDIAN INVITE CARD MUTATIONS: SKIPPED"
  exit 0
fi
OUT="$(ts_check "$PG_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "card PG suite green" || { bad "PG baseline not green"; echo "$OUT" | tail -30; }
if [ "$FAIL" -gt 0 ]; then echo "GUARDIAN INVITE CARD MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

echo "=== the guard: no charge without an active link, exactly once (real Postgres) ==="
sql_plant begin_guardian_invite_charge_audited "C1 a charge begins without an active link" \
  "       AND l.status = 'active'"$'\n' \
  "" \
  "CH6 no active link, no charge"
sql_plant begin_guardian_invite_charge_audited "C2 a charge begins for a student who did not claim" \
  "     OR v_row.claimed_by_profile_id IS DISTINCT FROM p_student_id THEN" \
  "     OR false THEN" \
  "CH6 no active link, no charge"
sql_plant begin_guardian_invite_charge_audited "C3 a second claim begins a second charge" \
  "  IF v_row.charge_status <> 'card_saved' THEN" \
  "  IF v_row.charge_status NOT IN ('card_saved', 'charging', 'charged') THEN" \
  "CH2 two concurrent claims make exactly one subscription"
sql_plant record_guardian_invite_card_audited "C4 an older setup session overwrites the current one" \
  "  IF v_row.card_setup_session_id IS DISTINCT FROM p_session_id THEN" \
  "  IF false THEN" \
  "WH3 a stale session"

echo "=== the charge (real Postgres) ==="
plant_check "C5 the subscription is created on-session" "$CARD" \
  "        off_session: true," \
  "        off_session: false," \
  "CH1 save card" "$PG_SUITE"
plant_check "C6 a failed charge leaves an incomplete subscription behind" "$CARD" \
  "        payment_behavior: \"error_if_incomplete\"," \
  "        payment_behavior: \"default_incomplete\"," \
  "CH1 save card" "$PG_SUITE"
plant_check "C7 the idempotency key is not the invite's" "$CARD" \
  "  return \`guardian-invite-charge:\${inviteId}\`;" \
  "  return \`guardian-invite-charge:\${inviteId}:\${Date.now()}\`;" \
  "CH8 an interrupted charge is released and retried under the SAME idempotency key" "$PG_SUITE"
plant_check "C8 a declined card is treated as an outage (no email, retried)" "$CARD" \
  "  const isCardFailure = e.type === \"StripeCardError\" || e.statusCode === 402;" \
  "  const isCardFailure = false;" \
  "CH3 a declined card" "$PG_SUITE"
plant_check "C9 an already-funded teen is charged again" "$CARD" \
  "      aSubscriptionAlreadyFundsStudent(scan.subscriptions, studentProfileId));" \
  "      false);" \
  "CH5 the teen is already funded" "$PG_SUITE"
plant_check "C10 an ineligible billing country is charged" "$CARD" \
  "  if (verdict.verdict !== \"eligible\") {" \
  "  if (false) {" \
  "CH9 an ineligible billing country is not charged" "$PG_SUITE"
plant_check "C11 the claim never charges the saved card" "$JOIN" \
  "      await chargeGuardianInviteOnClaim({" \
  "      await (async (_input: unknown) => undefined)({" \
  "CH1 save card" "$PG_SUITE"

echo "=== saving the card (real Postgres) ==="
plant_check "C12 a setup session is not recorded (falls through to fulfilment)" "$WEBHOOK" \
  "    if (session.mode === \"setup\") {" \
  "    if (false) {" \
  "WH1 a completed setup session records the card" "$PG_SUITE"
plant_check "C13 a linked guardian is sent to Stripe before the SQL refuses" "$INVITE_ROUTES" \
  "    if ((await getAllGuardianStudentLinks(guardianId)).length > 0) {" \
  "    if (false) {" \
  "SV4 a guardian with an active link pays through today's checkout" "$PG_SUITE"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$PG_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "GUARDIAN INVITE CARD MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
