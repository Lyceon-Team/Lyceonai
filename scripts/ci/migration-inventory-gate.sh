#!/usr/bin/env bash
# ============================================================================
# MIGRATION INVENTORY GATE — does the classifier actually DISCRIMINATE?
# ============================================================================
# scripts/prod-verify/migration-inventory-classify.sql decides, per migration
# file, whether prod already has it (repair) or genuinely does not (push).
# Guessing wrong in either direction is damaging, so the file is only worth
# anything if it can tell the two states apart. A probe that returns the same
# answer for both is not evidence — it is a coin flip with a verdict column.
#
# This gate provisions the two states and requires opposite answers:
#
#   I1  RECORDED BASELINE (genesis + the 16 migrations through 20260624020000 —
#       exactly what schema_migrations claims for prod, and nothing more).
#       No row may classify APPLIED-UNRECORDED. Any that does is a probe
#       satisfied by something other than its own migration.
#   I2  FULL (every migration in the working tree applied). Every row must
#       classify APPLIED-UNRECORDED except the documented non-classifiable set.
#   I3  MUTATION. Drop one object at a time inside a rolled-back transaction;
#       that file's row must flip to NOT-APPLIED, and no other row may move.
#
# I1 also proves the parse-safety property: the classifier reads two tables'
# rows, and both must come from RECORDED migrations. If a probe ever reaches
# into a table an unrecorded migration creates, I1 does not fail — it ERRORS,
# which is why the case checks for a row count and not just for absence.
#
# Both false positives this gate has caught so far are recorded in the header of
# the SQL file: pg_roles being cluster-global, and 20260809000000 declaring only
# objects that genesis already creates.
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

CLASSIFY="$ROOT/scripts/prod-verify/migration-inventory-classify.sql"
[ -f "$CLASSIFY" ] || { echo "FAIL: not found ($CLASSIFY)"; exit 1; }

# The first UNRECORDED version. Everything strictly below it is what prod's
# schema_migrations already claims.
FIRST_UNRECORDED="20260625000000_"

# Rows that do not classify APPLIED/NOT-APPLIED, and why. Kept here as well as in
# the SQL so that a new one appearing silently is a gate failure, not quiet drift.
#   SUPERSEDED  nothing of the migration survives to probe; the probe is its
#               SUCCESSOR's, so the row reads SUPERSEDED when the successor is
#               present and UNKNOWN when it is not. I4 proves both directions.
#   INERT       every declared object already exists in genesis and every
#               statement is IF NOT EXISTS, so repair and push converge.
SUPERSEDED='20260627030000|practice_select_pool_random
20260722000000|practice_pool_passage_col'
INERT='20260809000000|entitlements_profile_id_unique_and_webhook_events'

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in mi_base mi_full; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# classify <db> -> "version|file|classification" per row
classify() {
  PGOPTIONS='-c client_min_messages=warning' \
    psql -tAq -F'|' -d "$1" -f "$CLASSIFY" 2>&1 \
    | awk -F'|' 'NF>=8 {print $1 "|" $2 "|" $7}'
}

# ── I1 — the recorded baseline: nothing may look applied ────────────────────
echo "==> (I1) recorded baseline — no row may classify APPLIED-UNRECORDED"
if ! setup_genesis_db mi_base "$FIRST_UNRECORDED"; then
  fail I1 "could not provision the baseline DB"
else
  BASE="$(classify mi_base)"
  ROWS="$(grep -c . <<<"$BASE")"
  if [ "$ROWS" -lt 30 ]; then
    fail I1 "the classifier returned $ROWS rows against the baseline — it ERRORED rather than reporting.
       A probe that reads a table an UNRECORDED migration creates is a PARSE error, not a NULL.
       got: $(head -3 <<<"$BASE")"
  else
    BAD="$(grep 'APPLIED-UNRECORDED' <<<"$BASE")"
    if [ -n "$BAD" ]; then
      fail I1 "these rows claim APPLIED against a database the migration never touched —
       the discriminator is satisfied by something other than its own migration:
$(sed 's/^/         /' <<<"$BAD")"
    else
      # The superseded rows probe their SUCCESSOR. With nothing applied the
      # successor is absent too, so they must say so rather than claim skippable.
      SUP_BAD=0
      while IFS='|' read -r ver file; do
        [ -z "$ver" ] && continue
        got="$(awk -F'|' -v v="$ver" '$1==v {print $3}' <<<"$BASE")"
        case "$got" in
          UNKNOWN*) : ;;
          *) fail I1 "$ver must report UNKNOWN at the baseline (its successor is not
       applied either, so nothing proves supersession) — got '$got'"; SUP_BAD=1 ;;
        esac
      done <<<"$SUPERSEDED"
      [ "$SUP_BAD" = 0 ] && pass I1 "$ROWS rows, none APPLIED-UNRECORDED, both superseded rows UNKNOWN"
    fi
  fi
fi

# ── I2 — everything applied: every classifiable row must say so ─────────────
echo "==> (I2) full apply — every classifiable row must be APPLIED-UNRECORDED"
if ! setup_genesis_db mi_full; then
  fail I2 "could not provision the full DB"
else
  FULL="$(classify mi_full)"
  I2_OK=1
  while IFS='|' read -r ver file cls; do
    [ -z "$ver" ] && continue
    key="$ver|$file"
    if grep -qxF "$key" <<<"$SUPERSEDED"; then
      if [ "$cls" != "SUPERSEDED (successor verified)" ]; then
        fail I2 "$key should read SUPERSEDED once its successor is applied, got '$cls'"
        I2_OK=0
      fi
    elif grep -qxF "$key" <<<"$INERT"; then
      case "$cls" in
        INERT*) : ;;
        *) fail I2 "$key is documented INERT but reported '$cls'"; I2_OK=0 ;;
      esac
    elif [ "$cls" != "APPLIED-UNRECORDED" ]; then
      fail I2 "$key was applied by this build but reported '$cls'"; I2_OK=0
    fi
  done <<<"$FULL"
  [ "$I2_OK" = 1 ] && pass I2 "$(grep -c . <<<"$FULL") rows classified as expected"
fi

# ── I3 — mutation: drop the object, the row must flip, nothing else moves ───
# One object per evidence kind the classifier uses, so a regression in any kind
# is caught rather than only in the easy table-presence ones. Each drop runs in
# a transaction that is rolled back, so one database covers every case.
#
# The last two rows are the same migration twice: deleting all five of its config
# rows must read NOT-APPLIED, deleting ONE must read PARTIAL. A row-count probe
# that collapses those two into one answer would call a half-deleted table
# "never applied" and invite a push that re-inserts over live rows.
echo "==> (I3) dropping an object flips exactly that row to NOT-APPLIED"
if [ -z "${FULL:-}" ]; then
  fail I3 "skipped — the full DB was not provisioned"
else
  BEFORE="$FULL"
  I3_OK=1
  while IFS='|' read -r drop target expect_cls; do
    [ -z "$drop" ] && continue
    RAW="$(PGOPTIONS='-c client_min_messages=warning' psql -tAq -F'|' -d mi_full <<SQL 2>&1
BEGIN;
$drop;
$(cat "$CLASSIFY")
ROLLBACK;
SQL
)"
    AFTER="$(awk -F'|' 'NF>=8 {print $1 "|" $2 "|" $7}' <<<"$RAW")"
    if [ "$(grep -c . <<<"$AFTER")" -lt 30 ]; then
      fail I3 "dropping [$drop] made the classifier ERROR instead of reporting
       got: $(head -2 <<<"$AFTER")"
      I3_OK=0
      continue
    fi
    MOVED="$(diff <(echo "$BEFORE") <(echo "$AFTER") | grep '^>' | sed 's/^> //')"
    HITS="$(grep -c . <<<"$MOVED")"
    if [ -z "$MOVED" ]; then
      fail I3 "dropping [$drop] changed NOTHING — the probe for $target does not depend on it"
      I3_OK=0
    elif [ "$HITS" -ne 1 ]; then
      fail I3 "dropping [$drop] moved $HITS rows; a discriminator must be specific to one migration:
$(sed 's/^/         /' <<<"$MOVED")"
      I3_OK=0
    elif ! grep -q "$target" <<<"$MOVED"; then
      fail I3 "dropping [$drop] moved the wrong row (expected $target)
       got: $MOVED"
      I3_OK=0
    elif ! grep -q "$expect_cls" <<<"$MOVED"; then
      fail I3 "dropping [$drop] moved $target but not to $expect_cls
       got: $MOVED"
      I3_OK=0
    fi
  done <<'CASES'
DROP FUNCTION public.backfill_recompute_student(uuid, timestamptz)|05d_backfill_recompute|NOT-APPLIED
DROP TABLE public.anonymized_actors CASCADE|05e_actor_id_substrate|NOT-APPLIED
ALTER TABLE public.practice_sessions ALTER COLUMN actor_id DROP NOT NULL|05e_actor_id_backfill_seal|NOT-APPLIED
DELETE FROM public.practice_runtime_config WHERE key = 'answer_rate_limit_max'|verticalA_config_updates|NOT-APPLIED
DROP INDEX public.idx_baseline_once_per_student_section|snapshot_kind_baseline|NOT-APPLIED
DROP POLICY tutor_injection_log_select_own ON public.tutor_injection_log|tutor_schema_proof_fixes|NOT-APPLIED
ALTER FUNCTION public.select_diagnostic_pool(integer, text[]) SECURITY DEFINER|diagnostic_pool_plain_invoker|NOT-APPLIED
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_actor_profile_id_fkey FOREIGN KEY (actor_profile_id) REFERENCES public.profiles(id)|05d_account_deletion_cascade|NOT-APPLIED
DELETE FROM public.tutor_context_runtime_config WHERE key IN ('study_context_freshness_days','teaching_profile_freshness_days','recent_learning_pattern_freshness_days','observation_promotion_threshold','friction_long_pause_seconds')|ws_l2_context_config_keys|NOT-APPLIED
DELETE FROM public.tutor_context_runtime_config WHERE key = 'friction_long_pause_seconds'|ws_l2_context_config_keys|PARTIAL
CASES
  [ "$I3_OK" = 1 ] && pass I3 "each dropped object flips exactly its own row"
fi

# ── I4 — supersession is only recordable while the successor is present ────
# The owner rule of 2026-08-18 has two halves: a later migration fully replaces
# the objects, AND that replacement is verified present. A probe that asserted
# only the first half would record an unapplied migration on the strength of a
# claim about the repo rather than a fact about the database. Removing the
# successor's own marker must therefore withdraw the REPAIR verdict.
echo "==> (I4) removing the successor withdraws the SUPERSEDED verdict"
if [ -z "${FULL:-}" ]; then
  fail I4 "skipped — the full DB was not provisioned"
else
  RAW4="$(PGOPTIONS='-c client_min_messages=warning' psql -tAq -F'|' -d mi_full <<SQL 2>&1
BEGIN;
ALTER TABLE public.practice_session_items DROP COLUMN question_assets;
$(cat "$CLASSIFY")
ROLLBACK;
SQL
)"
  AFTER4="$(awk -F'|' 'NF>=8 {print $1 "|" $2 "|" $7 "|" $8}' <<<"$RAW4")"
  I4_OK=1
  if [ "$(grep -c . <<<"$AFTER4")" -lt 30 ]; then
    fail I4 "the classifier ERRORED instead of reporting
       got: $(head -2 <<<"$RAW4")"
    I4_OK=0
  else
    while IFS='|' read -r ver file; do
      [ -z "$ver" ] && continue
      row="$(grep "^$ver|" <<<"$AFTER4")"
      if ! grep -q 'UNKNOWN' <<<"$row"; then
        fail I4 "$ver still claims supersession with its successor removed
       got: $row"
        I4_OK=0
      elif ! grep -q 'STOP —' <<<"$row"; then
        fail I4 "$ver went UNKNOWN but its verdict is not a STOP
       got: $row"
        I4_OK=0
      fi
    done <<<"$SUPERSEDED"
  fi
  [ "$I4_OK" = 1 ] && pass I4 "both superseded rows STOP when the successor is gone"
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "MIGRATION INVENTORY GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "MIGRATION INVENTORY GATE: PASS"
