-- ============================================================================
-- Section vocabulary — canonicalise practice_sessions.filters
-- ============================================================================
-- @spec [Doc-05B_V1.0 §4.2 canonical section codes; questions_section_check]
-- @implemented [2026-09-02]
--
-- plain English: `practice_sessions.filters -> 'session_spec' -> 'sections'` is the one
-- place in this database where a section value is stored WITHOUT a CHECK constraint,
-- because it lives inside jsonb. Every relational section column is
-- `CHECK (section = ANY (ARRAY['M','RW']))` — sixteen of them — and all sixteen are
-- clean. This one field held the display spelling "Math" alongside the canonical "RW",
-- in the same array, for thirteen sessions.
--
-- The route that wrote it (server/routes/practice-canonical.ts) now writes canonical
-- codes, so this migration is a one-time rewrite of the rows written before that
-- change. There is deliberately NO tolerance code on the read side: after this runs,
-- a non-canonical value in this field is a defect, not an input to be absorbed.
--
-- Safety. Measured against production on 2026-09-02, before writing this file:
--   status='abandoned', sections=["Math"]  11 rows
--   status='abandoned', sections=["RW"]     1 row
--   status='completed', sections=["RW"]     1 row
--   active/created with a session_spec       0 rows
-- Every affected row is on a terminal session. ACTIVE_DB_STATUSES is
-- ('active','created') (practice-canonical.ts:251), so no resume, next-item or state
-- path reads any of these rows. The two ["RW"] rows are already canonical and this
-- statement does not touch them.
--
-- Idempotent: the WHERE clause matches only non-canonical elements, so a second run
-- updates zero rows. Re-runnable safely.
--
-- expected outcome: 11 rows updated; afterwards zero practice_sessions rows contain a
-- sections element outside ('M','RW').
-- edge cases: a sections array holding BOTH a canonical and a non-canonical element is
-- handled — the rewrite maps element by element rather than replacing the whole array.
-- ============================================================================

BEGIN;

-- Pre-state, recorded in the migration output so the applier sees what it is changing.
DO $$
DECLARE
  v_before jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_before
  FROM (
    SELECT filters -> 'session_spec' -> 'sections' AS sections,
           status,
           count(*) AS n
    FROM public.practice_sessions
    WHERE filters -> 'session_spec' -> 'sections' IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  ) t;
  RAISE NOTICE 'session_spec.sections BEFORE: %', v_before;
END $$;

UPDATE public.practice_sessions AS ps
SET filters = jsonb_set(
      ps.filters,
      '{session_spec,sections}',
      (
        SELECT jsonb_agg(
                 CASE
                   WHEN upper(elem #>> '{}') IN ('M', 'MATH') THEN to_jsonb('M'::text)
                   WHEN upper(elem #>> '{}') = 'RW' THEN to_jsonb('RW'::text)
                   ELSE elem
                 END
                 ORDER BY ord
               )
        FROM jsonb_array_elements(ps.filters -> 'session_spec' -> 'sections')
             WITH ORDINALITY AS e(elem, ord)
      ),
      false
    )
WHERE jsonb_typeof(ps.filters -> 'session_spec' -> 'sections') = 'array'
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(ps.filters -> 'session_spec' -> 'sections') AS s(v)
    WHERE s.v NOT IN ('M', 'RW')
  );

-- Post-state, and a hard assertion. If any non-canonical element survives, the whole
-- migration rolls back rather than reporting success over a partial rewrite.
DO $$
DECLARE
  v_after jsonb;
  v_bad   bigint;
BEGIN
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_after
  FROM (
    SELECT filters -> 'session_spec' -> 'sections' AS sections,
           status,
           count(*) AS n
    FROM public.practice_sessions
    WHERE filters -> 'session_spec' -> 'sections' IS NOT NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  ) t;
  RAISE NOTICE 'session_spec.sections AFTER: %', v_after;

  SELECT count(*) INTO v_bad
  FROM public.practice_sessions ps,
       LATERAL jsonb_array_elements_text(ps.filters -> 'session_spec' -> 'sections') AS s(v)
  WHERE jsonb_typeof(ps.filters -> 'session_spec' -> 'sections') = 'array'
    AND s.v NOT IN ('M', 'RW');

  IF v_bad <> 0 THEN
    RAISE EXCEPTION
      'SESSION_SPEC_SECTIONS_NOT_CANONICAL: % element(s) outside (M, RW) remain', v_bad;
  END IF;
END $$;

COMMIT;
