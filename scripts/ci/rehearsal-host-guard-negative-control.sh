#!/usr/bin/env bash
# ============================================================================
# Negative control — destructive-rehearsal target guard (audit M-10)
# ============================================================================
# Proves that setup_deletion_rehearsal_db / drop_deletion_rehearsal_db REFUSE a
# non-ephemeral PGHOST before issuing any DDL, and still ACCEPT loopback.
#
# This is a negative control, not a smoke test: it fails if the guard is removed
# or weakened. That is the whole point — the guard exists because the rehearsal
# SQL seeds fabricated rows into mastery_event_audit_log, and six such rows were
# found unattributed in prod.
#
# Asserts:
#   (A) managed-Postgres host  -> non-zero exit, REHEARSAL_TARGET_REFUSED, no DDL
#   (B) arbitrary remote host  -> non-zero exit, REHEARSAL_TARGET_REFUSED, no DDL
#   (C) managed host is refused EVEN WITH the opt-in env var set (opt-in cannot
#       name a hosted database)
#   (D) arbitrary remote host WITH the opt-in set -> accepted past the guard
#   (E) loopback -> accepted past the guard (guard is not a blanket refusal)
#
# "No DDL" is proven structurally: psql is shadowed by a stub that records any
# invocation. If the guard let execution through, the stub file appears.
#
# Requires no database. Runs anywhere bash runs.
# ============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB="$SCRIPT_DIR/lib/deletion-rehearsal-db.sh"

[ -f "$LIB" ] || { echo "FAIL: lib not found ($LIB)"; exit 1; }

TMPDIR_LOCAL="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_LOCAL"' EXIT

# psql stub: records that it was called, so any DDL attempt is detectable.
mkdir -p "$TMPDIR_LOCAL/bin"
cat > "$TMPDIR_LOCAL/bin/psql" <<'STUB'
#!/usr/bin/env bash
echo "psql-invoked" >> "$PSQL_CALL_LOG"
exit 0
STUB
chmod +x "$TMPDIR_LOCAL/bin/psql"

FAILURES=0

# Runs setup_deletion_rehearsal_db under a given PGHOST/opt-in in a subshell.
# Echoes "<exit_code>|<psql_called yes|no>" and writes stderr to $TMPDIR_LOCAL/err.
run_case() {
  local host="$1" allow="${2:-}"
  local log="$TMPDIR_LOCAL/psql_calls_$$_${RANDOM}"
  : > "$log"
  local rc
  (
    export PATH="$TMPDIR_LOCAL/bin:$PATH"
    export PSQL_CALL_LOG="$log"
    export PGHOST="$host"
    if [ -n "$allow" ]; then export LYCEON_ALLOW_DESTRUCTIVE_DB_HOST="$allow"; else unset LYCEON_ALLOW_DESTRUCTIVE_DB_HOST; fi
    # shellcheck source=scripts/ci/lib/deletion-rehearsal-db.sh
    source "$LIB"
    setup_deletion_rehearsal_db guard_negative_control_db
  ) 2> "$TMPDIR_LOCAL/err"
  rc=$?
  if [ -s "$log" ]; then echo "$rc|yes"; else echo "$rc|no"; fi
  rm -f "$log"
}

assert_refused() {
  local label="$1" host="$2" allow="${3:-}"
  local out rc called
  out="$(run_case "$host" "$allow")"
  rc="${out%%|*}"; called="${out##*|}"

  if [ "$rc" = "0" ]; then
    echo "FAIL [$label]: guard ACCEPTED '$host' (exit 0) — it must refuse"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ "$called" = "yes" ]; then
    echo "FAIL [$label]: psql was invoked for '$host' — DDL ran before/despite the guard"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if ! grep -q "REHEARSAL_TARGET_REFUSED" "$TMPDIR_LOCAL/err"; then
    echo "FAIL [$label]: refused '$host' but without the named REHEARSAL_TARGET_REFUSED error"
    echo "       stderr was: $(cat "$TMPDIR_LOCAL/err")"
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "ok   [$label]: '$host' refused, no DDL, named error"
}

assert_accepted() {
  local label="$1" host="$2" allow="${3:-}"
  local out rc called
  out="$(run_case "$host" "$allow")"
  rc="${out%%|*}"; called="${out##*|}"

  if [ "$called" != "yes" ]; then
    echo "FAIL [$label]: guard BLOCKED '$host' — it must pass (guard is not a blanket refusal)"
    echo "       stderr was: $(cat "$TMPDIR_LOCAL/err")"
    FAILURES=$((FAILURES + 1))
    return
  fi
  echo "ok   [$label]: '$host' accepted past the guard (exit $rc)"
}

echo "==> (A) managed-Postgres host, no opt-in"
assert_refused "A" "db.abcdefghijkl.supabase.co"

echo "==> (B) arbitrary remote host, no opt-in"
assert_refused "B" "prod-db.internal.example.com"

echo "==> (C) managed-Postgres host WITH opt-in — opt-in must not override"
assert_refused "C" "db.abcdefghijkl.supabase.co" "db.abcdefghijkl.supabase.co"

echo "==> (D) arbitrary remote host WITH matching opt-in"
assert_accepted "D" "ephemeral-runner-7.ci.internal" "ephemeral-runner-7.ci.internal"

echo "==> (E) loopback, no opt-in"
assert_accepted "E" "127.0.0.1"

echo
if [ "$FAILURES" -ne 0 ]; then
  echo "REHEARSAL HOST GUARD NEGATIVE CONTROL: FAIL ($FAILURES assertion(s))"
  exit 1
fi
echo "REHEARSAL HOST GUARD NEGATIVE CONTROL: PASS"
