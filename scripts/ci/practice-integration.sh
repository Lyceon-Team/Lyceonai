#!/usr/bin/env bash
# ============================================================================
# Practice engine integration gate (Doc-02B_V4 §14/§20; Coding Standards §9)
# ============================================================================
# Proves, against a THROWAWAY Postgres (no prod creds), that the practice
# pipeline end-to-end works:
#   1. Seed published questions (real 'M'/'Algebra' Algebra questions)
#   2. select_practice_pool_random returns non-zero rows
#   3. Returned rows reconstruct (stem, options, section, domain present)
#   4. Anti-leak: correct_answer and explanation ARE returned by the RPC
#      (they exist in the pool; the server strips them — this gate proves
#       the RPC itself includes them so the server CAN strip them)
#   5. Config doctrine: quota RPC rejects when config keys are missing
#   6. Config doctrine: quota RPC succeeds when config keys are seeded
#
# Connection via standard PG* env. The `auth` schema + roles are stubbed
# because a non-Supabase Postgres lacks them.
set -euo pipefail

export PGHOST="${PGHOST:-localhost}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
DB=practice_ci

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }

stub() {
  psql_db "$1" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
}

apply_pipeline() {
  for f in "$MIG_DIR"/*.sql; do
    psql_db "$1" -q -f "$f" >/dev/null
  done
}

echo "==> fresh DB"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null

echo "==> apply migrations"
stub "$DB"
apply_pipeline "$DB"

# ---------------------------------------------------------------------------
# Seed: real published questions with canonical IDs
# ---------------------------------------------------------------------------
echo "==> seed questions"
psql_db "$DB" >/dev/null <<'SQL'
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status, published_at)
VALUES
  ('SATM1AAAA01', 'M', 1, 'Algebra', ARRAY['ALG.01'], 1,
   'If 2x + 3 = 7, what is x?',
   '[{"token":"A","text":"1"},{"token":"B","text":"2"},{"token":"C","text":"3"},{"token":"D","text":"4"}]'::jsonb,
   'B', 'Subtract 3 from both sides: 2x = 4, divide by 2: x = 2.', 'published', now()),
  ('SATM1AAAA02', 'M', 1, 'Algebra', ARRAY['ALG.01','ALG.02'], 2,
   'What is the slope of y = 3x - 5?',
   '[{"token":"A","text":"3"},{"token":"B","text":"-5"},{"token":"C","text":"5"},{"token":"D","text":"-3"}]'::jsonb,
   'A', 'The slope-intercept form y = mx + b gives m = 3.', 'published', now()),
  ('SATM1AAAA03', 'M', 1, 'Algebra', ARRAY['ALG.03'], 3,
   'Solve: x^2 - 5x + 6 = 0',
   '[{"token":"A","text":"x=2,3"},{"token":"B","text":"x=1,6"},{"token":"C","text":"x=-2,-3"},{"token":"D","text":"x=0,5"}]'::jsonb,
   'A', 'Factor: (x-2)(x-3) = 0, so x = 2 or x = 3.', 'published', now());
SQL
echo "    OK 3 Algebra/M questions seeded"

# ---------------------------------------------------------------------------
# 1. select_practice_pool_random returns non-zero results
# ---------------------------------------------------------------------------
echo "==> P.1 select_practice_pool_random: non-zero selection"
POOL_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['M'],
    p_domains := ARRAY['Algebra'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  );
")
[ "$POOL_COUNT" -gt 0 ] || { echo "FAIL: select_practice_pool_random returned 0 rows"; exit 1; }
echo "    OK $POOL_COUNT row(s)"

# ---------------------------------------------------------------------------
# 2. Returned rows have required columns populated
# ---------------------------------------------------------------------------
echo "==> P.2 question reconstruction: stem, options, section, domain present"
NULL_FIELDS=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['M'],
    p_domains := ARRAY['Algebra'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  ) WHERE stem IS NULL OR options IS NULL OR section IS NULL OR domain IS NULL;
")
[ "$NULL_FIELDS" = "0" ] || { echo "FAIL: $NULL_FIELDS row(s) with NULL required columns"; exit 1; }
echo "    OK all required fields populated"

# ---------------------------------------------------------------------------
# 3. Anti-leak: RPC returns correct_answer and explanation (server strips them)
# ---------------------------------------------------------------------------
echo "==> P.3 anti-leak: RPC returns answer columns (server must strip)"
ANSWER_PRESENT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['M'],
    p_domains := ARRAY['Algebra'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  ) WHERE correct_answer IS NOT NULL AND explanation IS NOT NULL;
")
[ "$ANSWER_PRESENT" -gt 0 ] || { echo "FAIL: RPC did not return answer columns (anti-leak strip would fail)"; exit 1; }
echo "    OK correct_answer and explanation present in RPC output"

# ---------------------------------------------------------------------------
# 4. Pool respects section/domain filter
# ---------------------------------------------------------------------------
echo "==> P.4 pool filter: RW section returns 0 (only M seeded)"
RW_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['RW'],
    p_domains := ARRAY['Craft and Structure'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  );
")
[ "$RW_COUNT" = "0" ] || { echo "FAIL: RW pool should be 0 but got $RW_COUNT"; exit 1; }
echo "    OK empty for unmatched section"

# ---------------------------------------------------------------------------
# 5. Pool respects exclude_ids
# ---------------------------------------------------------------------------
echo "==> P.5 pool exclude_ids: excluding all 3 returns 0"
EXCL_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['M'],
    p_domains := ARRAY['Algebra'],
    p_limit := 10,
    p_exclude_ids := ARRAY['SATM1AAAA01','SATM1AAAA02','SATM1AAAA03']
  );
")
[ "$EXCL_COUNT" = "0" ] || { echo "FAIL: exclude_ids should yield 0 but got $EXCL_COUNT"; exit 1; }
echo "    OK exclusion works"

# ---------------------------------------------------------------------------
# 6. Config doctrine: quota RPC rejects when config keys are missing
# ---------------------------------------------------------------------------
echo "==> P.6 config doctrine: quota RPC rejects on missing config"
# Create a test user for quota checks
psql_db "$DB" -q -c "INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001','quota-test@example.com');" >/dev/null

# Attempt quota check without config keys — must fail
QUOTA_ERR=$(psql_db "$DB" -tAc "
  SELECT public.check_and_reserve_practice_quota(
    '00000000-0000-0000-0000-000000000001'::uuid
  );
" 2>&1 || true)
echo "$QUOTA_ERR" | grep -q 'missing or invalid key daily_quota_free' || {
  echo "FAIL: quota RPC did not reject missing daily_quota_free config"
  echo "Got: $QUOTA_ERR"
  exit 1
}
echo "    OK rejects missing config"

# ---------------------------------------------------------------------------
# 7. Config doctrine: quota RPC succeeds with config seeded
# ---------------------------------------------------------------------------
echo "==> P.7 config doctrine: quota RPC succeeds with config"
psql_db "$DB" >/dev/null <<'SQL'
INSERT INTO public.practice_runtime_config (key, value, value_type, owner, description, environment)
VALUES
  ('daily_quota_free', '40'::jsonb, 'integer', 'product', 'Free-tier daily question limit', 'all'),
  ('max_session_count_premium', '60'::jsonb, 'integer', 'product', 'Premium per-session question limit', 'all')
ON CONFLICT (key) DO NOTHING;
SQL

QUOTA_RESULT=$(psql_db "$DB" -tAc "
  SELECT public.check_and_reserve_practice_quota(
    '00000000-0000-0000-0000-000000000001'::uuid
  );
")
echo "$QUOTA_RESULT" | grep -q '"allowed": true' || {
  echo "FAIL: quota RPC did not succeed with config seeded"
  echo "Got: $QUOTA_RESULT"
  exit 1
}
echo "    OK quota allowed"

# ---------------------------------------------------------------------------
# 8. Idempotency: same session_item_id returns duplicate=true
# ---------------------------------------------------------------------------
echo "==> P.8 idempotency: same session_item_id dedupes"
ITEM_UUID='11111111-1111-1111-1111-111111111111'
SESSION_UUID='22222222-2222-2222-2222-222222222222'

FIRST=$(psql_db "$DB" -tAc "
  SELECT public.check_and_reserve_practice_quota(
    '00000000-0000-0000-0000-000000000001'::uuid,
    NULL::uuid,
    '$SESSION_UUID'::uuid,
    '$ITEM_UUID'::uuid,
    false,
    'req-001'
  );
")
echo "$FIRST" | grep -q '"allowed": true' || { echo "FAIL: first quota call not allowed"; exit 1; }
echo "$FIRST" | grep -q '"duplicate": false' || { echo "FAIL: first call should not be duplicate"; exit 1; }

SECOND=$(psql_db "$DB" -tAc "
  SELECT public.check_and_reserve_practice_quota(
    '00000000-0000-0000-0000-000000000001'::uuid,
    NULL::uuid,
    '$SESSION_UUID'::uuid,
    '$ITEM_UUID'::uuid,
    false,
    'req-002'
  );
")
echo "$SECOND" | grep -q '"duplicate": true' || {
  echo "FAIL: second call with same session_item_id should be duplicate"
  echo "Got: $SECOND"
  exit 1
}
echo "    OK idempotent"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
echo "==> cleanup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
echo "PRACTICE INTEGRATION GATE: PASS"
