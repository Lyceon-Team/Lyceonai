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
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  owner_id text
);
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

echo "==> D.4 ANTI-LEAK: anon/authenticated CANNOT read questions answer/internal cols"
for r in anon authenticated; do
  for col in correct_answer explanation option_metadata; do
    if psql_db "$DB1" -tAc "set role $r; select $col from public.questions limit 1;" >/dev/null 2>&1; then
      echo "FAIL: role $r could read questions.$col (anti-leak breach)"; exit 1
    fi
  done
done
echo "    OK denied (hard gate holds)"

echo "==> C.5 01A primitive tables have NO anon/authenticated grant"
PRIM_GRANTS=$(psql_db "$DB1" -tAc "select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and table_name in ('idempotency_records','rate_limit_ledger','abuse_score_incidents','abuse_scores','service_auth_secrets');")
[ "$PRIM_GRANTS" = "0" ] || { echo "FAIL: $PRIM_GRANTS anon/auth grant(s) on 01A primitive tables"; exit 1; }
echo "    OK service-internal"

echo "==> B.2 profile_role enum members exact"
ENUM=$(psql_db "$DB1" -tAc "select string_agg(enumlabel,',' order by enumsortorder) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='profile_role';")
[ "$ENUM" = "student,guardian,admin,tutor,teacher" ] || { echo "FAIL: profile_role = '$ENUM'"; exit 1; }
echo "    OK"

echo "==> B.3 legacy split-brain tables absent"
LEGACY=$(psql_db "$DB1" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name in ('users','accounts','account_members','lyceon_accounts','lyceon_account_members');")
[ "$LEGACY" = "0" ] || { echo "FAIL: $LEGACY legacy table(s) present"; exit 1; }
echo "    OK"

echo "==> B.7 no dead plaintext-auth columns"
DEADCOLS=$(psql_db "$DB1" -tAc "select count(*) from information_schema.columns where table_schema='public' and column_name in ('password','two_factor_secret','password_reset_token');")
[ "$DEADCOLS" = "0" ] || { echo "FAIL: $DEADCOLS dead plaintext-auth column(s)"; exit 1; }
echo "    OK"

echo "==> A1 COPPA: is_under_13 is derived at write from date_of_birth (trigger)"
COPPA=$(psql_db "$DB1" -tAc "select (count(*) filter (where tgname='profiles_set_age')) from pg_trigger where tgrelid='public.profiles'::regclass;")
[ "$COPPA" = "1" ] || { echo "FAIL: profiles_set_age trigger missing (COPPA age fields unmaintained)"; exit 1; }
echo "    OK derived-at-write"

# These mutate DATA only (after the schema-only dumps above), so they do not affect the snapshot.
echo "==> A.2 handle_new_user: an auth.users INSERT auto-creates exactly one profiles row (G1)"
psql_db "$DB1" -q -c "insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000a1','trigger-probe@example.com','{\"display_name\":\"Probe\",\"role\":\"student\"}'::jsonb);" >/dev/null
TRIG=$(psql_db "$DB1" -tAc "select count(*) from public.profiles where id='00000000-0000-0000-0000-0000000000a1' and role='student' and display_name='Probe';")
[ "$TRIG" = "1" ] || { echo "FAIL: handle_new_user did not auto-create the profiles row (got '$TRIG')"; exit 1; }
echo "    OK profile auto-created"

echo "==> A.3 handle_new_user: role is CLAMPED — only 'guardian' honored; admin/tutor/teacher -> student"
i=2
for badrole in admin tutor teacher; do
  uid="00000000-0000-0000-0000-0000000000a$i"
  psql_db "$DB1" -q -c "insert into auth.users (id, email, raw_user_meta_data) values ('$uid','clamp-$badrole@example.com','{\"role\":\"$badrole\"}'::jsonb);" >/dev/null
  GOT=$(psql_db "$DB1" -tAc "select role::text from public.profiles where id='$uid';")
  [ "$GOT" = "student" ] || { echo "FAIL: metadata role=$badrole produced role='$GOT' (expected clamped 'student')"; exit 1; }
  i=$((i+1))
done
echo "    OK elevated roles clamped to student (guardian still honored elsewhere)"

echo "==> A.5 handle_new_user: same-email second identity (linking OFF) does NOT abort the auth insert"
# First identity for the shared email -> profile created.
psql_db "$DB1" -q -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b1','collide@example.com');" >/dev/null
# Second auth user, SAME email, DIFFERENT id. With catch-all ON CONFLICT this must NOT raise 23505
# on idx_profiles_email_active (a non-catch-all ON CONFLICT (id) would, aborting GoTrue createUser).
psql_db "$DB1" -q -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2','collide@example.com');" >/dev/null
COLLIDE=$(psql_db "$DB1" -tAc "select (select count(*) from auth.users where email='collide@example.com')::text || '/' || (select count(*) from public.profiles where lower(email)='collide@example.com')::text;")
[ "$COLLIDE" = "2/1" ] || { echo "FAIL: same-email collision expected 2 auth users / 1 profile, got $COLLIDE"; exit 1; }
echo "    OK no abort; exactly one profile for the shared email (no 23505, no duplicate)"

echo "==> cleanup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB1;" -c "DROP DATABASE IF EXISTS $DB2;" >/dev/null
echo "GENESIS FRESH-APPLY GATE: PASS"
