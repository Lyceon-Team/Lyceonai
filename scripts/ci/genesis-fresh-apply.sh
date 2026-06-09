#!/usr/bin/env bash
# ============================================================================
# Genesis fresh-apply gate (Doc 00 V6 §10 Phase 6; foundation-contract A.1/A.4/D.4)
# ============================================================================
# Proves, against a THROWAWAY Postgres (no prod creds), that the genesis pipeline:
#   1. applies from scratch, deterministically;
#   2. reproduces the committed expected schema (scripts/ci/genesis-schema.expected.sql);
#   3. ships RLS enabled on every table;
#   4. keeps the anti-leak hard gate — anon/authenticated cannot read questions answers.
#
# Connection via standard PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD). Defaults to a
# local cluster on :5432. The `auth` schema + roles are stubbed here because a
# non-Supabase Postgres lacks them (Supabase provides them in real environments).
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
EXPECTED="$ROOT/scripts/ci/genesis-schema.expected.sql"
DB1=genesis_ci_a
DB2=genesis_ci_b

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

stub() {  # $1 = db name — Supabase-provided roles + auth schema stub
  psql_db "$1" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
}

apply_pipeline() {  # $1 = db name — apply every migration in sorted order
  for f in "$MIG_DIR"/*.sql; do
    psql_db "$1" -q -f "$f" >/dev/null
  done
}

norm() { grep -vE '^\\(un)?restrict ' | grep -vE '^-- Dumped (from|by)'; }

echo "==> fresh DBs"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB1;" -c "DROP DATABASE IF EXISTS $DB2;" \
                 -c "CREATE DATABASE $DB1;" -c "CREATE DATABASE $DB2;" >/dev/null

echo "==> apply pipeline x2"
stub "$DB1"; apply_pipeline "$DB1"
stub "$DB2"; apply_pipeline "$DB2"

echo "==> A.1 determinism"
pg_dump -d "$DB1" --schema-only --schema=public --no-owner | norm > /tmp/_g1.sql
pg_dump -d "$DB2" --schema-only --schema=public --no-owner | norm > /tmp/_g2.sql
diff -q /tmp/_g1.sql /tmp/_g2.sql >/dev/null || { echo "FAIL: non-deterministic apply"; diff /tmp/_g1.sql /tmp/_g2.sql | head; exit 1; }
echo "    OK deterministic"

echo "==> SNAP: pipeline == committed expected schema"
if [ ! -f "$EXPECTED" ]; then echo "FAIL: expected snapshot missing ($EXPECTED)"; exit 1; fi
diff -u "$EXPECTED" /tmp/_g1.sql || { echo "FAIL: schema drift vs committed expected snapshot"; exit 1; }
echo "    OK matches expected"

echo "==> A.4 every public table has RLS enabled"
RLS_OFF=$(psql_db "$DB1" -tAc "select count(*) from pg_tables where schemaname='public' and not rowsecurity;")
[ "$RLS_OFF" = "0" ] || { echo "FAIL: $RLS_OFF public table(s) without RLS"; exit 1; }
echo "    OK all RLS-enabled"

echo "==> B.1 profiles.id -> auth.users ON DELETE RESTRICT"
DELTYPE=$(psql_db "$DB1" -tAc "select confdeltype::text from pg_constraint where conrelid='public.profiles'::regclass and contype='f' and confrelid='auth.users'::regclass;")
[ "$DELTYPE" = "r" ] || { echo "FAIL: profiles.id FK confdeltype='$DELTYPE' (expected 'r' RESTRICT)"; exit 1; }
echo "    OK RESTRICT"

echo "==> D.1 questions has correct_answer+explanation, no answer_text"
COLS=$(psql_db "$DB1" -tAc "select (count(*) filter (where column_name='correct_answer'))::text || (count(*) filter (where column_name='explanation'))::text || (count(*) filter (where column_name='answer_text'))::text from information_schema.columns where table_schema='public' and table_name='questions';")
[ "$COLS" = "110" ] || { echo "FAIL: questions answer columns = $COLS (expected 110 = correct_answer:1 explanation:1 answer_text:0)"; exit 1; }
echo "    OK"

echo "==> D.4 ANTI-LEAK: anon/authenticated CANNOT read questions answers"
for r in anon authenticated; do
  if psql_db "$DB1" -tAc "set role $r; select correct_answer from public.questions limit 1;" >/dev/null 2>&1; then
    echo "FAIL: role $r could read questions.correct_answer (anti-leak breach)"; exit 1
  fi
done
echo "    OK denied (hard gate holds)"

echo "==> cleanup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB1;" -c "DROP DATABASE IF EXISTS $DB2;" >/dev/null
echo "GENESIS FRESH-APPLY GATE: PASS"
