#!/usr/bin/env bash
# ============================================================================
# QOTD shuffle-once BACKFILL gates (SCL-258)
# ============================================================================
# @spec [Karl's rulings 2026-10-28 on "QOTD: shuffle answer choices once at scheduling":
#   backfill: today and every past date get the identity order with the letter equal to the
#   canonical key; future rows get the shuffle from qotd_shuffled_option_order; use whatever
#   qotd_today() is live when the migration is applied] | @implemented [2026-10-28]
#
# plain English: builds a throwaway database from every migration BEFORE the shuffle migration,
# schedules rows the way production holds them (two past days, today, three future days, one a
# grid-in) with no order, applies 20261123000000_qotd_shuffle_once.sql, and asserts:
#   B-01 past days and today: option_order = the authored keys, letter = the canonical key;
#   B-02 future days: option_order = qotd_shuffled_option_order(...), letter derived from it, and
#        at least one future multiple-choice day really moved (presence before absence);
#   B-03 the grid-in: '{}' and NULL;
#   B-04 re-applying the migration succeeds and changes nothing.
# Prints 'QOTD SHUFFLE BACKFILL GATES: PASS' on success; any failure exits non-zero naming its gate.
set -uo pipefail
export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGPASSWORD="${PGPASSWORD:-postgres}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
DB="${QOTD_BACKFILL_DB:-qotd_shuffle_backfill}"
SHUF="supabase/migrations/20261123000000_qotd_shuffle_once.sql"
SHUF_BASE="$(basename "$SHUF")"

die() { echo "QOTD_SHUFFLE_BACKFILL_FAILED: $1"; exit 1; }

psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null || die "cannot create $DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" >/dev/null <<'SQL' || die "bootstrap failed"
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT NULL::uuid $f$;
SQL

# Every migration before the shuffle migration, in the pipeline's sorted order.
for f in supabase/migrations/*.sql; do
  b="$(basename "$f")"
  [[ "$b" < "$SHUF_BASE" ]] || break
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >/dev/null 2>&1 || die "pipeline failed at $f"
done

# Production's shape before the migration: rows with no order. Authored order A-D; the correct
# key varies so "letter = canonical key" is not satisfied by a constant.
psql -v ON_ERROR_STOP=1 -q -d "$DB" >/dev/null <<'SQL' || die "seed failed"
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer,
   explanation, status, published_at, item_type)
SELECT format('SATM1BF%s', lpad(n::text, 4, '0')), 'M', 1, 'Algebra', ARRAY['GATE'], 1,
       format('Backfill stem %s', n),
       '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
       (ARRAY['A','B','C','D'])[(n % 4) + 1], 'x', 'published', now(), 'mcq'
  FROM generate_series(1, 6) AS n;
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, options, correct_answer,
   correct_variants, explanation, status, published_at, item_type)
VALUES ('SATM1BFGRID', 'M', 1, 'Algebra', ARRAY['GATE'], 1, 'Grid stem', '[]'::jsonb, '7',
        ARRAY['7'], 'x', 'published', now(), 'grid_in');
INSERT INTO public.qotd_schedule (qotd_date, question_id) VALUES
  (public.qotd_today() - 2, 'SATM1BF0001'),
  (public.qotd_today() - 1, 'SATM1BF0002'),
  (public.qotd_today(),     'SATM1BF0003'),
  (public.qotd_today() + 1, 'SATM1BF0004'),
  (public.qotd_today() + 2, 'SATM1BF0005'),
  (public.qotd_today() + 3, 'SATM1BF0006'),
  (public.qotd_today() + 4, 'SATM1BFGRID');
SQL

psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$SHUF" >/dev/null 2>&1 || die "the shuffle migration failed to apply over scheduled rows"

ASSERT_SQL="$(cat <<'SQL'
DO $$
DECLARE r record; v_moved integer := 0;
BEGIN
  FOR r IN SELECT s.qotd_date, s.question_id, s.option_order, s.correct_display_letter,
                  q.options, q.correct_answer, q.item_type
             FROM public.qotd_schedule s JOIN public.questions q ON q.id = s.question_id
            WHERE q.id LIKE 'SATM1BF%' LOOP
    IF r.item_type <> 'mcq' THEN
      IF r.option_order <> '{}' OR r.correct_display_letter IS NOT NULL THEN
        RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: B-03 grid-in % got an order or a letter', r.qotd_date;
      END IF;
    ELSIF r.qotd_date <= public.qotd_today() THEN
      IF r.option_order IS DISTINCT FROM '{A,B,C,D}'::text[] THEN
        RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: B-01 past or today % was reshuffled (%)', r.qotd_date, r.option_order;
      END IF;
      IF r.correct_display_letter IS DISTINCT FROM r.correct_answer THEN
        RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: B-01 past or today % letter % is not the canonical key %',
          r.qotd_date, r.correct_display_letter, r.correct_answer;
      END IF;
    ELSE
      IF r.option_order IS DISTINCT FROM public.qotd_shuffled_option_order(r.options, r.qotd_date, r.question_id) THEN
        RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: B-02 future % is not the shuffle helper''s order', r.qotd_date;
      END IF;
      IF r.correct_display_letter IS DISTINCT FROM public.qotd_display_letter(r.option_order, r.correct_answer) THEN
        RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: B-02 future % letter is not derived from its order', r.qotd_date;
      END IF;
      IF r.option_order <> '{A,B,C,D}' THEN v_moved := v_moved + 1; END IF;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.qotd_schedule WHERE question_id LIKE 'SATM1BF%') <> 7 THEN
    RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: expected the 7 seeded rows';
  END IF;
  IF v_moved = 0 THEN
    RAISE EXCEPTION 'QOTD_SHUFFLE_BACKFILL_FAILED: B-02 no future day was shuffled (presence)';
  END IF;
END $$;
SQL
)"
OUT="$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "$ASSERT_SQL" 2>&1)" || { echo "$OUT"; die "assertions failed after the first apply"; }
echo "  OK B-01 past and today: identity order, letter = canonical key"
echo "  OK B-02 future: the shuffle helper's order and derived letter (at least one moved)"
echo "  OK B-03 grid-in: '{}' and NULL"

BEFORE="$(psql -qtAX -d "$DB" -c "SELECT md5(string_agg(qotd_date || ':' || option_order::text || ':' || coalesce(correct_display_letter, '-'), ',' ORDER BY qotd_date)) FROM public.qotd_schedule")"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$SHUF" >/dev/null 2>&1 || die "B-04 re-applying the migration failed"
AFTER="$(psql -qtAX -d "$DB" -c "SELECT md5(string_agg(qotd_date || ':' || option_order::text || ':' || coalesce(correct_display_letter, '-'), ',' ORDER BY qotd_date)) FROM public.qotd_schedule")"
[ "$BEFORE" = "$AFTER" ] || die "B-04 re-applying the migration changed stored orders"
OUT="$(psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "$ASSERT_SQL" 2>&1)" || { echo "$OUT"; die "assertions failed after the re-apply"; }
echo "  OK B-04 re-apply succeeds and changes nothing"

psql -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1
echo "QOTD SHUFFLE BACKFILL GATES: PASS"
