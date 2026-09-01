#!/usr/bin/env bash
# ============================================================================
# Migration-history repair gate
# ============================================================================
# Two migrations were applied to production by running their SQL directly, so
# supabase_migrations.schema_migrations has no row for either and the next
# `supabase db push` would try to re-run them.
#
# OWNER RULING Q9 (2026-08-17): the repair itself is done with the Supabase CLI's
# `migration repair`, NOT hand-written SQL — hand-inserting means guessing the
# column shape the runner expects, and a wrong guess creates a subtler desync than
# the one being fixed. migration-history-repair.sql is therefore DELETED, and the
# literal commands live in scripts/prod-verify/MIGRATION-HISTORY-REPAIR.md.
#
# What still needs proving in CI is the two READ-ONLY files that decide whether the
# repair is safe to perform at all, because the ruling also fixed their order:
# parity FIRST, then repair. Recording "these ran successfully" before proving prod
# matches what they produce records a belief, not a fact — and the belief is
# unfalsifiable afterwards, because a version marked applied is skipped forever.
#
# Cases:
#   (R1) DRIFT DETECTED    objects present, versions unrecorded -> the audit reports
#                          REPAIR and parity reports OK. This is the state prod is
#                          actually in.
#   (R2) PARITY IS STRICT   break one of the statements a manual apply is most likely
#                          to skip — RLS on the backfill log — and parity must STOP.
#                          Without this, parity could be decorative and step 1 of
#                          the runbook would wave everything through.
#   (R3) CONSISTENT        once the versions ARE recorded, the audit flips to
#                          consistent. Proves the audit reads the history table
#                          rather than hardcoding an answer.
#   (R4) PENDING vs REPAIR objects ABSENT and unrecorded -> PENDING, not REPAIR.
#                          This is the distinction the runbook branches on: PENDING
#                          means apply it normally, REPAIR means record it without
#                          executing. Confusing them would either skip a real
#                          migration or re-run an applied one.
#
# Connection via standard PG* env. The shared lib refuses non-ephemeral hosts.
# ============================================================================
set -uo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
source "$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

AUDIT="$ROOT/scripts/prod-verify/migration-history-audit.sql"
PARITY="$ROOT/scripts/prod-verify/migration-schema-parity.sql"
RUNBOOK="$ROOT/scripts/prod-verify/MIGRATION-HISTORY-REPAIR.md"
M_BACKFILL="20260816000000_psi_occurred_at_backfill_and_seal.sql"

for f in "$AUDIT" "$PARITY" "$RUNBOOK"; do
  [ -f "$f" ] || { echo "FAIL: not found ($f)"; exit 1; }
done

# Ruling Q9 excludes hand-written history SQL. If someone re-adds it, this gate
# says so rather than letting it sit next to the runbook as a tempting shortcut.
if [ -f "$ROOT/scripts/prod-verify/migration-history-repair.sql" ]; then
  echo "FAIL [Q9]: scripts/prod-verify/migration-history-repair.sql exists again — owner ruling Q9 requires the Supabase CLI, see MIGRATION-HISTORY-REPAIR.md"
  exit 1
fi

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in mh_full mh_absent mh_named; do
    drop_deletion_rehearsal_db "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# Model the migration runner's bookkeeping table. Genesis does not create it —
# it belongs to the Supabase CLI, not to our schema — so the gate supplies it in
# the shape under test.
make_history() { # $1=db  $2=full|legacy
  if [ "$2" = "full" ]; then
    psql -q -d "$1" -c "
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (
        version text PRIMARY KEY, statements text[], name text);" >/dev/null 2>&1
  else
    psql -q -d "$1" -c "
      CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY);" >/dev/null 2>&1
  fi
}
recorded_count() {
  psql -tAq -d "$1" -c "SELECT count(*) FROM supabase_migrations.schema_migrations
                         WHERE version IN ('20260816000000','20260816010000','20260816020000',
                                           '20260817000000','20260817010000','20260817020000',
                                           '20260817030000');" 2>/dev/null
}
# Console mode: psql -c, exactly how the operator runs these files.
# NOTICEs are part of what the operator sees (the repair reports what it skipped),
# so this deliberately overrides the gate-wide client_min_messages=warning.
run_file() { PGOPTIONS='-c client_min_messages=notice' psql -d "$1" -c "$(cat "$2")" 2>&1; }
# Same, machine-readable: one pipe-separated line per audit row.
run_file_tsv() { PGOPTIONS='-c client_min_messages=notice' psql -tAq -F'|' -d "$1" -c "$(cat "$2")" 2>&1; }
# The action column the audit reports for one version.
audit_action() { run_file_tsv "$1" "$AUDIT" | awk -F'|' -v v="$2" '$1==v {print $NF; exit}'; }

# Mark all seven versions as applied the way the CLI does, so (R3) can assert the
# audit flips to consistent. This is a TEST DOUBLE for `supabase migration repair`,
# not a shipped artifact — ruling Q9 keeps the real thing in the CLI's hands.
record_applied() { # $1=db
  psql -q -d "$1" -c "
    INSERT INTO supabase_migrations.schema_migrations (version, name)
    VALUES ('20260816000000','psi_occurred_at_backfill_and_seal'),
           ('20260816010000','canonical_domain_checks'),
           ('20260816020000','mastery_derivation_gap_detection'),
           ('20260817000000','diagnostic_once_only_index'),
           ('20260817010000','student_diagnostic_state'),
           ('20260817020000','practice_session_abandoned_at'),
           ('20260817030000','student_baseline_pending')
    ON CONFLICT (version) DO NOTHING;" >/dev/null 2>&1
}

# ---------------------------------------------------------------------------
# (R1) the drift prod is actually in: objects present, versions unrecorded
# ---------------------------------------------------------------------------
echo "==> (R1) objects present + unrecorded -> audit REPAIR, parity OK"
if ! setup_genesis_db mh_full; then
  fail R1 "could not provision DB"
else
  make_history mh_full full

  for v in 20260816000000 20260816010000 20260816020000 20260817000000 \
           20260817010000 20260817020000 20260817030000; do
    a="$(audit_action mh_full "$v")"
    case "$a" in
      REPAIR*) ;;
      *) fail R1 "the audit did not report REPAIR for $v (got '$a')" ;;
    esac
  done

  PAR="$(run_file mh_full "$PARITY")"
  if ! grep -q 'OK — prod schema matches all seven migrations' <<<"$PAR"; then
    fail R1 "schema parity did not report OK on a database carrying all seven migrations
       got: $(grep -oE '(OK|STOP) —.*' <<<"$PAR" | head -1)"
  else
    pass R1 "audit reports REPAIR for both versions and parity reports OK"
  fi

  # -------------------------------------------------------------------------
  # (R2) parity is strict about the statements a manual apply skips
  #
  # Runbook step 1 is the only thing standing between a hand-applied schema and an
  # irreversible "recorded as applied". If parity waves through a missing RLS
  # statement, that step is theatre.
  # -------------------------------------------------------------------------
  echo "==> (R2) parity STOPs when a skip-prone statement is missing"
  psql -q -d mh_full -c "ALTER TABLE public.psi_occurred_at_backfill_log DISABLE ROW LEVEL SECURITY;" >/dev/null 2>&1
  BROKEN="$(run_file mh_full "$PARITY")"
  psql -q -d mh_full -c "ALTER TABLE public.psi_occurred_at_backfill_log ENABLE ROW LEVEL SECURITY;" >/dev/null 2>&1
  RESTORED="$(run_file mh_full "$PARITY")"

  if grep -q 'OK — prod schema matches all seven migrations' <<<"$BROKEN"; then
    fail R2 "parity still reported OK with RLS disabled on the backfill log — it is not checking the statements a manual apply is most likely to skip"
  elif ! grep -q 'RLS is NOT enabled' <<<"$BROKEN"; then
    fail R2 "parity STOPped but not on the RLS branch
       got: $(grep -oE '(OK|STOP) —.*' <<<"$BROKEN" | head -1)"
  elif ! grep -q 'OK — prod schema matches all seven migrations' <<<"$RESTORED"; then
    fail R2 "parity did not return to OK after RLS was restored — the check is not reading live state"
  else
    pass R2 "disabling RLS flips parity to STOP on the correct branch; restoring it returns OK"
  fi

  # -------------------------------------------------------------------------
  # (R3) once recorded, the audit says consistent
  # -------------------------------------------------------------------------
  echo "==> (R3) recorded + present -> audit consistent"
  record_applied mh_full
  for v in 20260816000000 20260816010000 20260816020000 20260817000000 \
           20260817010000 20260817020000 20260817030000; do
    a="$(audit_action mh_full "$v")"
    case "$a" in
      consistent*) pass R3 "$v reports consistent once recorded" ;;
      *) fail R3 "after recording, the audit still reports '$a' for $v" ;;
    esac
  done
fi

# ---------------------------------------------------------------------------
# (R4) PENDING vs REPAIR — the distinction the runbook branches on
#
# PENDING means "apply it normally". REPAIR means "record it without executing".
# Confusing them either skips a real migration forever or re-runs an applied one.
# ---------------------------------------------------------------------------
echo "==> (R4) objects absent + unrecorded -> PENDING, not REPAIR"
if ! setup_genesis_db mh_absent "$M_BACKFILL"; then
  fail R4 "could not provision DB at the pre-migration state"
else
  make_history mh_absent full
  for v in 20260816000000 20260816010000; do
    a="$(audit_action mh_absent "$v")"
    case "$a" in
      PENDING*) ;;
      REPAIR*) fail R4 "absent-and-unrecorded $v classified as REPAIR — the runbook would record a migration that never ran, and the runner would skip it forever" ;;
      *) fail R4 "absent-and-unrecorded $v classified as '$a', expected PENDING" ;;
    esac
  done
  # And parity must refuse here too — nothing to be consistent with.
  PAR="$(run_file mh_absent "$PARITY")"
  if grep -q 'OK — prod schema matches all seven migrations' <<<"$PAR"; then
    fail R4 "parity reported OK on a database where the migrations have not applied"
  else
    pass R4 "PENDING (not REPAIR), and parity refuses on an unapplied schema"
  fi
fi


# ---------------------------------------------------------------------------
# (R5) parity NAMES the object it is missing
# ---------------------------------------------------------------------------
# "Parity fails" is not the property that matters. An operator holding a STOP with
# no object name has to go object-hunting across seven migrations, and the most
# likely response to that is to record anyway. The verdict must say WHICH object.
#
# Each object below is dropped inside a transaction that is rolled back, so one
# provisioned database covers every case and none of them leak into the next.
echo "==> (R5) a dropped object makes parity STOP, naming that object"
if ! setup_genesis_db mh_named; then
  fail R5 "could not provision DB"
else
  make_history mh_named full
  R5_OK=1
  # drop statement                                                            | substring the verdict must contain
  while IFS='|' read -r drop expect; do
    [ -z "$drop" ] && continue
    OUT="$(PGOPTIONS='-c client_min_messages=warning' psql -tAq -d mh_named <<SQL 2>&1
BEGIN;
$drop;
$(cat "$PARITY")
ROLLBACK;
SQL
)"
    if ! grep -q 'STOP —' <<<"$OUT"; then
      fail R5 "dropping [$drop] did not make parity STOP (it may have ERRORED instead — a missing object must be a verdict, not an exception)
       got: $(echo "$OUT" | grep -E 'ERROR|OK —' | head -1 | cut -c1-120)"
      R5_OK=0
    elif ! grep -q "$expect" <<<"$OUT"; then
      fail R5 "parity STOPped for [$drop] but did not name it (expected to see '$expect')
       got: $(grep -oE 'STOP —.*' <<<"$OUT" | head -1 | cut -c1-140)"
      R5_OK=0
    fi
  done <<'CASES'
DROP INDEX public.idx_mastery_gap_ledger_observed_at|idx_mastery_gap_ledger_observed_at
DROP FUNCTION public.record_mastery_derivation_gap()|record_mastery_derivation_gap
DROP INDEX public.practice_sessions_one_completed_diagnostic_uq|practice_sessions_one_completed_diagnostic_uq
DROP VIEW public.student_baseline_pending|student_baseline_pending
ALTER TABLE public.practice_sessions DROP CONSTRAINT practice_sessions_abandoned_not_completed|practice_sessions_abandoned_not_completed
ALTER TABLE public.questions DROP CONSTRAINT questions_domain_section_canonical|questions_domain_section_canonical
REVOKE SELECT ON public.student_diagnostic_states FROM service_role|student_diagnostic_states
CASES
  [ "$R5_OK" = 1 ] && pass R5 "seven object classes each produce a STOP naming the object"
fi

# ── R6 — the runbook quotes the verdicts the SQL actually emits ─────────────
# Karl compares the console output to this doc verbatim, so a verdict string that
# drifts in the SQL and not in the doc is an operator-facing defect: it reads as a
# deviation when nothing deviated, or worse, as a match when it is not one. Caught
# for real on 2026-08-18 — the doc still said "matches both migrations" after the
# file had moved to seven.
#
# Proving mechanism: extract each literal from the SQL, require it in the doc.
# Mutation that must turn this red: edit a verdict string in
# migration-schema-parity.sql or migration-history-audit.sql without editing the
# runbook.
R6_OK=1

PARITY_OK_VERDICT="$(grep -oE "OK — prod schema matches [^']*" "$PARITY" | head -1)"
if [ -z "$PARITY_OK_VERDICT" ]; then
  fail R6 "could not extract the OK verdict from migration-schema-parity.sql"
  R6_OK=0
elif ! grep -qF "$PARITY_OK_VERDICT" "$RUNBOOK"; then
  fail R6 "the runbook does not quote the parity OK verdict verbatim
       SQL emits: $PARITY_OK_VERDICT"
  R6_OK=0
fi

while IFS= read -r verdict; do
  [ -n "$verdict" ] || continue
  if ! grep -qF "$verdict" "$RUNBOOK"; then
    fail R6 "the runbook does not quote an audit verdict verbatim
       SQL emits: $verdict"
    R6_OK=0
  fi
done < <(grep -oE "'(consistent|REPAIR|INVESTIGATE|PENDING) — [^']*'" "$AUDIT" | tr -d "'" | sort -u)

# Recording order is load-bearing (ascending), so the doc must list it that way.
EXPECTED_ORDER="20260816000000
20260816010000
20260816020000
20260817000000
20260817010000
20260817020000
20260817030000"
RUNBOOK_ORDER="$(grep -oE 'supabase migration repair --status applied [0-9]{14}' "$RUNBOOK" \
                 | awk '{print $NF}')"
if [ "$RUNBOOK_ORDER" != "$EXPECTED_ORDER" ]; then
  fail R6 "the runbook's seven repair commands are missing, extra, or out of ascending order
       got: $(echo "$RUNBOOK_ORDER" | tr '\n' ' ')"
  R6_OK=0
fi

# A verdict the SQL can no longer emit is worse than a missing one: it tells the
# operator a passing run deviated.
if grep -qE 'matches both migrations|the two migrations create' "$RUNBOOK"; then
  fail R6 "the runbook still carries two-migration verdict text the SQL cannot emit"
  R6_OK=0
fi

[ "$R6_OK" = 1 ] && pass R6 "runbook quotes every verdict the SQL emits, seven commands ascending"

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "MIGRATION HISTORY GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "MIGRATION HISTORY GATE: PASS"
