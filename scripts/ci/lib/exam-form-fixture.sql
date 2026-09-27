-- ============================================================================
-- Shared CI fixture: a composition-valid DRAFT full-length form (Doc 04A §5.1/
-- §5.2) built from fresh synthetic PUBLISHED questions.
-- ============================================================================
-- @spec [Doc-04A_V2.2, §5.1, §5.2, §6.3; Doc-04B_V4.3, §13.1 as amended by
--        SCL-121] | @implemented [2026-09-24]
--
-- plain English: defines pg_temp.exam_fixture_make_form(form, tag, T_rw, T_m).
--   One session-local helper, included (\ir) by every gate that needs a form:
--   scripts/ci/exam-runtime-schema-gates.sql (E3), scripts/ci/scoring-engine-
--   gates.sql and the scoring parity harness (E4). Extracted verbatim from the
--   E3 gate's e3_make_form so the fixture exists once.
--
-- Fixture facts other gates rely on (do not change without updating them):
--   * question id  = 'SAT' || section || '1' || tag(2) || mcode(2) || pos(2),
--     mcode ∈ {'01','2A','2B'} for module {'1','2A','2B'}; pos = ordinal.
--   * ordinal p within a module: difficulty 1 for p < easy, 2 for the next
--     `medium`, else 3 (13.1 blueprint counts), so the first items are easy.
--   * Math grid_in items are the first `grid` ordinals of the module.
--   * correct answers: mcq 'A'; grid_in correct_variants = ARRAY['1'].
--   * the form is DRAFT, bound to p_version, thresholds (p_rw, p_m).
-- ============================================================================

CREATE FUNCTION pg_temp.exam_fixture_make_form(p_form uuid, p_tag text,
                                               p_threshold_rw int DEFAULT 19,
                                               p_threshold_m  int DEFAULT 14,
                                               p_version text DEFAULT 'v1.0')
RETURNS void
LANGUAGE plpgsql AS $f$
DECLARE
  m record; p int; v_id text; v_diff int; v_dom text; v_grid boolean; acc int; k int;
BEGIN
  INSERT INTO public.test_forms (id, name, test_kind, status, score_table_version,
    routing_threshold_rw, routing_threshold_m, break_duration_ms,
    rw_module1_ms, rw_module2_ms, m_module1_ms, m_module2_ms)
  VALUES (p_form, 'exg fixture ' || p_tag, 'full_length', 'draft', p_version,
          p_threshold_rw, p_threshold_m, 600000, 1920000, 1920000, 2100000, 2100000);

  FOR m IN
    SELECT * FROM (VALUES
      ('RW', '1',  '01', 27, ARRAY[8, 11, 8],  0, ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'], ARRAY[7, 8, 5, 7]),
      ('RW', '2A', '2A', 27, ARRAY[14, 9, 4],  0, ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'], ARRAY[7, 7, 6, 7]),
      ('RW', '2B', '2B', 27, ARRAY[4, 9, 14],  0, ARRAY['Information and Ideas','Craft and Structure','Expression of Ideas','Standard English Conventions'], ARRAY[7, 7, 6, 7]),
      ('M',  '1',  '01', 22, ARRAY[7, 9, 6],   3, ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'], ARRAY[8, 7, 4, 3]),
      ('M',  '2A', '2A', 22, ARRAY[11, 8, 3],  8, ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'], ARRAY[7, 8, 3, 4]),
      ('M',  '2B', '2B', 22, ARRAY[3, 8, 11],  8, ARRAY['Algebra','Advanced Math','Problem Solving and Data Analysis','Geometry and Trigonometry'], ARRAY[7, 8, 3, 4])
    ) AS t(section, module, mcode, total, diffs, grid, doms, domn)
  LOOP
    FOR p IN 0 .. m.total - 1 LOOP
      v_diff := CASE WHEN p < m.diffs[1] THEN 1 WHEN p < m.diffs[1] + m.diffs[2] THEN 2 ELSE 3 END;
      acc := 0; v_dom := NULL;
      FOR k IN 1 .. 4 LOOP
        acc := acc + m.domn[k];
        IF v_dom IS NULL AND p < acc THEN v_dom := m.doms[k]; END IF;
      END LOOP;
      v_grid := p < m.grid;
      v_id := 'SAT' || m.section || '1' || p_tag || m.mcode || lpad(p::text, 2, '0');
      INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty, stem,
                                    options, correct_answer, explanation, status, item_type,
                                    correct_variants, published_at)
      VALUES (v_id, m.section, 1, v_dom, ARRAY['exg-fixture'], v_diff, 'exg fixture',
              CASE WHEN v_grid THEN '[]'::jsonb ELSE '["A","B","C","D"]'::jsonb END,
              'A', 'exg fixture', 'published',
              CASE WHEN v_grid THEN 'grid_in' ELSE 'mcq' END,
              CASE WHEN v_grid THEN ARRAY['1'] ELSE NULL END, now());
      INSERT INTO public.test_form_items (test_form_id, section, module, ordinal, question_id)
      VALUES (p_form, m.section, m.module, p, v_id);
    END LOOP;
  END LOOP;
END $f$;
