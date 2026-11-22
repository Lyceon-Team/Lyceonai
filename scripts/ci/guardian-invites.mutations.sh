#!/usr/bin/env bash
# ============================================================================
# Mutation harness for guardian → teen invites (owner rulings 2026-11-21, counsel-approved;
# SCL-282: one planted defect per rule)
# ============================================================================
# @spec [those rulings 1, 2, 4, 5, 8; supabase/migrations/20261206000000_guardian_invites.sql;
#        card first: owner ruling 2026-11-22 (2), 20261210000000, SCL-287 (I19-I25)]
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
MIG="supabase/migrations/20261206000000_guardian_invites.sql"
# Card first (20261210000000, owner ruling 2026-11-22): the LAST definition of the issue, lookup
# and claim functions moved here, so every plant aimed at them was re-pointed in the same change
# (CLAUDE.md, "a migration that replaces a function body orphans its mutations"). cancel, the
# link writer and the rate-limit rows stay in $MIG.
CF_MIG="supabase/migrations/20261210000000_guardian_invite_card_first.sql"
JOIN="server/routes/join-routes.ts"
INVITE_ROUTES="server/routes/guardian-invite-routes.ts"
RATE="server/middleware/guardian-link-rate-limit.ts"
HOME_PAGE="client/src/features/guardian/GuardianHome.tsx"
PASS=0; FAIL=0
BACKUPS="$(mktemp -d /tmp/guardian-invites-mut.XXXX)"

FILES=("$MIG" "$CF_MIG" "$JOIN" "$INVITE_ROUTES" "$RATE" "$HOME_PAGE")
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
PG_SUITE=tests/ci/guardian-invites.pg.ci.test.ts
CALL_SUITE=tests/ci/parent-call-link.contract.test.ts

# plant_check <name> <file> <old> <new> <expected test name> <test files...>
plant_check() {
  local name="$1" file="$2" old="$3" new="$4" expect="$5"; shift 5
  plant "$file" "$old" "$new" || { bad "$name STALE"; restore; return; }
  OUT="$(ts_check "$@")"; RC=$?
  expect_red "$name" "$expect" "$OUT" "$RC"
  restore
}

# The migration a function's plants must edit: the one that defines it LAST.
mig_for() {
  case "$1" in
    issue_guardian_invite_audited|guardian_invite_lookup|claim_guardian_invite_audited|guardian_invite_has_card) echo "$CF_MIG" ;;
    *) echo "$MIG" ;;
  esac
}

# sql_plant <function> <name> <old> <new> <expected test name>
sql_plant() {
  local fn="$1"; shift
  local target; target="$(mig_for "$fn")"
  [ "$(last_definer "$fn")" = "$target" ] || { bad "$1 targets $target but $fn is last defined in $(last_definer "$fn")"; return; }
  plant_check "$1" "$target" "$2" "$3" "$4" "$PG_SUITE"
}

echo "=== (0) GREEN BASELINE ==="
OUT="$(ts_check "$CALL_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "call-link contract test green" || { bad "contract baseline not green"; echo "$OUT" | tail -30; }
if [ "$HAVE_PG" = 1 ]; then
  OUT="$(ts_check "$PG_SUITE")"; RC=$?
  [ "$RC" = 0 ] && ok "guardian invites PG suite green" || { bad "PG baseline not green"; echo "$OUT" | tail -30; }
else
  echo "  SKIP  PG baseline — no Postgres (a skip, not a pass)"
fi
if [ "$FAIL" -gt 0 ]; then echo "GUARDIAN INVITES MUTATIONS: BASELINE NOT GREEN"; exit 1; fi

if [ "$HAVE_PG" = 1 ]; then
  echo "=== the link writer and the claim (real Postgres) ==="
  sql_plant claim_guardian_invite_audited "I1 the invite's link recorded as student-initiated" \
    "              'guardian', 'guardian_invite')).id" \
    "              'student', 'student_link_code')).id" \
    "CL1 a claim creates the link as guardian-initiated"
  sql_plant claim_guardian_invite_audited "I2 a retry by the same student refused (not idempotent)" \
    "    IF v_row.claimed_by_profile_id = p_student_id THEN" \
    "    IF false THEN" \
    "CL2 the same student's retry"
  sql_plant claim_guardian_invite_audited "I3 a cancelled invite can be claimed" \
    "    RETURN jsonb_build_object('outcome', 'cancelled');" \
    "    NULL;" \
    "IN5 Cancel kills the link"
  sql_plant claim_guardian_invite_audited "I4 an expired invite can be claimed" \
    "    RETURN jsonb_build_object('outcome', 'expired');" \
    "    NULL;" \
    "TK1 what /join says in each state"
  sql_plant claim_guardian_invite_audited "I5 the claim does not lock the invite (two students race)" \
    "   WHERE token_hash = p_token_hash"$'\n'"   FOR UPDATE;" \
    "   WHERE token_hash = p_token_hash;" \
    "CL3 two students racing for one invite"
  sql_plant create_active_guardian_link_audited "I6 the mechanism guard admits anything" \
    "       OR (p_initiated_by = 'guardian' AND p_via = 'guardian_invite')) THEN" \
    "       OR true) THEN" \
    "DB4 only the two real mechanisms are accepted"
  sql_plant create_active_guardian_link_audited "I7 the link-code path's default initiator changed" \
    "  p_initiated_by text DEFAULT 'student'," \
    "  p_initiated_by text DEFAULT 'guardian'," \
    "DB3 link-code redemption is unchanged"

  echo "=== issue and cancel (real Postgres) ==="
  sql_plant issue_guardian_invite_audited "I8 the open-invite cap removed" \
    "    IF v_open >= 3 THEN"$'\n'"      RAISE EXCEPTION 'open invite limit reached' USING ERRCODE = 'LY010';"$'\n'"    END IF;"$'\n'"    INSERT" \
    "    INSERT" \
    "IN7 at most 3 open invites"
  sql_plant issue_guardian_invite_audited "I9 a resend keeps the old token working" \
    "     SET token_hash = p_token_hash,"$'\n'"         token_issued_at = now()," \
    "     SET token_issued_at = now()," \
    "IN3 Resend emails a new link"
  sql_plant cancel_guardian_invite_audited "I10 cancel ignores whose invite it is" \
    "  v_row public.guardian_invites;"$'\n'"BEGIN"$'\n'"  SELECT * INTO v_row FROM public.guardian_invites"$'\n'"   WHERE id = p_invite_id"$'\n'"     AND guardian_profile_id = p_guardian_id" \
    "  v_row public.guardian_invites;"$'\n'"BEGIN"$'\n'"  SELECT * INTO v_row FROM public.guardian_invites"$'\n'"   WHERE id = p_invite_id" \
    "IN6 another guardian cannot list, resend, copy or cancel"
  plant_check "I11 the per-address limit raised" "$MIG" \
    "'guardian_invite_email',     jsonb_build_object('limit', 3,  'window_seconds', 86400)" \
    "'guardian_invite_email',     jsonb_build_object('limit', 4,  'window_seconds', 86400)" \
    "RL1 3 emails a day per (guardian, address)" "$PG_SUITE"
  plant_check "I12 the per-guardian limit raised" "$MIG" \
    "'guardian_invite_daily',     jsonb_build_object('limit', 10, 'window_seconds', 86400)" \
    "'guardian_invite_daily',     jsonb_build_object('limit', 11, 'window_seconds', 86400)" \
    "RL2 10 links a day per guardian" "$PG_SUITE"

  echo "=== card first (real Postgres; 20261210000000) ==="
  sql_plant guardian_invite_has_card "I19 the card-saved guard removed (every invite counts as carded)" \
    "  SELECT p_row.card_saved_at IS NOT NULL AND p_row.card_payment_method_id IS NOT NULL;" \
    "  SELECT true;" \
    "CF2 sending an invite is refused until a card is saved"
  sql_plant guardian_invite_has_card "I20 the guard forgets the payment method" \
    "  SELECT p_row.card_saved_at IS NOT NULL AND p_row.card_payment_method_id IS NOT NULL;" \
    "  SELECT p_row.card_saved_at IS NOT NULL;" \
    "CF5 the guard is one definition"
  sql_plant issue_guardian_invite_audited "I21 a link re-issued for an invite with no card" \
    "  -- saved on this invite."$'\n'"  IF NOT public.guardian_invite_has_card(v_row) THEN" \
    "  -- saved on this invite."$'\n'"  IF false THEN" \
    "CF3 copying an invite's link is refused until a card is saved"
  sql_plant issue_guardian_invite_audited "I22 a new invite accepts an address" \
    "    IF p_email_hash IS NOT NULL THEN"$'\n'"      RAISE EXCEPTION 'a new invite has no saved card'" \
    "    IF false THEN"$'\n'"      RAISE EXCEPTION 'a new invite has no saved card'" \
    "CF1 starting an invite makes a draft"
  sql_plant guardian_invite_lookup "I23 /join describes an invite with no card" \
    "  -- Card first: an open invite with no saved card does not exist as far as /join is concerned."$'\n'"  IF NOT public.guardian_invite_has_card(v_row) THEN" \
    "  -- Card first: an open invite with no saved card does not exist as far as /join is concerned."$'\n'"  IF false THEN" \
    "CF4 claiming an invite is refused until a card is saved"
  sql_plant claim_guardian_invite_audited "I24 an invite with no card can be claimed" \
    "  -- Card first: an open invite with no saved card cannot be claimed (same answer as /join)."$'\n'"  IF NOT public.guardian_invite_has_card(v_row) THEN" \
    "  -- Card first: an open invite with no saved card cannot be claimed (same answer as /join)."$'\n'"  IF false THEN" \
    "CF4 claiming an invite is refused until a card is saved"
  plant_check "I25 the route maps the card refusal to a 500" "$INVITE_ROUTES" \
    "    if (err instanceof GuardianInviteCardRequiredError) {"$'\n'"      return cardRequired(res, requestId);"$'\n'"    }"$'\n'"    return failure(res, \"resend\", err, requestId);" \
    "    return failure(res, \"resend\", err, requestId);" \
    "CF2 sending an invite is refused until a card is saved" "$PG_SUITE"

  echo "=== the routes (real Postgres) ==="
  plant_check "I13 the inviting guardian's age not re-checked at claim" "$JOIN" \
    "        if (!adult.ok) {" \
    "        if (false) {" \
    "CL6 the inviting guardian's age is re-checked at claim" "$PG_SUITE"
  plant_check "I14 a guardian may claim (the student-role gate removed)" "$JOIN" \
    "  requireStudentRole,"$'\n'"  requireProfileComplete," \
    "  requireProfileComplete," \
    "CL4 only a signed-in student may claim" "$PG_SUITE"
  plant_check "I15 the raw token logged on a claim" "$JOIN" \
    "        logger.info(\"JOIN\", \"claim\", \"Invite not claimed\", {"$'\n'"          outcome: result.outcome," \
    "        logger.info(\"JOIN\", \"claim\", \"Invite not claimed\", {"$'\n'"          token,"$'\n'"          outcome: result.outcome," \
    "TK2 no log line carries a token" "$PG_SUITE"
  plant_check "I16 an invite started without the adult-guardian rule" "$INVITE_ROUTES" \
    "  if (check.ok) return false;" \
    "  if (true) return false;" \
    "IN8 denials" "$PG_SUITE"
  plant_check "I17 the per-address denial keeps the daily increment" "$RATE" \
    "      const rolled = await rollback(client, {"$'\n'"        profileId,"$'\n'"        bucketKey: buckets.daily,"$'\n'"      });" \
    "      const rolled = { ok: true, error: undefined };" \
    "RL1 3 emails a day per (guardian, address)" "$PG_SUITE"
else
  echo "  SKIP  I1-I17 (Postgres) — no Postgres (a skip, not a pass)"
fi

echo "=== book a call ==="
plant_check "I18 a placement spells the URL out instead of reading the constant" "$HOME_PAGE" \
    "          href={PARENT_CALL_URL}" \
    "          href=\"https://calendly.com/amingwa-lyceon/lyceon-for-parents-15-minute-call\"" \
    "every placement reads the constant" "$CALL_SUITE"

echo "=== RESTORED: re-check green ==="
OUT="$(ts_check "$CALL_SUITE")"; RC=$?
[ "$RC" = 0 ] && ok "green after restore" || bad "not green after restore"

echo "GUARDIAN INVITES MUTATIONS: $PASS passed, $FAIL failed"
[ "$FAIL" = 0 ] || exit 1
