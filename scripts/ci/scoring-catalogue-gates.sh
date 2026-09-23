#!/usr/bin/env bash
# ============================================================================
# Scoring catalogue gates — Doc 04B V4.3 §7.2 / §8.1 / §8.2 / §8.4 / Appendix A
# ============================================================================
# @spec [Doc-04B_V4.3, §7.2, §7.3, §8.1, §8.2, §8.4, Appendix A]
# @implemented [2026-09-23]
#
# plain English: applies the genesis pipeline to a THROWAWAY database (no prod
#   creds), then proves every catalogue constraint by making it fire:
#     C1  a real two-session race — the partial unique index, not the trigger,
#         is what stops a second concurrent activation (run here, in bash,
#         because it needs two connections);
#     C2..C9, P1, P2, G1, S1, S2, H1  scripts/ci/scoring-catalogue-gates.sql.
#   The gate passes only if EVERY expected check id prints its own `ok` line
#   and no ERROR appears. A check that errors for an unrelated reason prints no
#   `ok` and is reported red by name — it cannot pass by accident.
#
# expected outcome: "SCORING CATALOGUE GATES: PASS" and exit 0; otherwise each
#   red check is listed and the exit is 1.
#
# edge cases: C1 is deterministic, not timing-based. Session A inserts an active
#   row and holds its transaction open until it OBSERVES session B blocked on a
#   lock (pg_stat_activity), then commits. B's friendly trigger cannot see A's
#   uncommitted row, so only the unique index can refuse B — which it must do
#   with 23505 on one_active_scoring_model_version once A commits.
#
# Connection via standard PG* env, defaulting to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=scoring_catalogue_gate_ci
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

EXPECTED_IDS="P1 G1 S1 C1 C2 C3 C4 C5 C6 C7 C8 C9 S2 H1 P2"

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

echo "==> fresh DB"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

echo "==> Supabase role + auth stub"
psql_db "$DB" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL

echo "==> apply pipeline"
for f in "$MIG_DIR"/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null 2>&1 || { echo "FAIL: $f did not apply"; psql_db "$DB" -q -f "$f" 2>&1 | tail -5; exit 1; }; done

# ---------------------------------------------------------------------------
# C1 — concurrent activation race: the partial unique index is the enforcement.
# ---------------------------------------------------------------------------
echo "==> C1 two-session activation race"
PGAPPNAME=scg_c1_a psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >"$WORK/c1_a.out" 2>&1 <<'SQL' &
BEGIN;
INSERT INTO public.scoring_model_versions
  (version, formula_name, formula_doc_ref, constants_sha256, validation_packet_sha256,
   validation_packet_url, status, published_at)
VALUES ('zz_race_a', 'f', 'd', 'h', 'p', 'u', 'active', now());
DO $$
DECLARE i int := 0;
BEGIN
  -- Hold the uncommitted active row until B is observed waiting on a lock.
  WHILE NOT EXISTS (SELECT 1 FROM pg_stat_activity
                    WHERE application_name = 'scg_c1_b' AND wait_event_type = 'Lock') LOOP
    i := i + 1;
    IF i > 300 THEN RAISE EXCEPTION 'C1 setup: session B never blocked on the index'; END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
END $$;
COMMIT;
SQL
A_PID=$!

PGAPPNAME=scg_c1_b psql -X -q -v ON_ERROR_STOP=1 -d "$DB" >"$WORK/c1_b.out" 2>&1 <<'SQL' || true
DO $$
DECLARE
  i int := 0; v_raised boolean := false; v_state text; v_msg text; v_con text;
BEGIN
  -- Wait until A holds its uncommitted INSERT (RowExclusiveLock on the table).
  WHILE NOT EXISTS (SELECT 1 FROM pg_locks l JOIN pg_stat_activity a USING (pid)
                    WHERE a.application_name = 'scg_c1_a'
                      AND l.relation = 'public.scoring_model_versions'::regclass
                      AND l.mode = 'RowExclusiveLock') LOOP
    i := i + 1;
    IF i > 300 THEN RAISE EXCEPTION 'C1 setup: session A never inserted'; END IF;
    PERFORM pg_sleep(0.1);
  END LOOP;
  -- The friendly trigger sees no COMMITTED active row, so it lets this through;
  -- only the partial unique index can refuse it.
  BEGIN
    INSERT INTO public.scoring_model_versions
      (version, formula_name, formula_doc_ref, constants_sha256, validation_packet_sha256,
       validation_packet_url, status, published_at)
    VALUES ('zz_race_b', 'f', 'd', 'h', 'p', 'u', 'active', now());
  EXCEPTION WHEN OTHERS THEN
    v_raised := true;
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF NOT v_raised THEN
    RAISE EXCEPTION 'SCG FAIL [C1 single-active-race-index]: a second active version was accepted while another activation was in flight';
  END IF;
  IF v_state <> '23505' OR v_con IS DISTINCT FROM 'one_active_scoring_model_version' THEN
    RAISE EXCEPTION 'SCG FAIL [C1 single-active-race-index]: wrong error % % "%"', v_state, v_con, v_msg;
  END IF;
  RAISE NOTICE 'ok   [C1 single-active-race-index] 23505 one_active_scoring_model_version under a real race';
END $$;
SQL
wait "$A_PID" || true
cat "$WORK/c1_a.out" "$WORK/c1_b.out" > "$WORK/c1.out"
# Undo C1's committed rows (versions only; no constants reference them).
psql_db "$DB" -q -c "DELETE FROM public.scoring_model_versions WHERE version IN ('zz_race_a','zz_race_b');" >/dev/null

echo "==> C2..C9 + positives"
psql -X -d "$DB" -f "$ROOT/scripts/ci/scoring-catalogue-gates.sql" > "$WORK/sql.out" 2>&1 || true

cat "$WORK/c1.out" "$WORK/sql.out" > "$WORK/all.out"
grep -E 'ok   \[|SCG FAIL|ERROR' "$WORK/all.out" | sed 's/^psql:[^ ]* //' || true

RED=""
for id in $EXPECTED_IDS; do
  grep -qE "ok   \[$id " "$WORK/all.out" || RED="$RED $id"
done
if grep -q 'ERROR' "$WORK/all.out" && [ -z "$RED" ]; then RED=" (unattributed ERROR)"; fi

psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null

if [ -n "$RED" ]; then
  echo "SCORING CATALOGUE GATES: FAIL — red:$RED"
  exit 1
fi
echo "SCORING CATALOGUE GATES: PASS ($(echo $EXPECTED_IDS | wc -w) checks)"
