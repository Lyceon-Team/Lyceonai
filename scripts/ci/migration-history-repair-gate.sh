#!/usr/bin/env bash
# ============================================================================
# Migration-history repair gate
# ============================================================================
# Two migrations were applied to production by running their SQL directly, so
# supabase_migrations.schema_migrations has no row for either and the next
# `supabase db push` would try to re-run them. scripts/prod-verify/
# migration-history-repair.sql records them as applied without re-executing.
#
# That file makes a claim to the migration runner that can never be revisited: a
# version recorded as applied is skipped forever. If the claim is wrong the
# schema drifts permanently — strictly worse than the duplicate-apply failure it
# repairs. So the refusal path matters more than the happy path here.
#
# Cases:
#   (R1) FULL SHAPE     version + name + statements. Objects present, versions
#                       unrecorded -> both recorded, verdict OK.
#   (R2) LEGACY SHAPE   version only. Older CLI projects have no name/statements
#                       columns, and the file builds its INSERT from
#                       information_schema rather than hardcoding a column list.
#                       Same outcome, proving the adaptation is real.
#   (R3) IDEMPOTENT     running it twice records nothing the second time and
#                       still reports OK.
#   (R4) SAFETY REFUSAL objects ABSENT -> the file must REFUSE and record
#                       nothing. This is the load-bearing case: recording a
#                       version whose objects are missing silently skips the
#                       migration forever.
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

REPAIR="$ROOT/scripts/prod-verify/migration-history-repair.sql"
AUDIT="$ROOT/scripts/prod-verify/migration-history-audit.sql"
PARITY="$ROOT/scripts/prod-verify/migration-schema-parity.sql"
M_BACKFILL="20260816000000_psi_occurred_at_backfill_and_seal.sql"

for f in "$REPAIR" "$AUDIT" "$PARITY"; do
  [ -f "$f" ] || { echo "FAIL: not found ($f)"; exit 1; }
done

FAILURES=0
fail() { echo "FAIL [$1]: $2"; FAILURES=$((FAILURES + 1)); }
pass() { echo "ok   [$1]: $2"; }

cleanup() {
  for db in mh_full mh_legacy mh_absent; do
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
                         WHERE version IN ('20260816000000','20260816010000');" 2>/dev/null
}
# Console mode: psql -c, exactly how the operator runs these files.
# NOTICEs are part of what the operator sees (the repair reports what it skipped),
# so this deliberately overrides the gate-wide client_min_messages=warning.
run_file() { PGOPTIONS='-c client_min_messages=notice' psql -d "$1" -c "$(cat "$2")" 2>&1; }
# Same, machine-readable: one pipe-separated line per audit row.
run_file_tsv() { PGOPTIONS='-c client_min_messages=notice' psql -tAq -F'|' -d "$1" -c "$(cat "$2")" 2>&1; }
# The action column the audit reports for one version.
audit_action() { run_file_tsv "$1" "$AUDIT" | awk -F'|' -v v="$2" '$1==v {print $NF; exit}'; }

# ---------------------------------------------------------------------------
# (R1) full shape
# ---------------------------------------------------------------------------
echo "==> (R1) full shape (version, name, statements)"
if ! setup_genesis_db mh_full; then
  fail R1 "could not provision DB"
else
  make_history mh_full full

  # The audit must first say REPAIR — otherwise R1 proves nothing about drift.
  for v in 20260816000000 20260816010000; do
    a="$(audit_action mh_full "$v")"
    case "$a" in
      REPAIR*) ;;
      *) fail R1 "the audit did not report REPAIR for $v (got '$a')" ;;
    esac
  done

  # Parity must be OK before recording anything.
  PAR="$(run_file mh_full "$PARITY")"
  if ! grep -q 'OK — prod schema matches both migrations' <<<"$PAR"; then
    fail R1 "schema parity did not report OK on a database carrying both migrations
       got: $(grep -oE '(OK|STOP) —.*' <<<"$PAR" | head -1)"
  fi

  OUT="$(run_file mh_full "$REPAIR")"
  N="$(recorded_count mh_full)"
  if [ "${N:-x}" != "2" ]; then
    fail R1 "expected 2 recorded versions, got '${N}'
       $(head -4 <<<"$OUT")"
  elif ! grep -q 'OK — both versions recorded as applied' <<<"$OUT"; then
    fail R1 "repair did not report its OK verdict
       got: $(grep -oE '(OK|STOP) —.*' <<<"$OUT" | head -1)"
  else
    pass R1 "audit says REPAIR, parity says OK, repair records both versions"
  fi

  # -------------------------------------------------------------------------
  # (R3) idempotency
  # -------------------------------------------------------------------------
  echo "==> (R3) idempotent on a second run"
  OUT2="$(run_file mh_full "$REPAIR")"
  N2="$(recorded_count mh_full)"
  if [ "${N2:-x}" != "2" ]; then
    fail R3 "second run changed the recorded count to '${N2}'"
  elif ! grep -q 'OK — both versions recorded as applied' <<<"$OUT2"; then
    fail R3 "second run did not report OK"
  elif ! grep -q 'already recorded, leaving it alone' <<<"$OUT2"; then
    fail R3 "second run did not report skipping the already-recorded versions — it may have re-inserted"
  else
    pass R3 "re-running records nothing further and still reports OK"
  fi

  # The audit must now say the two REPAIRED versions are consistent. It is scoped
  # to those two on purpose: this CI database carries every migration including
  # 20260816020000, which is genuinely applied-but-unrecorded here, so a blanket
  # "no REPAIR anywhere" assertion would be asserting something false.
  for v in 20260816000000 20260816010000; do
    a="$(audit_action mh_full "$v")"
    case "$a" in
      consistent*) ;;
      *) fail R3 "after repair the audit still reports '$a' for $v" ;;
    esac
  done
fi

# ---------------------------------------------------------------------------
# (R2) legacy shape — version column only
# ---------------------------------------------------------------------------
echo "==> (R2) legacy shape (version only)"
if ! setup_genesis_db mh_legacy; then
  fail R2 "could not provision DB"
else
  make_history mh_legacy legacy
  OUT="$(run_file mh_legacy "$REPAIR")"
  N="$(recorded_count mh_legacy)"
  if [ "${N:-x}" != "2" ]; then
    fail R2 "expected 2 recorded versions on the legacy shape, got '${N}' — the dynamic column list did not adapt
       $(head -4 <<<"$OUT")"
  elif ! grep -q 'OK — both versions recorded as applied' <<<"$OUT"; then
    fail R2 "repair did not report OK on the legacy shape"
  else
    pass R2 "adapts to a version-only history table"
  fi
fi

# ---------------------------------------------------------------------------
# (R4) SAFETY — refuse when the objects are absent
# ---------------------------------------------------------------------------
echo "==> (R4) refuses to record a version whose objects are missing"
if ! setup_genesis_db mh_absent "$M_BACKFILL"; then
  fail R4 "could not provision DB at the pre-migration state"
else
  make_history mh_absent full
  OUT="$(run_file mh_absent "$REPAIR")"
  N="$(recorded_count mh_absent)"
  if [ "${N:-x}" != "0" ]; then
    fail R4 "recorded ${N} version(s) despite the objects being absent — a version recorded here is skipped by the runner FOREVER"
  elif ! grep -q 'refusing to record' <<<"$OUT"; then
    fail R4 "did not emit the refusal message
       got: $(head -3 <<<"$OUT")"
  else
    pass R4 "refuses and records nothing when the objects are not present"
  fi

  # The audit must classify this as PENDING, not REPAIR.
  for v in 20260816000000 20260816010000; do
    a="$(audit_action mh_absent "$v")"
    case "$a" in
      PENDING*) ;;
      *) fail R4 "the audit classified absent-and-unrecorded $v as '$a', expected PENDING" ;;
    esac
  done
fi

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "MIGRATION HISTORY REPAIR GATE: FAIL ($FAILURES case(s))"
  exit 1
fi
echo "MIGRATION HISTORY REPAIR GATE: PASS"
