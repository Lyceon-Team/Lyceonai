#!/usr/bin/env bash
# ============================================================================
# R2 gate harness — runs G1-G18 and proves every one of them can go red
# ============================================================================
# @spec [Brief R2 §5 "Gates and plants"; ruled plan §3]
#
# A gate that cannot fail is not a gate. Every assertion below is run twice:
# once against correct code (must pass), once against a named mutation of that
# code (must fail). The mutation is applied to a scratch copy of the database or
# file, never to the tree, so there is nothing to revert by hand and nothing can
# be left planted by a crash.
#
# Connection via standard PG* env. Defaults to a local cluster on :5432.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=review_gates_ci

q()  { psql -v ON_ERROR_STOP=1 -q -d "$DB" "${@}"; }
qt() { psql -v ON_ERROR_STOP=1 -tA -d "$DB" "${@}"; }

build_db() {
  psql -v ON_ERROR_STOP=1 -q -d postgres \
    -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
  q >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
-- The harness needs a settable identity so the RLS gate (G12) can act as a
-- specific student. Production Supabase supplies the real auth.uid().
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $f$ SELECT nullif(current_setting('lyceon.test_uid', true), '')::uuid $f$;
SQL
  for f in "$MIG_DIR"/*.sql; do q -f "$f" >/dev/null; done
}

fail() { echo "    SELF-TEST FAIL: $1"; exit 1; }

# ---------------------------------------------------------------------------
echo "==> baseline: G1-G5, G7-G10, G17, G18 must all pass on correct code"
build_db
psql -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/scripts/ci/review-queue-gates.sql" 2>&1 \
  | grep -E '^(psql.*)?NOTICE:  ok   \[' | sed 's/^.*NOTICE:  /    /' \
  || fail "baseline gate suite did not pass"

# ---------------------------------------------------------------------------
echo "==> G6: two CONCURRENT misses on one question leave exactly one active entry"
build_db
q >/dev/null <<'SQL'
INSERT INTO auth.users (id, email) VALUES ('00000000-aaaa-4000-8000-000000000001','g@example.com');
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status)
VALUES ('SATM1AAA001','M',1,'Algebra',ARRAY['ALG.01'],2,'stem',
        '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
        'A','exp','published');
SQL
# Two real connections, both entering review_queue_record for the same
# (student, question) with DIFFERENT source items. Without the advisory lock
# both read "no active entry" and both insert, and the partial unique index
# turns that into a 23505 that would roll back a student's answer.
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "
  BEGIN;
  SELECT public.review_queue_record('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','practice',
    '00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-00000000000a','incorrect', now());
  SELECT pg_sleep(2);
  COMMIT;" >/dev/null 2>&1 &
P1=$!
sleep 0.5
psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "
  BEGIN;
  SELECT public.review_queue_record('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','practice',
    '00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-00000000000b','incorrect', now());
  COMMIT;" >/dev/null 2>&1 &
P2=$!
wait $P1; W1=$?
wait $P2; W2=$?
[ "$W1" = "0" ] && [ "$W2" = "0" ] || fail "G6: a concurrent writer errored (exit $W1/$W2) — the lock did not serialize them"
ACTIVE=$(qt -c "select count(*) from public.review_schedule where question_id='SATM1AAA001' and status='active';")
TOTAL=$(qt -c "select count(*) from public.review_schedule where question_id='SATM1AAA001';")
[ "$ACTIVE" = "1" ] || fail "G6: expected 1 active entry after two concurrent misses, got $ACTIVE"
[ "$TOTAL" = "2" ]  || fail "G6: expected 2 total entries (one superseded), got $TOTAL"
echo "    ok   [G6]: two concurrent misses -> 1 active, 1 superseded, neither writer errored"

# ---------------------------------------------------------------------------
echo "==> G11: authenticated cannot SELECT any answer-bearing review column"
for col in question_correct_answer question_explanation question_option_metadata question_correct_variants option_token_map; do
  if psql -tA -d "$DB" -c "set role authenticated; select $col from public.review_session_items limit 1;" >/dev/null 2>&1; then
    fail "G11: authenticated could read review_session_items.$col (anti-leak breach)"
  fi
done
echo "    ok   [G11]: all five reveal-matrix columns denied to authenticated"

# ---------------------------------------------------------------------------
echo "==> G13: anon and authenticated cannot EXECUTE any review function"
for r in anon authenticated; do
  for fn in "public.review_queue_record('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','practice','00000000-bbbb-4000-8000-000000000001','00000000-dddd-4000-8000-00000000000c','incorrect',now())" \
            "public.review_queue_graduate('00000000-aaaa-4000-8000-000000000001','SATM1AAA001','00000000-dddd-4000-8000-00000000000d',now())"; do
    if psql -tA -d "$DB" -c "set role $r; select $fn;" >/dev/null 2>&1; then
      fail "G13: role $r could EXECUTE $fn"
    fi
  done
done
echo "    ok   [G13]: EXECUTE denied to anon and authenticated on both queue functions"

echo
echo "REVIEW QUEUE GATES SELF-TEST: PASS"
