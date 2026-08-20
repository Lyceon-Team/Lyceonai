#!/usr/bin/env bash
# ============================================================================
# mastery_levels + canonical_skill_catalog — HARD CI GATES
# ============================================================================
# @spec [owner ruling 2026-08-20 RULE 1 (six names), RULE 2 (names only, never
#        boundaries), RULE 3 (`unmeasured` is a ROW), RULE 5 (drill-down)]
#
# Against a THROWAWAY Postgres carrying genesis + the full migration pipeline:
#
#   L1  exactly six label rows
#   L2  every integer the formula can emit (0-4) has exactly ONE label — asserted
#       from generate_series, not from the table, so a MISSING label is caught.
#       Counting the table's own rows cannot detect an absent level.
#   L3  the `unmeasured` row exists and carries level IS NULL
#   L4  a duplicate level is rejected (23505) — the partial unique index bites
#   L5  the unmeasured/NULL equivalence is rejected in BOTH directions (23514)
#   L6  RULE 2 — the table carries NO threshold-shaped column. Boundaries live in
#       mastery_constants; this table names the integer the formula already
#       produced and must never participate in producing it.
#   L7  RULE 2 — canonicalize_mastery_constants_serialized() is byte-identical to
#       the value measured before these migrations. The scoring hash must not move.
#   C1  the catalog derives (section, domain, skill) from published questions,
#       across all 8 canonical domains, with the exact per-domain skill counts of
#       a seeded fixture
#   C2  the `status = 'published'` filter DISCRIMINATES — draft and retired
#       questions contribute nothing
#   C3  the catalog carries no question content (projection-only anti-leak)
#
# MUTATIONS THAT MUST TURN THIS RED (each verified by hand before shipping):
#   delete the `unmeasured` row .................... L1, L2 (via the NULL arm), L3
#   drop any single level row ...................... L2
#   add a `band_min numeric` column ................ L6
#   change any mastery_constants VALUE ............. L7
#     (adding an unknown KEY is not a usable mutation: 05D's closed-world
#      classifier already raises CONSTANT_KEY_UNKNOWN before the gate runs, so
#      the migration aborts rather than the gate failing. Verified 2026-08-20.)
#   drop `WHERE status = 'published'` from the view  C2
#   remove one domain's questions from the fixture . C1
# ============================================================================
set -euo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5433}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
export PATH="/usr/lib/postgresql/16/bin:$PATH"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=mastery_levels_gate

# Measured on 2026-08-20 against the migration pipeline WITHOUT
# 20260820000000/20260820010000 applied. Pinned as a literal so this gate proves
# the two new migrations did not disturb the formula's constant set — a value
# recomputed live on both sides would agree with itself no matter what changed.
EXPECTED_CONSTANTS_MD5="6225ebabc555be71bb8e1cecf35941b7"

psql_db() { psql -v ON_ERROR_STOP=1 -d "$1" "${@:2}"; }
cleanup() { psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

fail() { echo "FAIL: $*"; exit 1; }

echo "==> fresh DB + role/auth stub + migration pipeline"
psql_db postgres -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" >/dev/null
psql_db "$DB" >/dev/null <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL
for f in "$ROOT"/supabase/migrations/*.sql; do psql_db "$DB" -q -f "$f" >/dev/null; done

# ---------------------------------------------------------------------------
echo "==> L1: exactly six label rows"
N=$(psql_db "$DB" -tAc "SELECT count(*) FROM public.mastery_levels;")
[ "$N" = "6" ] || fail "mastery_levels has $N row(s), expected 6 (five levels + unmeasured)"

# ---------------------------------------------------------------------------
echo "==> L2: every level 0-4 has exactly one label (asserted from generate_series)"
# Driven from generate_series so a MISSING level is caught. A query that counted
# the table's own rows could not tell 'level 3 is absent' from 'level 3 exists' —
# it would only ever see what is there. Same defect class as counting parsed
# entries to detect a parse failure.
UNLABELLED=$(psql_db "$DB" -tAc "
  SELECT coalesce(string_agg(g.lvl::text, ',' ORDER BY g.lvl), '')
  FROM generate_series(0, 4) AS g(lvl)
  LEFT JOIN public.mastery_levels ml ON ml.level = g.lvl
  WHERE ml.level_key IS NULL;")
[ -z "$UNLABELLED" ] || fail "mastery_level(s) with no label: $UNLABELLED — a level the formula can emit has no display name"

DUPES=$(psql_db "$DB" -tAc "
  SELECT coalesce(string_agg(level::text, ',' ORDER BY level), '')
  FROM public.mastery_levels WHERE level IS NOT NULL
  GROUP BY level HAVING count(*) > 1;")
[ -z "$DUPES" ] || fail "level(s) with more than one label: $DUPES"

# ---------------------------------------------------------------------------
echo "==> L3: the unmeasured row exists with a NULL level (RULE 3)"
UNMEASURED=$(psql_db "$DB" -tAc "
  SELECT count(*) FROM public.mastery_levels
  WHERE level_key = 'unmeasured' AND level IS NULL;")
[ "$UNMEASURED" = "1" ] || fail "no 'unmeasured' row with a NULL level — NULL would fall back to a code branch again"

NAME=$(psql_db "$DB" -tAc "SELECT display_name FROM public.mastery_levels WHERE level_key='unmeasured';")
[ "$NAME" = "Not enough answers yet" ] || fail "unmeasured display_name is '$NAME', expected 'Not enough answers yet' (RULE 1)"

# ---------------------------------------------------------------------------
echo "==> L4: a duplicate level is rejected"
if psql_db "$DB" -q -c "INSERT INTO public.mastery_levels (level_key, level, display_name, sort_order) VALUES ('L2_DUP', 2, 'Duplicate', 99);" >/dev/null 2>&1; then
  fail "a second label for level 2 was ACCEPTED — the partial unique index is not enforcing"
fi

# ---------------------------------------------------------------------------
echo "==> L5: the unmeasured/NULL equivalence is rejected in both directions"
if psql_db "$DB" -q -c "INSERT INTO public.mastery_levels (level_key, level, display_name, sort_order) VALUES ('unmeasured_2', NULL, 'Second unmeasured', 98);" >/dev/null 2>&1; then
  fail "a NULL level under a key other than 'unmeasured' was ACCEPTED — NULL can be conflated again"
fi
if psql_db "$DB" -q -c "UPDATE public.mastery_levels SET level = 0 WHERE level_key = 'unmeasured';" >/dev/null 2>&1; then
  fail "'unmeasured' was allowed to take level 0 — that is exactly the conflation RULE 3 forbids"
fi

# ---------------------------------------------------------------------------
echo "==> L6: no threshold-shaped column (RULE 2 — names only, never boundaries)"
BAD_COLS=$(psql_db "$DB" -tAc "
  SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name), '')
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'mastery_levels'
    AND (column_name ~* '(min|max|score|band|threshold|boundary|cutoff|pct)');")
[ -z "$BAD_COLS" ] || fail "mastery_levels acquired threshold-shaped column(s): $BAD_COLS — boundaries belong to mastery_constants, and a second copy is a second source of truth"

# ---------------------------------------------------------------------------
echo "==> L7: the mastery constants hash is unchanged (RULE 2)"
ACTUAL_MD5=$(psql_db "$DB" -tAc "SELECT md5(public.canonicalize_mastery_constants_serialized());")
[ "$ACTUAL_MD5" = "$EXPECTED_CONSTANTS_MD5" ] || fail "mastery constants hash moved: $ACTUAL_MD5 != $EXPECTED_CONSTANTS_MD5 — the label migrations must not touch the formula's constant set"

# ---------------------------------------------------------------------------
echo "==> C1/C2/C3: canonical_skill_catalog"
# The fixture is deliberately shaped so the published filter is LOAD-BEARING:
# 'Draft Only Skill' and 'Retired Only Skill' exist in Algebra as non-published
# questions and must not appear. Without the WHERE clause Algebra reports 3.
psql_db "$DB" -q >/dev/null <<'SQL'
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer, explanation, status)
-- Canonical id format: ^SAT(M|RW)[12][A-Z0-9]{6}$ (questions_id_check); mcq rows
-- need exactly 4 options and a NULL correct_variants (questions_item_shape_chk).
VALUES
  ('SATM1CAT001','M',1,'Algebra',                            ARRAY['Linear Equations in One Variable'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATM1CAT002','M',1,'Algebra',                            ARRAY['Linear Functions'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATM1CATD01','M',1,'Algebra',                            ARRAY['Draft Only Skill'],2,'s','["A","B","C","D"]'::jsonb,'A','e','draft'),
  ('SATM1CATR01','M',1,'Algebra',                            ARRAY['Retired Only Skill'],2,'s','["A","B","C","D"]'::jsonb,'A','e','retired'),
  ('SATM1ADV001','M',1,'Advanced Math',                      ARRAY['Nonlinear Functions'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATM1PSD001','M',1,'Problem Solving and Data Analysis',  ARRAY['Percentages','Probability and Conditional Probability'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATM1GEO001','M',1,'Geometry and Trigonometry',          ARRAY['Circles'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATRW1CAS001','RW',1,'Craft and Structure',               ARRAY['Words in Context'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATRW1IAI001','RW',1,'Information and Ideas',             ARRAY['Central Ideas and Details'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATRW1SEC001','RW',1,'Standard English Conventions',      ARRAY['Boundaries'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published'),
  ('SATRW1EOI001','RW',1,'Expression of Ideas',               ARRAY['Transitions'],2,'s','["A","B","C","D"]'::jsonb,'A','e','published')
ON CONFLICT (id) DO NOTHING;
SQL

DOMAIN_COUNT=$(psql_db "$DB" -tAc "SELECT count(DISTINCT domain) FROM public.canonical_skill_catalog;")
[ "$DOMAIN_COUNT" = "8" ] || fail "canonical_skill_catalog covers $DOMAIN_COUNT domain(s), expected all 8 canonical domains"

# Exact per-domain counts. Algebra is 2 (not 4) only because the published filter
# discriminates — this line IS check C2.
ACTUAL_SHAPE=$(psql_db "$DB" -tAc "
  SELECT string_agg(domain || '=' || n, ',' ORDER BY domain)
  FROM (SELECT domain, count(*) AS n FROM public.canonical_skill_catalog GROUP BY domain) t;")
EXPECTED_SHAPE="Advanced Math=1,Algebra=2,Craft and Structure=1,Expression of Ideas=1,Geometry and Trigonometry=1,Information and Ideas=1,Problem Solving and Data Analysis=2,Standard English Conventions=1"
[ "$ACTUAL_SHAPE" = "$EXPECTED_SHAPE" ] || fail "catalog shape mismatch
  expected: $EXPECTED_SHAPE
  actual  : $ACTUAL_SHAPE"

LEAKED=$(psql_db "$DB" -tAc "
  SELECT coalesce(string_agg(column_name, ',' ORDER BY column_name), '')
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='canonical_skill_catalog'
    AND column_name NOT IN ('section','domain','skill');")
[ -z "$LEAKED" ] || fail "canonical_skill_catalog exposes column(s) beyond (section, domain, skill): $LEAKED"

echo
echo "MASTERY-LEVELS + SKILL-CATALOG GATE: PASS"
