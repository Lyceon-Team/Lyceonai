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

# Seed a REAL published R&W question WITH a non-empty passage (Revision 2 fixture)
echo "==> seed R&W question with passage"
psql_db "$DB" >/dev/null <<'SQL'
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, passage, status, published_at)
VALUES
  ('SATRW1CAS001', 'RW', 1, 'Craft and Structure', ARRAY['CAS.01'], 2,
   'Based on the passage, the author most likely uses the word "luminous" to mean',
   '[{"token":"A","text":"brightly lit"},{"token":"B","text":"intellectually brilliant"},{"token":"C","text":"clearly visible"},{"token":"D","text":"warmly glowing"}]'::jsonb,
   'B',
   'In context, "luminous" describes the quality of the argument, not physical light. The author contrasts it with "opaque reasoning," indicating intellectual clarity.',
   'The scholar''s luminous analysis of the text stood in stark contrast to the opaque reasoning that had dominated the field for decades. Where others saw ambiguity, she found precision; where others retreated into jargon, she advanced with plain language that illuminated every corner of the debate.',
   'published', now());
SQL
echo "    OK 1 R&W/Craft and Structure question seeded (with passage)"

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
echo "==> P.4 pool filter: RW section returns seeded R&W question"
RW_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['RW'],
    p_domains := ARRAY['Craft and Structure'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  );
")
[ "$RW_COUNT" -gt 0 ] || { echo "FAIL: RW pool should be >0 after R&W seed but got $RW_COUNT"; exit 1; }
echo "    OK $RW_COUNT R&W row(s)"

echo "==> P.4b pool filter: unseeded domain returns 0"
EMPTY_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['RW'],
    p_domains := ARRAY['Information and Ideas'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  );
")
[ "$EMPTY_COUNT" = "0" ] || { echo "FAIL: unseeded RW domain should be 0 but got $EMPTY_COUNT"; exit 1; }
echo "    OK empty for unmatched domain"

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

# Delete seeded config keys so the RPC sees them as missing
psql_db "$DB" -q -c "DELETE FROM public.practice_runtime_config WHERE key IN ('daily_quota_free','max_session_count_premium');" >/dev/null

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
# 9. R&W passage: RPC returns passage column for R&W questions
# ---------------------------------------------------------------------------
echo "==> P.9 R&W passage: select_practice_pool_random returns passage for RW"
RW_PASSAGE_LEN=$(psql_db "$DB" -tAc "
  SELECT char_length(passage) FROM public.select_practice_pool_random(
    p_sections := ARRAY['RW'],
    p_domains := ARRAY['Craft and Structure'],
    p_limit := 1,
    p_exclude_ids := ARRAY[]::text[]
  ) LIMIT 1;
")
[ -n "$RW_PASSAGE_LEN" ] && [ "$RW_PASSAGE_LEN" -gt 0 ] 2>/dev/null || { echo "FAIL: RW question passage is NULL or empty in RPC output"; exit 1; }
echo "    OK passage present ($RW_PASSAGE_LEN chars)"

# ---------------------------------------------------------------------------
# 10. Row-mapping regression guard (production buildSessionItemInsertRows)
# ---------------------------------------------------------------------------
# The real defect-site test lives in the vitest suite
# (practice.rw-row-mapping.ci.test.ts) which calls the production
# buildSessionItemInsertRows and toStudentSafeQuestionDTO directly with
# real R&W shapes. This bash job cannot run Node, so the pure-function
# proof is delegated there; P.9 above proves the RPC returns passage.
echo "==> P.10 (delegated to vitest: practice.rw-row-mapping.ci.test.ts)"

# ---------------------------------------------------------------------------
# 11. RPC pool carries answer columns (server-side fact)
# ---------------------------------------------------------------------------
# This proves the RPC pool returns correct_answer and explanation for R&W
# questions — a prerequisite for server-side grading. The actual student-DTO
# anti-leak proof (strip to null) lives in the vitest suite
# (practice.rw-row-mapping.ci.test.ts).
echo "==> P.11 RPC pool: R&W rows carry answer columns for server-side grading"
RW_ANSWER_PRESENT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_practice_pool_random(
    p_sections := ARRAY['RW'],
    p_domains := ARRAY['Craft and Structure'],
    p_limit := 10,
    p_exclude_ids := ARRAY[]::text[]
  ) WHERE correct_answer IS NOT NULL AND explanation IS NOT NULL;
")
[ "$RW_ANSWER_PRESENT" -gt 0 ] || { echo "FAIL: R&W RPC did not return answer columns"; exit 1; }
echo "    OK correct_answer and explanation present in R&W RPC pool"

# ===========================================================================
# DIAGNOSTIC INTEGRATION TESTS (Doc-02B_V4 §20)
# ===========================================================================
# The diagnostic IS practice — same engine, same serve/grade/emit — with
# three filters: 5 per domain × 8 domains, randomized, difficulty spread.
# These tests prove the mechanism fires against real Postgres.
# ===========================================================================

# ---------------------------------------------------------------------------
# Seed: questions across all 8 SAT domains (5 per domain = 40 total)
# ---------------------------------------------------------------------------
echo "==> seed diagnostic bank (8 domains × 5 questions)"
psql_db "$DB" >/dev/null <<'SQL'
INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status, published_at)
VALUES
  -- M / Algebra (3 already seeded above; add 2 more)
  ('SATM1DGA004', 'M', 1, 'Algebra', ARRAY['ALG.04'], 1,
   'Simplify: 3(x + 2) - x', '[{"token":"A","text":"2x+6"},{"token":"B","text":"4x+2"},{"token":"C","text":"2x+2"},{"token":"D","text":"3x+6"}]'::jsonb,
   'A', 'Distribute: 3x+6-x = 2x+6.', 'published', now()),
  ('SATM1DGA005', 'M', 1, 'Algebra', ARRAY['ALG.05'], 2,
   'If f(x)=2x+1, what is f(3)?', '[{"token":"A","text":"5"},{"token":"B","text":"7"},{"token":"C","text":"6"},{"token":"D","text":"9"}]'::jsonb,
   'B', 'f(3)=2(3)+1=7.', 'published', now()),

  -- M / Advanced Math (5 questions)
  ('SATM1DGB001', 'M', 1, 'Advanced Math', ARRAY['AM.01'], 1,
   'Factor: x^2 - 9', '[{"token":"A","text":"(x-3)(x+3)"},{"token":"B","text":"(x-9)(x+1)"},{"token":"C","text":"(x-3)^2"},{"token":"D","text":"x(x-9)"}]'::jsonb,
   'A', 'Difference of squares: x^2-9=(x-3)(x+3).', 'published', now()),
  ('SATM1DGB002', 'M', 1, 'Advanced Math', ARRAY['AM.02'], 2,
   'Simplify: (x^2)(x^3)', '[{"token":"A","text":"x^5"},{"token":"B","text":"x^6"},{"token":"C","text":"2x^5"},{"token":"D","text":"x^23"}]'::jsonb,
   'A', 'Add exponents: x^(2+3)=x^5.', 'published', now()),
  ('SATM1DGB003', 'M', 1, 'Advanced Math', ARRAY['AM.03'], 3,
   'Solve: 2^x = 16', '[{"token":"A","text":"4"},{"token":"B","text":"8"},{"token":"C","text":"2"},{"token":"D","text":"3"}]'::jsonb,
   'A', '2^4=16, so x=4.', 'published', now()),
  ('SATM1DGB004', 'M', 1, 'Advanced Math', ARRAY['AM.04'], 1,
   'What is sqrt(144)?', '[{"token":"A","text":"12"},{"token":"B","text":"14"},{"token":"C","text":"11"},{"token":"D","text":"13"}]'::jsonb,
   'A', '12*12=144.', 'published', now()),
  ('SATM1DGB005', 'M', 1, 'Advanced Math', ARRAY['AM.05'], 2,
   'If g(x)=x^2-4, what is g(0)?', '[{"token":"A","text":"-4"},{"token":"B","text":"0"},{"token":"C","text":"4"},{"token":"D","text":"-2"}]'::jsonb,
   'A', 'g(0)=0-4=-4.', 'published', now()),

  -- M / Problem Solving and Data Analysis (5 questions)
  ('SATM1DGC001', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSDA.01'], 1,
   'Mean of {2,4,6,8,10}?', '[{"token":"A","text":"6"},{"token":"B","text":"5"},{"token":"C","text":"7"},{"token":"D","text":"8"}]'::jsonb,
   'A', '(2+4+6+8+10)/5=30/5=6.', 'published', now()),
  ('SATM1DGC002', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSDA.02'], 2,
   'Median of {3,1,4,1,5}?', '[{"token":"A","text":"3"},{"token":"B","text":"1"},{"token":"C","text":"4"},{"token":"D","text":"5"}]'::jsonb,
   'A', 'Sorted: 1,1,3,4,5. Middle=3.', 'published', now()),
  ('SATM1DGC003', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSDA.03'], 3,
   'A ratio of 3:5 with total 40?', '[{"token":"A","text":"15 and 25"},{"token":"B","text":"20 and 20"},{"token":"C","text":"12 and 28"},{"token":"D","text":"10 and 30"}]'::jsonb,
   'A', '3/8*40=15, 5/8*40=25.', 'published', now()),
  ('SATM1DGC004', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSDA.04'], 1,
   '25% of 80?', '[{"token":"A","text":"20"},{"token":"B","text":"25"},{"token":"C","text":"15"},{"token":"D","text":"30"}]'::jsonb,
   'A', '0.25*80=20.', 'published', now()),
  ('SATM1DGC005', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSDA.05'], 2,
   'Probability of heads on a fair coin?', '[{"token":"A","text":"1/2"},{"token":"B","text":"1/3"},{"token":"C","text":"1/4"},{"token":"D","text":"2/3"}]'::jsonb,
   'A', 'Fair coin: P(H)=1/2.', 'published', now()),

  -- M / Geometry and Trigonometry (5 questions)
  ('SATM1DGD001', 'M', 1, 'Geometry and Trigonometry', ARRAY['GT.01'], 1,
   'Area of a rectangle 5×3?', '[{"token":"A","text":"15"},{"token":"B","text":"16"},{"token":"C","text":"8"},{"token":"D","text":"20"}]'::jsonb,
   'A', '5*3=15.', 'published', now()),
  ('SATM1DGD002', 'M', 1, 'Geometry and Trigonometry', ARRAY['GT.02'], 2,
   'Hypotenuse of 3-4-? triangle?', '[{"token":"A","text":"5"},{"token":"B","text":"6"},{"token":"C","text":"7"},{"token":"D","text":"4.5"}]'::jsonb,
   'A', 'sqrt(9+16)=sqrt(25)=5.', 'published', now()),
  ('SATM1DGD003', 'M', 1, 'Geometry and Trigonometry', ARRAY['GT.03'], 3,
   'Circumference of circle r=7?', '[{"token":"A","text":"14π"},{"token":"B","text":"7π"},{"token":"C","text":"49π"},{"token":"D","text":"21π"}]'::jsonb,
   'A', 'C=2πr=14π.', 'published', now()),
  ('SATM1DGD004', 'M', 1, 'Geometry and Trigonometry', ARRAY['GT.04'], 1,
   'Sum of angles in a triangle?', '[{"token":"A","text":"180°"},{"token":"B","text":"360°"},{"token":"C","text":"90°"},{"token":"D","text":"270°"}]'::jsonb,
   'A', 'Always 180 degrees.', 'published', now()),
  ('SATM1DGD005', 'M', 1, 'Geometry and Trigonometry', ARRAY['GT.05'], 2,
   'Area of a circle r=3?', '[{"token":"A","text":"9π"},{"token":"B","text":"6π"},{"token":"C","text":"3π"},{"token":"D","text":"12π"}]'::jsonb,
   'A', 'A=πr^2=9π.', 'published', now()),

  -- RW / Information and Ideas (5 questions)
  ('SATRW1DGE001', 'RW', 1, 'Information and Ideas', ARRAY['IAI.01'], 1,
   'The main idea of a paragraph is', '[{"token":"A","text":"the central point"},{"token":"B","text":"a minor detail"},{"token":"C","text":"the title"},{"token":"D","text":"the last sentence"}]'::jsonb,
   'A', 'Main idea is the central point.', 'published', now()),
  ('SATRW1DGE002', 'RW', 1, 'Information and Ideas', ARRAY['IAI.02'], 2,
   'An inference is best described as', '[{"token":"A","text":"a logical conclusion"},{"token":"B","text":"a direct quote"},{"token":"C","text":"a summary"},{"token":"D","text":"a restatement"}]'::jsonb,
   'A', 'Inference = logical conclusion from evidence.', 'published', now()),
  ('SATRW1DGE003', 'RW', 1, 'Information and Ideas', ARRAY['IAI.03'], 3,
   'Which best supports the claim?', '[{"token":"A","text":"direct evidence"},{"token":"B","text":"opinion"},{"token":"C","text":"anecdote"},{"token":"D","text":"analogy"}]'::jsonb,
   'A', 'Direct evidence is strongest support.', 'published', now()),
  ('SATRW1DGE004', 'RW', 1, 'Information and Ideas', ARRAY['IAI.04'], 1,
   'A fact differs from an opinion because', '[{"token":"A","text":"it can be verified"},{"token":"B","text":"it is interesting"},{"token":"C","text":"it is long"},{"token":"D","text":"everyone agrees"}]'::jsonb,
   'A', 'Facts are verifiable; opinions are not.', 'published', now()),
  ('SATRW1DGE005', 'RW', 1, 'Information and Ideas', ARRAY['IAI.05'], 2,
   'What does "cite evidence" mean?', '[{"token":"A","text":"refer to specific text"},{"token":"B","text":"ignore the passage"},{"token":"C","text":"guess the answer"},{"token":"D","text":"write your opinion"}]'::jsonb,
   'A', 'Citing = referring to specific text.', 'published', now()),

  -- RW / Craft and Structure (4 more; 1 already seeded above)
  ('SATRW1DGF002', 'RW', 1, 'Craft and Structure', ARRAY['CAS.02'], 1,
   'Tone in writing refers to', '[{"token":"A","text":"the author attitude"},{"token":"B","text":"the volume"},{"token":"C","text":"the font"},{"token":"D","text":"the length"}]'::jsonb,
   'A', 'Tone = author''s attitude toward subject.', 'published', now()),
  ('SATRW1DGF003', 'RW', 1, 'Craft and Structure', ARRAY['CAS.03'], 3,
   'A rhetorical question is used to', '[{"token":"A","text":"make a point"},{"token":"B","text":"get an answer"},{"token":"C","text":"end a paragraph"},{"token":"D","text":"introduce a topic"}]'::jsonb,
   'A', 'Rhetorical questions make a point, not seek answers.', 'published', now()),
  ('SATRW1DGF004', 'RW', 1, 'Craft and Structure', ARRAY['CAS.04'], 1,
   'Purpose of a metaphor?', '[{"token":"A","text":"compare without like/as"},{"token":"B","text":"list items"},{"token":"C","text":"tell time"},{"token":"D","text":"define a word"}]'::jsonb,
   'A', 'Metaphor compares without using like or as.', 'published', now()),
  ('SATRW1DGF005', 'RW', 1, 'Craft and Structure', ARRAY['CAS.05'], 2,
   'Word choice affects', '[{"token":"A","text":"meaning and tone"},{"token":"B","text":"page count"},{"token":"C","text":"grammar only"},{"token":"D","text":"nothing"}]'::jsonb,
   'A', 'Word choice shapes meaning and tone.', 'published', now()),

  -- RW / Expression of Ideas (5 questions)
  ('SATRW1DGG001', 'RW', 1, 'Expression of Ideas', ARRAY['EOI.01'], 1,
   'A thesis statement is', '[{"token":"A","text":"the main argument"},{"token":"B","text":"a question"},{"token":"C","text":"a quote"},{"token":"D","text":"a footnote"}]'::jsonb,
   'A', 'Thesis = main argument of the essay.', 'published', now()),
  ('SATRW1DGG002', 'RW', 1, 'Expression of Ideas', ARRAY['EOI.02'], 2,
   'Transition words help to', '[{"token":"A","text":"connect ideas"},{"token":"B","text":"end paragraphs"},{"token":"C","text":"add length"},{"token":"D","text":"replace verbs"}]'::jsonb,
   'A', 'Transitions connect ideas smoothly.', 'published', now()),
  ('SATRW1DGG003', 'RW', 1, 'Expression of Ideas', ARRAY['EOI.03'], 3,
   'Revising primarily involves', '[{"token":"A","text":"improving content"},{"token":"B","text":"fixing spelling"},{"token":"C","text":"adding pages"},{"token":"D","text":"changing fonts"}]'::jsonb,
   'A', 'Revising = improving content and structure.', 'published', now()),
  ('SATRW1DGG004', 'RW', 1, 'Expression of Ideas', ARRAY['EOI.04'], 1,
   'A conclusion paragraph should', '[{"token":"A","text":"summarize key points"},{"token":"B","text":"introduce new ideas"},{"token":"C","text":"ask questions"},{"token":"D","text":"repeat the intro"}]'::jsonb,
   'A', 'Conclusions summarize, not introduce.', 'published', now()),
  ('SATRW1DGG005', 'RW', 1, 'Expression of Ideas', ARRAY['EOI.05'], 2,
   'Conciseness means', '[{"token":"A","text":"saying more with fewer words"},{"token":"B","text":"writing longer"},{"token":"C","text":"using big words"},{"token":"D","text":"adding details"}]'::jsonb,
   'A', 'Concise = clear with fewer words.', 'published', now()),

  -- RW / Standard English Conventions (5 questions)
  ('SATRW1DGH001', 'RW', 1, 'Standard English Conventions', ARRAY['SEC.01'], 1,
   'A comma splice occurs when', '[{"token":"A","text":"two clauses joined by comma only"},{"token":"B","text":"a period is missing"},{"token":"C","text":"a word is misspelled"},{"token":"D","text":"a verb is wrong"}]'::jsonb,
   'A', 'Comma splice = two independent clauses joined by comma alone.', 'published', now()),
  ('SATRW1DGH002', 'RW', 1, 'Standard English Conventions', ARRAY['SEC.02'], 2,
   'Subject-verb agreement requires', '[{"token":"A","text":"matching number"},{"token":"B","text":"matching tense"},{"token":"C","text":"same length"},{"token":"D","text":"parallel words"}]'::jsonb,
   'A', 'Subject and verb must agree in number.', 'published', now()),
  ('SATRW1DGH003', 'RW', 1, 'Standard English Conventions', ARRAY['SEC.03'], 3,
   'A semicolon joins', '[{"token":"A","text":"related independent clauses"},{"token":"B","text":"a list"},{"token":"C","text":"a question"},{"token":"D","text":"unrelated ideas"}]'::jsonb,
   'A', 'Semicolons join related independent clauses.', 'published', now()),
  ('SATRW1DGH004', 'RW', 1, 'Standard English Conventions', ARRAY['SEC.04'], 1,
   'Its vs it''s: "it''s" means', '[{"token":"A","text":"it is"},{"token":"B","text":"possession"},{"token":"C","text":"plural"},{"token":"D","text":"past tense"}]'::jsonb,
   'A', 'It''s = it is (contraction).', 'published', now()),
  ('SATRW1DGH005', 'RW', 1, 'Standard English Conventions', ARRAY['SEC.05'], 2,
   'Parallel structure means', '[{"token":"A","text":"consistent grammatical form"},{"token":"B","text":"same word count"},{"token":"C","text":"rhyming"},{"token":"D","text":"alphabetical order"}]'::jsonb,
   'A', 'Parallelism = consistent grammatical forms in a list.', 'published', now())
ON CONFLICT (id) DO NOTHING;
SQL
echo "    OK diagnostic bank seeded (42 total questions across 8 domains)"

# ---------------------------------------------------------------------------
# D.1 select_diagnostic_pool returns rows from all 8 domains
# ---------------------------------------------------------------------------
echo "==> D.1 select_diagnostic_pool: returns rows across domains"
DIAG_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.select_diagnostic_pool(
    p_per_domain := 5,
    p_exclude_ids := ARRAY[]::text[]
  );
")
[ "$DIAG_COUNT" -ge 40 ] || { echo "FAIL: select_diagnostic_pool returned $DIAG_COUNT rows, expected >= 40"; exit 1; }
echo "    OK $DIAG_COUNT row(s)"

# ---------------------------------------------------------------------------
# D.2 Diagnostic pool covers all 8 domains
# ---------------------------------------------------------------------------
echo "==> D.2 diagnostic pool: all 8 domains represented"
DOMAIN_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(DISTINCT domain) FROM public.select_diagnostic_pool(
    p_per_domain := 5,
    p_exclude_ids := ARRAY[]::text[]
  );
")
[ "$DOMAIN_COUNT" = "8" ] || { echo "FAIL: diagnostic pool covers $DOMAIN_COUNT domains, expected 8"; exit 1; }
echo "    OK $DOMAIN_COUNT distinct domains"

# ---------------------------------------------------------------------------
# D.3 Diagnostic pool: at most p_per_domain per domain
# ---------------------------------------------------------------------------
echo "==> D.3 diagnostic pool: <= 5 per domain"
MAX_PER_DOMAIN=$(psql_db "$DB" -tAc "
  SELECT max(cnt) FROM (
    SELECT domain, count(*) AS cnt FROM public.select_diagnostic_pool(
      p_per_domain := 5,
      p_exclude_ids := ARRAY[]::text[]
    ) GROUP BY domain
  ) sub;
")
[ "$MAX_PER_DOMAIN" -le 5 ] || { echo "FAIL: max per domain is $MAX_PER_DOMAIN, expected <= 5"; exit 1; }
echo "    OK max $MAX_PER_DOMAIN per domain"

# ---------------------------------------------------------------------------
# D.4 Diagnostic pool: SECURITY INVOKER (FIX 3 confirmation)
# ---------------------------------------------------------------------------
echo "==> D.4 select_diagnostic_pool: SECURITY INVOKER"
SEC_TYPE=$(psql_db "$DB" -tAc "
  SELECT prosecdef FROM pg_proc
  WHERE proname = 'select_diagnostic_pool'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
")
SEC_TYPE=$(echo "$SEC_TYPE" | tr -d '[:space:]')
[ "$SEC_TYPE" = "f" ] || { echo "FAIL: select_diagnostic_pool prosecdef=$SEC_TYPE, expected f (INVOKER)"; exit 1; }
echo "    OK SECURITY INVOKER confirmed (prosecdef=false)"

# ---------------------------------------------------------------------------
# D.5 End-to-end: diagnostic session → 40 answers → mastery → projections
# ---------------------------------------------------------------------------
echo "==> D.5 diagnostic end-to-end: session + mastery + projections"
psql_db "$DB" >/dev/null <<'SQL'
DO $$
DECLARE
  v_student_id uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_session_id uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_item       record;
  v_result     public.student_skill_mastery;
  v_now        timestamptz := now();
BEGIN
  -- Ensure test student exists
  INSERT INTO auth.users (id, email) VALUES (v_student_id, 'diag-test@example.com')
  ON CONFLICT (id) DO NOTHING;

  -- Create diagnostic session (mode = 'diagnostic')
  INSERT INTO public.practice_sessions (
    id, user_id, actor_id, mode, filters, target_count, platform, status, completed_at
  ) VALUES (
    v_session_id, v_student_id, v_student_id, 'diagnostic', '{}', 40, 'web', 'completed', v_now
  );

  -- Insert 40 answered items from the diagnostic pool (all 8 domains)
  INSERT INTO public.practice_session_items (
    id, session_id, user_id, actor_id, ordinal,
    question_id, question_stem, question_options, question_correct_answer,
    question_explanation, question_domain, question_skill, question_difficulty,
    question_section, status, selected_answer, is_correct, outcome, answered_at,
    occurred_at, question_item_type
  )
  SELECT
    gen_random_uuid(), v_session_id, v_student_id, v_student_id,
    (row_number() OVER (ORDER BY q.id))::integer,
    q.id, q.stem, q.options, q.correct_answer, q.explanation,
    q.domain, q.skill_codes[1], q.difficulty::smallint, q.section,
    'answered', 'A',
    (q.correct_answer = 'A'),
    CASE WHEN q.correct_answer = 'A' THEN 'correct' ELSE 'incorrect' END,
    v_now, v_now, 'mcq'
  FROM public.select_diagnostic_pool(5, ARRAY[]::text[]) q
  ORDER BY q.id;

  -- Apply mastery event for each answered item (sequential, same as server)
  FOR v_item IN
    SELECT psi.id AS item_id, psi.question_id, psi.question_section,
           psi.question_domain, psi.question_skill, psi.question_difficulty,
           psi.is_correct
    FROM public.practice_session_items psi
    WHERE psi.session_id = v_session_id
    ORDER BY psi.ordinal
  LOOP
    v_result := public.apply_mastery_event(
      v_student_id,
      v_item.question_section,
      v_item.question_domain,
      v_item.question_skill,
      v_item.question_difficulty::smallint,
      'practice',
      'diagnostic_attempt',
      v_item.is_correct,
      v_now,
      v_item.item_id,
      v_item.question_id
    );
  END LOOP;
END $$;
SQL
echo "    OK diagnostic session created and mastery events applied"

# Assert: 40 diagnostic items for this session
DIAG_ITEM_COUNT=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.practice_session_items
  WHERE session_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
")
[ "$DIAG_ITEM_COUNT" = "40" ] || { echo "FAIL: expected 40 diagnostic items, got $DIAG_ITEM_COUNT"; exit 1; }
echo "    OK 40 diagnostic items"

# Assert: mastery rows exist for both sections
M_MASTERY=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_skill_mastery
  WHERE student_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND section = 'M';
")
RW_MASTERY=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_skill_mastery
  WHERE student_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND section = 'RW';
")
[ "$M_MASTERY" -gt 0 ] || { echo "FAIL: no Math mastery rows after diagnostic"; exit 1; }
[ "$RW_MASTERY" -gt 0 ] || { echo "FAIL: no R&W mastery rows after diagnostic"; exit 1; }
echo "    OK mastery exists: M=$M_MASTERY rows, RW=$RW_MASTERY rows"

# Assert: non-NULL student_section_projections for BOTH M and RW
M_PROJ=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_section_projections
  WHERE student_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND section = 'M'
    AND projected_score_mid IS NOT NULL;
")
RW_PROJ=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_section_projections
  WHERE student_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND section = 'RW'
    AND projected_score_mid IS NOT NULL;
")
[ "$M_PROJ" -gt 0 ] || { echo "FAIL: no Math projection after diagnostic (student_section_projections M is NULL)"; exit 1; }
[ "$RW_PROJ" -gt 0 ] || { echo "FAIL: no R&W projection after diagnostic (student_section_projections RW is NULL)"; exit 1; }
echo "    OK projections: M=$M_PROJ, RW=$RW_PROJ (non-NULL)"

# ---------------------------------------------------------------------------
# D.6 Replay: re-applying same events produces no duplicate mastery rows
# ---------------------------------------------------------------------------
echo "==> D.6 replay idempotency: no duplicate mastery rows"
M_MASTERY_BEFORE=$M_MASTERY
RW_MASTERY_BEFORE=$RW_MASTERY

# Re-apply the same mastery events (idempotent — apply_mastery_event is
# upsert-on-event, so re-running with the same event_id should not create
# new skill rows). Count skill mastery rows before and after.
psql_db "$DB" >/dev/null <<'SQL'
DO $$
DECLARE
  v_student_id uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_item       record;
  v_result     public.student_skill_mastery;
  v_now        timestamptz := now();
BEGIN
  FOR v_item IN
    SELECT psi.id AS item_id, psi.question_id, psi.question_section,
           psi.question_domain, psi.question_skill, psi.question_difficulty,
           psi.is_correct
    FROM public.practice_session_items psi
    WHERE psi.session_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
    ORDER BY psi.ordinal
  LOOP
    v_result := public.apply_mastery_event(
      v_student_id,
      v_item.question_section,
      v_item.question_domain,
      v_item.question_skill,
      v_item.question_difficulty::smallint,
      'practice',
      'diagnostic_attempt',
      v_item.is_correct,
      v_now,
      v_item.item_id,
      v_item.question_id
    );
  END LOOP;
END $$;
SQL

M_MASTERY_AFTER=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_skill_mastery
  WHERE student_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND section = 'M';
")
RW_MASTERY_AFTER=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.student_skill_mastery
  WHERE student_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    AND section = 'RW';
")
[ "$M_MASTERY_AFTER" = "$M_MASTERY_BEFORE" ] || { echo "FAIL: Math mastery rows changed after replay ($M_MASTERY_BEFORE → $M_MASTERY_AFTER)"; exit 1; }
[ "$RW_MASTERY_AFTER" = "$RW_MASTERY_BEFORE" ] || { echo "FAIL: R&W mastery rows changed after replay ($RW_MASTERY_BEFORE → $RW_MASTERY_AFTER)"; exit 1; }
echo "    OK replay produced no duplicate mastery rows"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
echo "==> cleanup"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null
echo "PRACTICE INTEGRATION GATE: PASS"
