-- ===========================================================================
-- QOTD: the answer choices are shuffled ONCE, when a day is scheduled, and that order (with its
-- correct letter) is stored and served everywhere.
-- LYCEON-MIGRATION-REVIEWED
-- ===========================================================================
-- @spec [owner brief "QOTD: shuffle answer choices once at scheduling" (Karl, 2026-10-28) and
--        Karl's Step 0 rulings of the same day: (1) the shuffle runs in the database inside
--        qotd_schedule_insert through ONE helper, qotd_shuffled_option_order, which also does the
--        backfill; no TypeScript shuffle, no caller-passed order; (2) store the letter,
--        correct_display_letter, written by the database in the same insert from the order it
--        just computed; both columns write-once under the BEFORE UPDATE raise pattern; (3) seeded,
--        no secret: Fisher-Yates driven by sha256(qotd_date || question_id) bytes, no modulo bias;
--        backfill: today and every past date get the identity order, future rows get the shuffle,
--        using whatever qotd_today() is live when this is applied; SCL-258]
-- @implemented [2026-10-28]
--
-- plain English:
--   * qotd_schedule.option_order: the canonical option keys in the order the day shows them,
--     e.g. {C,A,D,B}. '{}' for a grid-in.
--   * qotd_schedule.correct_display_letter: the letter the correct option has in that order
--     ('A' for the first shown, ...). NULL for a grid-in.
--   * qotd_option_keys(options): the keys in authored order, exactly as the server's
--     parseCanonicalMcOptions reads them (a key in A-D with non-empty text, in array order).
--   * qotd_shuffled_option_order(options, date, question_id): Fisher-Yates over those keys,
--     driven by the bytes of sha256(qotd_date::text || question_id). Each swap index j in [0, i]
--     takes the next byte b and REJECTS it unless b < 256 - (256 % (i + 1)), so every j is
--     exactly equally likely (no modulo bias); when the 32 bytes run out, the next block is
--     sha256 of the previous one. Deterministic: the same date and question always give the
--     same order, so "the same database state always yields the same schedule" stays true.
--   * qotd_display_letter(order, correct_answer): the letter of the correct key's position.
--   * qotd_schedule_insert: unchanged contract (same arguments, same return values); it now writes
--     the order and the letter itself. A caller cannot pass either.
--   * qotd_question_for / qotd_archive: also return option_order and correct_display_letter, so
--     every surface letters from the stored order (shared/qotd/projection.ts qotdServedChoices).
--   * qotd_schedule_order_on_insert (BEFORE INSERT): every insert path, a direct INSERT included,
--     gets the order and letter from the same helper; a NULL is filled, and a caller-supplied
--     value that differs is refused (42501). So no caller can pass an order.
--   * qotd_schedule_no_update: any UPDATE of a qotd_schedule row raises. Rows stay insert-once;
--     qotd_schedule_release still deletes an UPCOMING row (never today or the past), and the day
--     is refilled through the insert, which shuffles again (nothing about it was posted).
--
-- Backfill (rows already scheduled): today and every past date (<= qotd_today() at apply time)
-- get the identity order, so no posted day changes; their letter is the position of the
-- canonical key, which for an A-B-C-D authored order is the key itself. Future rows get the
-- shuffle. Grid-ins get '{}' and NULL.
--
-- edge cases: a multiple-choice row whose correct key is not among its options would have an
-- order and no letter; the CHECK below refuses it, so such data stops this migration loudly
-- rather than serving a day with no answer. Re-running: the backfill touches only rows whose
-- option_order is NULL, and is skipped once the write-once trigger exists.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply.
--
-- rollback (prod has served from the stored order once this is live; rolling back returns every
-- surface to canonical order and changes the letters of any shuffled day not yet past):
--   DROP TRIGGER IF EXISTS qotd_schedule_no_update ON public.qotd_schedule;
--   DROP FUNCTION IF EXISTS public.qotd_schedule_no_update();
--   DROP TRIGGER IF EXISTS qotd_schedule_order_on_insert ON public.qotd_schedule;
--   DROP FUNCTION IF EXISTS public.qotd_schedule_order_on_insert();
--   -- recreate qotd_question_for, qotd_archive and qotd_schedule_insert from
--   -- 20261020000000_qotd_schema.sql (DROP the two readers first: their return type changes)
--   ALTER TABLE public.qotd_schedule DROP COLUMN IF EXISTS option_order,
--                                     DROP COLUMN IF EXISTS correct_display_letter;
--   DROP FUNCTION IF EXISTS public.qotd_display_letter(text[], text);
--   DROP FUNCTION IF EXISTS public.qotd_shuffled_option_order(jsonb, date, text);
--   DROP FUNCTION IF EXISTS public.qotd_option_keys(jsonb);
-- ===========================================================================

BEGIN;

ALTER TABLE public.qotd_schedule
  ADD COLUMN IF NOT EXISTS option_order text[],
  ADD COLUMN IF NOT EXISTS correct_display_letter text;

-- The option keys in authored order, read exactly as parseCanonicalMcOptions reads them.
CREATE OR REPLACE FUNCTION public.qotd_option_keys(p_options jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  WITH arr AS (
    SELECT CASE
             WHEN jsonb_typeof(p_options) = 'array' THEN p_options
             WHEN jsonb_typeof(p_options) = 'string'
                  AND left(btrim(p_options #>> '{}'), 1) = '[' THEN (p_options #>> '{}')::jsonb
             ELSE '[]'::jsonb
           END AS a
  )
  SELECT COALESCE(array_agg(upper(btrim(e ->> 'key')) ORDER BY ord), '{}'::text[])
    FROM arr, jsonb_array_elements(arr.a) WITH ORDINALITY AS x(e, ord)
   WHERE jsonb_typeof(e) = 'object'
     AND upper(btrim(COALESCE(e ->> 'key', ''))) IN ('A', 'B', 'C', 'D')
     AND btrim(COALESCE(e ->> 'text', '')) <> ''
$fn$;

-- THE shuffle (Karl, 2026-10-28): seeded Fisher-Yates, sha256(qotd_date || question_id) bytes,
-- rejection sampling. Used by qotd_schedule_insert and by the backfill below, and nowhere else.
CREATE OR REPLACE FUNCTION public.qotd_shuffled_option_order(
  p_options jsonb, p_qotd_date date, p_question_id text
)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_order text[] := public.qotd_option_keys(p_options);
  v_n     integer := COALESCE(array_length(v_order, 1), 0);
  v_bytes bytea := sha256(convert_to(p_qotd_date::text || p_question_id, 'UTF8'));
  v_pos   integer := 0;
  v_i     integer;
  v_j     integer;
  v_b     integer;
  v_limit integer;
  v_tmp   text;
BEGIN
  -- 0-based Fisher-Yates: for i from n-1 down to 1, swap position i with a uniform j in [0, i].
  FOR v_i IN REVERSE (v_n - 1)..1 LOOP
    v_limit := 256 - (256 % (v_i + 1));
    LOOP
      IF v_pos >= 32 THEN
        v_bytes := sha256(v_bytes);
        v_pos := 0;
      END IF;
      v_b := get_byte(v_bytes, v_pos);
      v_pos := v_pos + 1;
      EXIT WHEN v_b < v_limit;
    END LOOP;
    v_j := v_b % (v_i + 1);
    -- arrays are 1-based
    v_tmp := v_order[v_i + 1];
    v_order[v_i + 1] := v_order[v_j + 1];
    v_order[v_j + 1] := v_tmp;
  END LOOP;
  RETURN v_order;
END
$fn$;

-- The letter the correct key has in a given order; NULL when it is not there (or a grid-in).
CREATE OR REPLACE FUNCTION public.qotd_display_letter(p_order text[], p_correct_answer text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
           WHEN array_position(p_order, upper(btrim(COALESCE(p_correct_answer, '')))) IS NULL THEN NULL
           ELSE chr(64 + array_position(p_order, upper(btrim(p_correct_answer))))
         END
$fn$;

-- Backfill the rows already scheduled (skipped on a re-run: the trigger below forbids UPDATE).
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'qotd_schedule_no_update'
       AND tgrelid = 'public.qotd_schedule'::regclass
  ) THEN
    UPDATE public.qotd_schedule s
       SET option_order = CASE
                            WHEN q.item_type <> 'mcq' THEN '{}'::text[]
                            WHEN s.qotd_date <= public.qotd_today() THEN public.qotd_option_keys(q.options)
                            ELSE public.qotd_shuffled_option_order(q.options, s.qotd_date, s.question_id)
                          END
      FROM public.questions q
     WHERE q.id = s.question_id
       AND s.option_order IS NULL;

    UPDATE public.qotd_schedule s
       SET correct_display_letter = public.qotd_display_letter(s.option_order, q.correct_answer)
      FROM public.questions q
     WHERE q.id = s.question_id
       AND q.item_type = 'mcq'
       AND s.correct_display_letter IS NULL;
  END IF;
END
$do$;

ALTER TABLE public.qotd_schedule ALTER COLUMN option_order SET NOT NULL;

ALTER TABLE public.qotd_schedule DROP CONSTRAINT IF EXISTS qotd_schedule_display_letter_check;
ALTER TABLE public.qotd_schedule
  ADD CONSTRAINT qotd_schedule_display_letter_check CHECK (
    correct_display_letter IS NULL OR correct_display_letter IN ('A', 'B', 'C', 'D')
  );
ALTER TABLE public.qotd_schedule DROP CONSTRAINT IF EXISTS qotd_schedule_order_letter_check;
ALTER TABLE public.qotd_schedule
  ADD CONSTRAINT qotd_schedule_order_letter_check CHECK (
    cardinality(option_order) <= 4
    AND (cardinality(option_order) = 0) = (correct_display_letter IS NULL)
  );

COMMENT ON COLUMN public.qotd_schedule.option_order IS
  'The canonical option keys in the order this day shows them, written once at scheduling by qotd_schedule_insert (qotd_shuffled_option_order). Identity for days scheduled before 2026-10-28 that had arrived. ''{}'' for a grid-in. SCL-258.';
COMMENT ON COLUMN public.qotd_schedule.correct_display_letter IS
  'The correct option''s letter in option_order, written by the database in the same insert. NULL for a grid-in. SCL-258.';

-- Write-once: any UPDATE raises (the repo''s insert-once pattern, e.g. audit_logs_no_mutate).
CREATE OR REPLACE FUNCTION public.qotd_schedule_no_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  RAISE EXCEPTION 'qotd_schedule is write-once: % cannot be changed (SCL-258)', OLD.qotd_date
    USING ERRCODE = '42501';
END
$fn$;

DROP TRIGGER IF EXISTS qotd_schedule_no_update ON public.qotd_schedule;
CREATE TRIGGER qotd_schedule_no_update
  BEFORE UPDATE ON public.qotd_schedule
  FOR EACH ROW EXECUTE FUNCTION public.qotd_schedule_no_update();

-- Every insert path, not only qotd_schedule_insert: the order and the letter are computed here
-- from the one helper. A NULL is filled; a caller-supplied value that differs is REFUSED (42501),
-- so no caller can choose an order (Karl, 2026-10-28: "never from a caller").
CREATE OR REPLACE FUNCTION public.qotd_schedule_order_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_q      record;
  v_order  text[];
  v_letter text;
BEGIN
  SELECT q.item_type, q.options, q.correct_answer INTO v_q
    FROM public.questions q WHERE q.id = NEW.question_id;
  IF NOT FOUND THEN
    RETURN NEW;  -- the foreign key refuses the row
  END IF;
  IF v_q.item_type = 'mcq' THEN
    v_order  := public.qotd_shuffled_option_order(v_q.options, NEW.qotd_date, NEW.question_id);
    v_letter := public.qotd_display_letter(v_order, v_q.correct_answer);
  ELSE
    v_order  := '{}'::text[];
    v_letter := NULL;
  END IF;
  IF (NEW.option_order IS NOT NULL AND NEW.option_order IS DISTINCT FROM v_order)
     OR (NEW.correct_display_letter IS NOT NULL AND NEW.correct_display_letter IS DISTINCT FROM v_letter) THEN
    RAISE EXCEPTION 'qotd_schedule: the option order and letter are the database''s, not the caller''s (SCL-258)'
      USING ERRCODE = '42501';
  END IF;
  NEW.option_order := v_order;
  NEW.correct_display_letter := v_letter;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS qotd_schedule_order_on_insert ON public.qotd_schedule;
CREATE TRIGGER qotd_schedule_order_on_insert
  BEFORE INSERT ON public.qotd_schedule
  FOR EACH ROW EXECUTE FUNCTION public.qotd_schedule_order_on_insert();

-- The insert: same arguments, same results; the order and the letter are the database's.
CREATE OR REPLACE FUNCTION public.qotd_schedule_insert(p_date date, p_question_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = p_date) THEN
    RETURN 'exists';
  END IF;
  IF NOT public.qotd_question_is_eligible(p_question_id) THEN
    RETURN 'ineligible';
  END IF;
  INSERT INTO public.qotd_schedule (qotd_date, question_id, option_order, correct_display_letter)
  SELECT p_date, q.id, o.ord,
         CASE WHEN q.item_type = 'mcq' THEN public.qotd_display_letter(o.ord, q.correct_answer) END
    FROM public.questions q
   CROSS JOIN LATERAL (
     SELECT CASE
              WHEN q.item_type = 'mcq'
                THEN public.qotd_shuffled_option_order(q.options, p_date, q.id)
              ELSE '{}'::text[]
            END AS ord
   ) o
   WHERE q.id = p_question_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 1 THEN
    RETURN 'inserted';
  END IF;
  -- A concurrent run took the date or the question between the checks and the insert.
  IF EXISTS (SELECT 1 FROM public.qotd_schedule WHERE qotd_date = p_date) THEN
    RETURN 'exists';
  END IF;
  RETURN 'taken';
END
$$;

-- The readers return the stored order and letter (their return type changes, so DROP first).
DROP FUNCTION IF EXISTS public.qotd_question_for(date);
CREATE FUNCTION public.qotd_question_for(p_date date)
RETURNS TABLE (
  qotd_date date,
  question_id text,
  section text,
  domain text,
  skill_codes text[],
  difficulty integer,
  item_type text,
  stem text,
  passage text,
  options jsonb,
  correct_answer text,
  correct_variants text[],
  explanation text,
  attempts integer,
  correct integer,
  option_order text[],
  correct_display_letter text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.qotd_date, q.id, q.section, q.domain, q.skill_codes, q.difficulty, q.item_type,
         q.stem, q.passage, q.options, q.correct_answer, q.correct_variants, q.explanation,
         COALESCE(st.attempts, 0), COALESCE(st.correct, 0),
         s.option_order, s.correct_display_letter
    FROM public.qotd_schedule s
    JOIN public.questions q ON q.id = s.question_id
    LEFT JOIN public.qotd_daily_stats st ON st.qotd_date = s.qotd_date
   WHERE s.qotd_date = COALESCE(p_date, public.qotd_today())
     AND s.qotd_date <= public.qotd_today()
     AND q.status = 'published'
     AND (q.issue_flags IS NULL OR array_length(q.issue_flags, 1) IS NULL)
$$;

DROP FUNCTION IF EXISTS public.qotd_archive();
CREATE FUNCTION public.qotd_archive()
RETURNS TABLE (
  qotd_date date,
  question_id text,
  section text,
  domain text,
  skill_codes text[],
  difficulty integer,
  item_type text,
  stem text,
  passage text,
  options jsonb,
  correct_answer text,
  correct_variants text[],
  explanation text,
  attempts integer,
  correct integer,
  option_order text[],
  correct_display_letter text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  -- Counts included so an archive page built from this shows the same stat the API does.
  SELECT s.qotd_date, q.id, q.section, q.domain, q.skill_codes, q.difficulty, q.item_type,
         q.stem, q.passage, q.options, q.correct_answer, q.correct_variants, q.explanation,
         COALESCE(st.attempts, 0), COALESCE(st.correct, 0),
         s.option_order, s.correct_display_letter
    FROM public.qotd_schedule s
    JOIN public.questions q ON q.id = s.question_id
    LEFT JOIN public.qotd_daily_stats st ON st.qotd_date = s.qotd_date
   WHERE s.qotd_date < public.qotd_today()
     AND q.status = 'published'
     AND (q.issue_flags IS NULL OR array_length(q.issue_flags, 1) IS NULL)
   ORDER BY s.qotd_date
$$;

REVOKE ALL ON FUNCTION public.qotd_option_keys(jsonb)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_shuffled_option_order(jsonb, date, text)    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_display_letter(text[], text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_schedule_no_update()                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_schedule_order_on_insert()                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_schedule_insert(date, text)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_question_for(date)                         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.qotd_archive()                                  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qotd_option_keys(jsonb)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_shuffled_option_order(jsonb, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_display_letter(text[], text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_schedule_insert(date, text)              TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_question_for(date)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.qotd_archive()                                TO service_role;

COMMIT;
