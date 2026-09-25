-- ============================================================================
-- E7a — exam shell server: item workspace, resume position, forms list, and
--       the 04C report read with its disclosure binding
-- ============================================================================
-- @spec [Doc-04A_V2.2, §4 #9 (resume returns the same state), §5, §8.3
--        (heartbeat), §10.2 (payload untouched), §15.1 (state read), §16]
--       [Doc-04C_V1.0, §5.3 (derivation), §8-§11 (payloads), §15.1-§15.2
--        (disclosure is payload data, bound per scoring version), §16.3
--        (listing is 04A's)]
--       [Doc-04B_V4.3, §17.1 (disclosure text, verbatim)]
--       [Doc-05E, INV-05E-04 (free-text boundary: notes are NOT stored)]
--       [SCL-145 workspace, SCL-146 heartbeat ordinal, SCL-147 forms list,
--        SCL-148 disclosure conflict 04B §17.1 vs 04C §15.3, SCL-149 04C §9.2]
-- @implemented [2026-09-25]
--
-- plain English: the three server pieces the exam shell (E7b) cannot be built
--   without.
--   * test_session_item_workspace — per served item: marked-for-review,
--     eliminated options (the SAME opaque tokens as selection, validated
--     against the item's token map), passage highlights as code-point offsets.
--     No note text: student-authored free text needs counsel review before
--     anything retains it (05E INV-05E-04), and anonymize would retain this.
--   * test_session_sections.current_module / current_ordinal — where the
--     student was, written by an optional `ordinal` on the heartbeat, read
--     back in the session state only while it names the active module.
--   * exam_list_forms — published forms (and ones the student already sat)
--     with the caller's latest session on each.
--   * score_disclosure_versions (04C §15.2 DDL) seeded for v1.0 with 04B
--     §17.1's text verbatim, and exam_report_source — the one read the 04C
--     report derives from. Derivation and serialisation are TypeScript.
--
-- DECISION LOG (owner rulings 2026-09-25 on the E7 pushback; PR decision log)
--  D1 Workspace is its OWN table (RULED), keyed (session, section, module,
--     ordinal) with a CASCADE FK to test_session_items: the shuffle pin stays
--     write-once (service_role still has no UPDATE on test_session_items).
--  D2 Eliminated ids must each be a key of the item's option_token_map
--     (RULED) — a canonical letter is refused, so elimination cannot drift off
--     the shuffle; a grid-in takes none; duplicates are refused.
--  D3 Notes are scoped out (RULED, 05E INV-05E-04). Highlights are
--     {start, end} offsets in Unicode code points (char_length), 0 <= start <
--     end <= char_length(passage); an item with no passage takes none.
--  D4 Writes to a submitted module are refused (409 module_submitted), as
--     answers are; an item not yet served has no workspace (409
--     session_item_mapping_missing).
--  D5 Resume position via the heartbeat (RULED): exam_heartbeat gains
--     p_ordinal DEFAULT NULL (a new signature; the 3-argument function is
--     dropped). The ordinal must be an item of the ACTIVE module (else 400
--     invalid_request). The physical module is stored beside it so a stale
--     Module 1 position is never read as a Module 2 one; the state read
--     exposes only the ordinal, never the module id (§9.3).
--  D6 04C's failure ledger (04D) does not exist. Until it does, the "open
--     failure" input of §5.3 is the session's exam_runtime_outbox row in its
--     §5.7 dead-letter state ('failed', retry budget exhausted, no score run).
--     incident_reference = 'INC-' || first 8 hex of that outbox id (§10.3).
--  D7 exam_report_source is a pure READ: it does not touch or advance the
--     session. A past-grace session nobody has touched reads not_completed
--     with resumable = false until the next touch or sweep finalises it.
--  D8 The disclosure row is seeded with 04B §17.1 verbatim (RULED). That text
--     contains "College Board score" and matches none of 04C §15.3's three
--     templates, which §15.3 forbids / requires — SCL-148. The table is how
--     Karl varies it later.
--  D9 full_text_url is seeded '/legal/score-disclosure'. No legal document by
--     that slug exists yet; authoring it is Content / Legal's (04C §15.2).
--  D10 The cascade is redefined a THIRD time (E6b, now E7a) only to name and
--     count the workspace table. Hand-editing a 20 kB function per new child
--     table is becoming a pattern; a helper that deletes and counts a declared
--     list of exam children would end it. Not built here (owner note).
--
-- OWNER-RUN: `supabase db push --include-all` (sorts before 20261001000000).
--   Genesis-extending; genesis-fresh-apply covers it. NOT APPLIED TO PROD.
--
-- ROLLBACK (INV-06): transactional. Inverse, in order:
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   re-apply execute_account_deletion_cascade from 20260930080000 and
--     exam_session_body from 20260930070000;
--   DROP FUNCTION public.exam_report_source(uuid, uuid);
--   DROP FUNCTION public.exam_list_forms(uuid);
--   DROP FUNCTION public.exam_save_item_workspace(uuid, uuid, text, text, int, boolean, text[], jsonb);
--   DROP FUNCTION public.exam_module_workspace(uuid, uuid, text, text);
--   DROP FUNCTION public.exam_heartbeat(uuid, uuid, text, int);
--     and re-create the 3-argument exam_heartbeat from 20260930070000 with its grants;
--   ALTER TABLE public.test_session_sections DROP CONSTRAINT test_session_sections_current_position,
--     DROP COLUMN current_module, DROP COLUMN current_ordinal;
--   DROP TABLE public.test_session_item_workspace;
--   DROP TABLE public.score_disclosure_versions;
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. score_disclosure_versions — 04C §15.2 DDL, verbatim
-- ---------------------------------------------------------------------------
CREATE TABLE public.score_disclosure_versions (
  scoring_model_version text PRIMARY KEY REFERENCES public.scoring_model_versions(version),
  disclosure_version    text NOT NULL,
  summary               text NOT NULL,
  full_text_url         text NOT NULL,
  activated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  superseded_at         timestamptz NULL
);

CREATE INDEX idx_score_disclosure_versions_by_version
  ON public.score_disclosure_versions (disclosure_version);

ALTER TABLE public.score_disclosure_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.score_disclosure_versions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.score_disclosure_versions TO service_role;

-- 04B §17.1, verbatim (owner ruling D8). Variations are Founder/CTO's, through this row.
INSERT INTO public.score_disclosure_versions
  (scoring_model_version, disclosure_version, summary, full_text_url)
VALUES
  ('v1.0', 'disclosure-v1.0',
   'Lyceon-modeled SAT score. Designed to approximate Digital SAT score ranges using Lyceon''s internal scoring model. This is not an official College Board score prediction and may differ from official SAT scores by ±20-50 points or more.',
   '/legal/score-disclosure');

-- ---------------------------------------------------------------------------
-- 2. test_session_item_workspace (D1-D4)
-- ---------------------------------------------------------------------------
CREATE TABLE public.test_session_item_workspace (
  test_session_id        uuid NOT NULL,
  section                text NOT NULL CHECK (section IN ('RW', 'M')),
  module                 text NOT NULL CHECK (module IN ('1', '2A', '2B')),
  ordinal                int  NOT NULL,
  marked_for_review      boolean NOT NULL DEFAULT false,
  eliminated_option_ids  text[]  NOT NULL DEFAULT '{}',
  highlights             jsonb   NOT NULL DEFAULT '[]'::jsonb,
  updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (test_session_id, section, module, ordinal),
  FOREIGN KEY (test_session_id, section, module, ordinal)
    REFERENCES public.test_session_items (test_session_id, section, module, ordinal)
    ON DELETE CASCADE,
  CONSTRAINT test_session_item_workspace_highlights_array
    CHECK (jsonb_typeof(highlights) = 'array'),
  CONSTRAINT test_session_item_workspace_eliminated_bounded
    CHECK (cardinality(eliminated_option_ids) <= 8),
  CONSTRAINT test_session_item_workspace_highlights_bounded
    CHECK (jsonb_array_length(highlights) <= 64)
);

COMMENT ON TABLE public.test_session_item_workspace IS
  'E7a / SCL-145: the student''s per-item scratch state during a module — marked for review, eliminated options (opaque served tokens), passage highlights (code-point offsets). No free text (05E INV-05E-04). Not an answer: scoring and mastery never read it.';

ALTER TABLE public.test_session_item_workspace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.test_session_item_workspace FROM PUBLIC, anon, authenticated, service_role;
-- Server-only, as test_session_items: no student read path, no DELETE.
GRANT SELECT, INSERT, UPDATE ON TABLE public.test_session_item_workspace TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Resume position (D5)
-- ---------------------------------------------------------------------------
ALTER TABLE public.test_session_sections
  ADD COLUMN current_module  text NULL CHECK (current_module IN ('1', '2A', '2B')),
  ADD COLUMN current_ordinal int  NULL CHECK (current_ordinal >= 0),
  ADD CONSTRAINT test_session_sections_current_position
    CHECK ((current_module IS NULL) = (current_ordinal IS NULL));

-- The session read model, as E6 wrote it, plus sections[].current_ordinal.
CREATE OR REPLACE FUNCTION public.exam_session_body(p_session_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
           'session_id', s.id,
           'test_form_id', s.test_form_id,
           'state', s.state,
           'mode', s.mode,
           'active_section', s.active_section,
           'grace_expires_at', s.grace_expires_at,
           'attempt_number_for_form', s.attempt_number_for_form,
           'is_first_seen_form_attempt', s.is_first_seen_form_attempt,
           'break_remaining_ms', CASE WHEN s.state = 'section_break' THEN (
               SELECT greatest(0::bigint, exam_ms(rw.module2_submitted_at
                        + f.break_duration_ms * interval '1 millisecond' - p_now))
                 FROM test_session_sections rw
                WHERE rw.test_session_id = s.id AND rw.section = 'RW') END,
           'sections', (
             SELECT jsonb_agg(jsonb_build_object(
                      'section', sec.section,
                      'state', sec.state,
                      'remaining_ms', exam_remaining_ms(s.id, sec.section, p_now),
                      'module2_path_locked', sec.module2_path IS NOT NULL,
                      -- E7a: the resume position, only while it names the ACTIVE
                      -- module (never the physical module id itself, §9.3)
                      'current_ordinal', CASE
                        WHEN sec.state = 'module1_active' AND sec.current_module = '1'
                          THEN sec.current_ordinal
                        WHEN sec.state = 'module2_active' AND sec.current_module = '2' || sec.module2_path
                          THEN sec.current_ordinal
                      END)
                    ORDER BY CASE sec.section WHEN 'RW' THEN 1 ELSE 2 END)
               FROM test_session_sections sec WHERE sec.test_session_id = s.id))
    FROM test_sessions s JOIN test_forms f ON f.id = s.test_form_id
   WHERE s.id = p_session_id
$$;

-- @spec [Doc-04A_V2.2, §8.3; SCL-146] | @implemented [2026-09-25]
-- plain English: E6's heartbeat plus an optional resume position. The
--   position must name an item of the section's ACTIVE module; it is written
--   with the physical module so a later module never inherits it.
DROP FUNCTION public.exam_heartbeat(uuid, uuid, text);

CREATE FUNCTION public.exam_heartbeat(p_student_id uuid, p_session_id uuid, p_section text,
                                      p_ordinal int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
  v_state text;
  v_phys  text;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  PERFORM exam_fold_heartbeat(p_session_id, p_section, v_now);

  IF p_ordinal IS NOT NULL THEN
    SELECT state INTO v_state FROM test_session_sections
     WHERE test_session_id = p_session_id AND section = p_section;
    v_phys := CASE v_state
                WHEN 'module1_active' THEN '1'
                WHEN 'module2_active' THEN exam_physical_module(p_session_id, p_section, '2')
              END;
    IF v_phys IS NULL OR NOT EXISTS (
         SELECT 1 FROM test_sessions s
           JOIN test_form_items fi
             ON fi.test_form_id = s.test_form_id AND fi.section = p_section
            AND fi.module = v_phys AND fi.ordinal = p_ordinal
          WHERE s.id = p_session_id) THEN
      RETURN jsonb_build_object('status', 400, 'error', jsonb_build_object(
        'code', 'invalid_request', 'message', 'The position is not an item of the active module.'),
        'outbox_ids', v_touch->'outbox_ids');
    END IF;
    UPDATE test_session_sections
       SET current_module = v_phys, current_ordinal = p_ordinal
     WHERE test_session_id = p_session_id AND section = p_section;
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now)),
    'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Workspace read + write (D2-D4)
-- ---------------------------------------------------------------------------

-- @spec [SCL-145; Doc-04A_V2.2 §15.1 (resume returns the same state)]
-- plain English: the workspace rows of the ACTIVE module, for resume.
CREATE FUNCTION public.exam_module_workspace(p_student_id uuid, p_session_id uuid,
                                             p_section text, p_module text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now   timestamptz := clock_timestamp();
  v_touch jsonb;
  v_sec   text;
  v_phys  text;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;
  IF NOT ((p_module = '1' AND v_sec = 'module1_active') OR (p_module = '2' AND v_sec = 'module2_active')) THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', CASE
                WHEN p_module = '1' AND v_sec IN ('module1_submitted', 'module2_active', 'submitted') THEN 'module_submitted'
                WHEN p_module = '2' AND v_sec = 'submitted' THEN 'module_submitted'
                ELSE 'module_not_started' END,
      'message', 'This module is not active.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  v_phys := exam_physical_module(p_session_id, p_section, p_module);

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'ordinal', w.ordinal,
               'marked_for_review', w.marked_for_review,
               'eliminated_option_ids', to_jsonb(w.eliminated_option_ids),
               'highlights', w.highlights)
             ORDER BY w.ordinal)
        FROM test_session_item_workspace w
       WHERE w.test_session_id = p_session_id AND w.section = p_section AND w.module = v_phys),
      '[]'::jsonb)),
    'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- @spec [SCL-145] | @implemented [2026-09-25]
-- plain English: replaces one item's workspace (a full PUT, so a replay is a
--   no-op). Refuses: a module that is not active (409), an item not yet served
--   (409 session_item_mapping_missing), an eliminated id that is not one of the
--   item's served tokens or is repeated, any elimination on a grid-in, and a
--   highlight outside the passage (400 invalid_workspace).
CREATE FUNCTION public.exam_save_item_workspace(
  p_student_id uuid, p_session_id uuid, p_section text, p_module text, p_ordinal int,
  p_marked boolean, p_eliminated text[], p_highlights jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_now    timestamptz := clock_timestamp();
  v_touch  jsonb;
  v_sec    text;
  v_phys   text;
  v_item   record;
  v_len    int;
  v_bad    text;
BEGIN
  v_touch := exam_touch_session(p_student_id, p_session_id, v_now);
  IF (v_touch->>'status')::int <> 200 THEN
    RETURN jsonb_build_object('status', (v_touch->>'status')::int, 'error', jsonb_build_object(
      'code', v_touch->>'code', 'message', 'Session not available.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  SELECT state INTO v_sec FROM test_session_sections
   WHERE test_session_id = p_session_id AND section = p_section;
  IF NOT ((p_module = '1' AND v_sec = 'module1_active') OR (p_module = '2' AND v_sec = 'module2_active')) THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', CASE
                WHEN p_module = '1' AND v_sec IN ('module1_submitted', 'module2_active', 'submitted') THEN 'module_submitted'
                WHEN p_module = '2' AND v_sec = 'submitted' THEN 'module_submitted'
                ELSE 'module_not_started' END,
      'message', 'This module is not active.'), 'outbox_ids', v_touch->'outbox_ids');
  END IF;
  v_phys := exam_physical_module(p_session_id, p_section, p_module);

  SELECT si.option_token_map, q.item_type, q.passage INTO v_item
    FROM test_session_items si JOIN questions q ON q.id = si.question_id
   WHERE si.test_session_id = p_session_id AND si.section = p_section
     AND si.module = v_phys AND si.ordinal = p_ordinal;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 409, 'error', jsonb_build_object(
      'code', 'session_item_mapping_missing', 'message', 'This item has not been served.'),
      'outbox_ids', v_touch->'outbox_ids');
  END IF;

  -- D2: eliminations are served tokens of THIS item, each at most once.
  IF cardinality(p_eliminated) > 0 AND v_item.item_type <> 'mcq' THEN
    v_bad := 'a grid-in item has no options to eliminate';
  ELSIF (SELECT count(DISTINCT e) FROM unnest(p_eliminated) e) <> cardinality(p_eliminated) THEN
    v_bad := 'an option is eliminated twice';
  ELSIF EXISTS (SELECT 1 FROM unnest(p_eliminated) e
                 WHERE v_item.option_token_map IS NULL OR NOT (v_item.option_token_map ? e)) THEN
    v_bad := 'an eliminated option is not one of this item''s served options';
  END IF;

  -- D3: highlights are code-point offsets inside the passage.
  IF v_bad IS NULL THEN
    v_len := char_length(v_item.passage);
    IF jsonb_typeof(p_highlights) <> 'array' THEN
      v_bad := 'highlights must be an array';
    ELSIF jsonb_array_length(p_highlights) > 0 AND v_len IS NULL THEN
      v_bad := 'this item has no passage to highlight';
    ELSIF EXISTS (
      SELECT 1 FROM jsonb_array_elements(p_highlights) h
       WHERE jsonb_typeof(h) <> 'object'
          OR (SELECT count(*) FROM jsonb_object_keys(h)) <> 2
          OR jsonb_typeof(h->'start') <> 'number' OR jsonb_typeof(h->'end') <> 'number'
          OR (h->>'start') !~ '^\d+$' OR (h->>'end') !~ '^\d+$'
          OR (h->>'start')::int >= (h->>'end')::int
          OR (h->>'end')::int > v_len) THEN
      v_bad := 'a highlight is not a {start, end} range inside the passage';
    END IF;
  END IF;

  IF v_bad IS NOT NULL THEN
    RETURN jsonb_build_object('status', 400, 'error', jsonb_build_object(
      'code', 'invalid_workspace', 'message', v_bad), 'outbox_ids', v_touch->'outbox_ids');
  END IF;

  INSERT INTO test_session_item_workspace AS w
    (test_session_id, section, module, ordinal, marked_for_review, eliminated_option_ids, highlights, updated_at)
  VALUES (p_session_id, p_section, v_phys, p_ordinal, p_marked, p_eliminated, p_highlights, v_now)
  ON CONFLICT (test_session_id, section, module, ordinal) DO UPDATE
     SET marked_for_review = EXCLUDED.marked_for_review,
         eliminated_option_ids = EXCLUDED.eliminated_option_ids,
         highlights = EXCLUDED.highlights,
         updated_at = EXCLUDED.updated_at;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object(
    'section_state', exam_section_state_json(p_session_id, p_section, v_now),
    'item', jsonb_build_object(
      'ordinal', p_ordinal,
      'marked_for_review', p_marked,
      'eliminated_option_ids', to_jsonb(p_eliminated),
      'highlights', p_highlights)),
    'outbox_ids', v_touch->'outbox_ids');
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. GET /api/tests/forms (SCL-147)
-- @spec [Doc-04A_V2.2 §16 (as amended by SCL-147); Doc-04C §16.3] | @implemented [2026-09-25]
-- plain English: every published form that is selectable, plus any published
--   or archived form the caller already has a session on (so a finished test
--   stays listed); per form its size and timing and the caller's LATEST
--   session with the raw inputs 04C derives a report state from (TypeScript
--   derives it — one derivation, not two). Never thresholds, versions or
--   module paths.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_list_forms(p_student_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('status', 200, 'body', jsonb_build_object('forms', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'test_form_id', f.id,
             'name', f.name,
             'is_selectable', f.is_selectable AND f.status = 'published',
             'question_count', (SELECT count(*) FROM test_form_items fi
                                 WHERE fi.test_form_id = f.id AND fi.module IN ('1', '2A')),
             'break_duration_ms', f.break_duration_ms,
             'sections', jsonb_build_array(
               jsonb_build_object('section', 'RW',
                 'questions_per_module', (SELECT count(*) FROM test_form_items fi
                                           WHERE fi.test_form_id = f.id AND fi.section = 'RW' AND fi.module = '1'),
                 'module1_ms', f.rw_module1_ms, 'module2_ms', f.rw_module2_ms),
               jsonb_build_object('section', 'M',
                 'questions_per_module', (SELECT count(*) FROM test_form_items fi
                                           WHERE fi.test_form_id = f.id AND fi.section = 'M' AND fi.module = '1'),
                 'module1_ms', f.m_module1_ms, 'module2_ms', f.m_module2_ms)),
             'latest_session', (
               SELECT jsonb_build_object(
                        'session_id', s.id,
                        'state', s.state,
                        'mode', s.mode,
                        'attempt_number_for_form', s.attempt_number_for_form,
                        'grace_expires_at', s.grace_expires_at,
                        'completed_at', s.completed_at,
                        'abandoned_at', s.abandoned_at,
                        'score_total_present', r.total_scaled IS NOT NULL,
                        'score_partial_present', r.partial_display_scaled IS NOT NULL,
                        'failed_outbox_id', CASE WHEN r.id IS NULL THEN (
                            SELECT o.id FROM exam_runtime_outbox o
                             WHERE o.aggregate_id = s.id AND o.status = 'failed'
                             ORDER BY o.created_at DESC LIMIT 1) END)
                 FROM test_sessions s
                 LEFT JOIN score_runs r ON r.test_session_id = s.id
                WHERE s.test_form_id = f.id AND s.student_id = p_student_id
                ORDER BY s.created_at DESC, s.id DESC LIMIT 1))
           ORDER BY f.published_at, f.name, f.id)
      FROM test_forms f
     WHERE (f.status = 'published' AND f.is_selectable)
        OR (f.status IN ('published', 'archived')
            AND EXISTS (SELECT 1 FROM test_sessions s2
                         WHERE s2.test_form_id = f.id AND s2.student_id = p_student_id))),
    '[]'::jsonb)))
$$;

-- ---------------------------------------------------------------------------
-- 6. The 04C report source (D6, D7)
-- @spec [Doc-04C_V1.0, §5.3 inputs, §7.1 fields read, §15.2 binding, §16.5
--        steps 3-4] | @implemented [2026-09-25]
-- plain English: ONE read of everything the report derives from, for a session
--   the caller owns. A missing session and someone else's session are the same
--   answer (403 forbidden, no detail — §16.6 anti-enumeration). Returns the
--   session, its form name, both sections, the score run's student-safe
--   columns (never decomposition fields or the outbox link), the dead-letter
--   outbox row standing in for 04D's failure ledger, and the disclosure row
--   bound to the score run's scoring_model_version. Reads only; touches nothing.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.exam_report_source(p_student_id uuid, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT student_id INTO v_owner FROM test_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_student_id THEN
    RETURN jsonb_build_object('status', 403, 'error', jsonb_build_object(
      'code', 'forbidden', 'message', 'Report not available.'));
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', (
    SELECT jsonb_build_object(
             'session', jsonb_build_object(
               'session_id', s.id,
               'test_form_id', s.test_form_id,
               'test_form_name', f.name,
               'state', s.state,
               'mode', s.mode,
               'grace_expires_at', s.grace_expires_at,
               'completed_at', s.completed_at,
               'abandoned_at', s.abandoned_at,
               'attempt_number_for_form', s.attempt_number_for_form,
               'is_first_seen_form_attempt', s.is_first_seen_form_attempt),
             'server_now', clock_timestamp(),
             'sections', (
               SELECT jsonb_agg(jsonb_build_object(
                        'section', sec.section,
                        'state', sec.state,
                        'module2_submitted_by', sec.module2_submitted_by)
                      ORDER BY CASE sec.section WHEN 'RW' THEN 1 ELSE 2 END)
                 FROM test_session_sections sec WHERE sec.test_session_id = s.id),
             'score_run', (
               SELECT jsonb_build_object(
                        'score_run_id', r.id,
                        'rw_scored', r.rw_scored,
                        'math_scored', r.math_scored,
                        'rw_scaled', r.rw_scaled,
                        'math_scaled', r.math_scaled,
                        'total_scaled', r.total_scaled,
                        'partial_display_scaled', r.partial_display_scaled,
                        'scoring_model_version', r.scoring_model_version,
                        'scored_at', r.computed_at)
                 FROM score_runs r WHERE r.test_session_id = s.id),
             'failure', (
               SELECT jsonb_build_object('outbox_id', o.id,
                                         'recorded_at', COALESCE(o.last_attempt_at, o.created_at))
                 FROM exam_runtime_outbox o
                WHERE o.aggregate_id = s.id AND o.status = 'failed'
                  AND NOT EXISTS (SELECT 1 FROM score_runs r2 WHERE r2.test_session_id = s.id)
                ORDER BY o.created_at DESC LIMIT 1),
             'disclosure', (
               SELECT jsonb_build_object(
                        'disclosure_version', d.disclosure_version,
                        'summary', d.summary,
                        'full_text_url', d.full_text_url)
                 FROM score_runs r3
                 JOIN score_disclosure_versions d ON d.scoring_model_version = r3.scoring_model_version
                WHERE r3.test_session_id = s.id))
      FROM test_sessions s JOIN test_forms f ON f.id = s.test_form_id
     WHERE s.id = p_session_id));
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. The cascade (20260930080000's body, byte-identical except the workspace
--    delete + count in hard_delete and one comment line in anonymize — D10)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.execute_account_deletion_cascade(
  p_profile_id    uuid,
  p_privacy_mode  text DEFAULT 'hard_delete'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result    jsonb := '{}'::jsonb;
  v_count     bigint;
  v_actor_id  uuid;
  v_exam_sessions uuid[];   -- E6b: the profile's test_sessions, collected before hard_delete removes them
BEGIN
  -- ========================================================================
  -- PRIVACY MODE GUARD
  -- ========================================================================
  IF p_privacy_mode NOT IN ('hard_delete', 'anonymize') THEN
    RAISE EXCEPTION 'unknown p_privacy_mode: %. Valid: hard_delete, anonymize', p_privacy_mode;
  END IF;

  -- ========================================================================
  -- IDEMPOTENCY: profile already gone → clean no-op (§10.5)
  -- ========================================================================
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_profile_id) THEN
    RETURN jsonb_build_object('status', 'no_op', 'reason', 'profile does not exist (already cascaded)');
  END IF;

  -- ========================================================================
  -- STATUS GUARD: require a completed deletion request
  -- ========================================================================
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_requests
     WHERE profile_id = p_profile_id AND status = 'completed'
  ) THEN
    RAISE EXCEPTION 'no completed deletion request for profile %. '
      'The cron driver must mark the request completed (after deidentify_user) before calling cascade.',
      p_profile_id;
  END IF;

  -- ========================================================================
  -- CAPTURE actor_id (anonymize mode: needed for sentinel + ledger;
  -- must be read BEFORE profile deletion destroys the mapping — §3 Rule 4)
  -- ========================================================================
  IF p_privacy_mode = 'anonymize' THEN
    SELECT actor_id INTO v_actor_id FROM public.profiles WHERE id = p_profile_id;
    IF v_actor_id IS NULL THEN
      RAISE EXCEPTION '05E-5d: profiles.actor_id IS NULL for profile % — cannot anonymize without grouping identifier (INV-05E-06)',
        p_profile_id;
    END IF;
  END IF;

  -- ========================================================================
  -- PRE-CLEAR: RESTRICT + NO ACTION FKs that block profile deletion
  -- ========================================================================

  -- PS-1. entitlements (profile_id → profiles ON DELETE RESTRICT)
  DELETE FROM public.entitlements WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('entitlements', v_count);

  -- PS-2 .. PS-4: the pre-clears that touch rows belonging to OTHER identities
  -- (a student's consent request when a guardian deletes; another person's deletion
  -- request that named this profile as actor; the guardian_links rows on either side).
  --
  -- ANONYMIZE MODE (the user-facing path): these MUST already have run in their own
  -- transaction — public.preclear_account_deletion_links, T1.5 of the executor. A row
  -- of a LIVE identity written in THIS transaction would share its xmin with the
  -- anonymized_actors row written below, which is a deterministic join from actor_id
  -- to that live person and, through profiles.guardian_email, to the deleted one
  -- (evidence invariant rule 3, SCL-088; plan v4 §1). So this mode does not clear:
  -- it verifies, and fails closed (INV-05E-05: explicit, gated, nothing implicit).
  --
  -- HARD_DELETE MODE (service_role-only internal tool, Doc 05E §1): self-clears, as
  -- before. Nothing pseudonymous is retained by that mode, so the join has nothing
  -- to reach.
  IF p_privacy_mode = 'anonymize' THEN
    IF EXISTS (SELECT 1 FROM public.guardian_links
                WHERE accepted_by_profile_id = p_profile_id
                   OR revoked_by_profile_id  = p_profile_id
                   OR student_profile_id     = p_profile_id
                   OR guardian_profile_id    = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.guardian_consent_requests
                   WHERE guardian_profile_id = p_profile_id
                      OR student_profile_id  = p_profile_id)
       OR EXISTS (SELECT 1 FROM public.account_deletion_requests
                   WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id)
    THEN
      RAISE EXCEPTION 'PRECLEAR_REQUIRED: profile % still has guardian_links / guardian_consent_requests / actor_profile_id references — run public.preclear_account_deletion_links(profile) in its own transaction first (evidence invariant rule 3)',
        p_profile_id;
    END IF;
  ELSE
    -- PS-2. guardian_links — nullable NO ACTION refs first, then RESTRICT
    UPDATE public.guardian_links SET accepted_by_profile_id = NULL
     WHERE accepted_by_profile_id = p_profile_id;
    UPDATE public.guardian_links SET revoked_by_profile_id = NULL
     WHERE revoked_by_profile_id = p_profile_id;
    DELETE FROM public.guardian_links WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_student', v_count);
    DELETE FROM public.guardian_links WHERE guardian_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_links_as_guardian', v_count);

    -- PS-3. guardian_consent_requests — nullable NO ACTION ref first, then RESTRICT
    UPDATE public.guardian_consent_requests SET guardian_profile_id = NULL
     WHERE guardian_profile_id = p_profile_id;
    DELETE FROM public.guardian_consent_requests WHERE student_profile_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('guardian_consent_requests', v_count);

    -- PS-4. account_deletion_requests — actor_profile_id edge case
    UPDATE public.account_deletion_requests
       SET actor_profile_id = profile_id
     WHERE actor_profile_id = p_profile_id AND profile_id <> p_profile_id;
  END IF;

  -- PS-5. account_deletion_requests — delete THIS profile's request rows
  DELETE FROM public.account_deletion_requests WHERE profile_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('account_deletion_requests', v_count);

  -- ========================================================================
  -- LAYER 1: DELETE derived state (SHARED — both modes; INV-05E-09 proven safe)
  -- ========================================================================
  -- All derived state: mastery, KPI, projections, scheduling. Recomputable from
  -- retained activity if ever needed (§5). No FK to profiles (convention only).
  -- Zero triggers on any L1 table. Zero FKs from L1 to L2.

  -- L1-01. student_section_projection_snapshots (05C)
  DELETE FROM public.student_section_projection_snapshots WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projection_snapshots', v_count);

  -- L1-02. student_section_projections (05C)
  DELETE FROM public.student_section_projections WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_projections', v_count);

  -- L1-03. student_projection_refresh_state (05C)
  DELETE FROM public.student_projection_refresh_state WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_projection_refresh_state', v_count);

  -- L1-04. projection_refresh_outbox (05C)
  DELETE FROM public.projection_refresh_outbox WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('projection_refresh_outbox', v_count);

  -- L1-05. student_section_kpi (05B)
  DELETE FROM public.student_section_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_section_kpi', v_count);

  -- L1-06. student_domain_kpi (05B)
  DELETE FROM public.student_domain_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_kpi', v_count);

  -- L1-07. student_skill_kpi (05B)
  DELETE FROM public.student_skill_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_kpi', v_count);

  -- L1-08. student_overall_kpi (05B)
  DELETE FROM public.student_overall_kpi WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_overall_kpi', v_count);

  -- L1-09. student_domain_mastery (05B)
  DELETE FROM public.student_domain_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_domain_mastery', v_count);

  -- L1-10. student_skill_mastery (05A)
  DELETE FROM public.student_skill_mastery WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_skill_mastery', v_count);


  -- L1-12. student_kpi_rollups_current (SCL-004: was missing from L1 in both modes)
  DELETE FROM public.student_kpi_rollups_current WHERE student_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('student_kpi_rollups_current', v_count);

  -- L1-13. legal_acceptance_outbox (2026-09-16 evidence audit, plan v4 Phase 1). The
  -- outbox has NO profiles FK (20260619000300 dropped it so consent intent survives a
  -- late profile insert), sat in no cascade list, and is invisible to the FK-driven
  -- preflight above — so its rows, keyed by the auth uuid (= profile id), survived a
  -- deletion in signup order. Classified here as identity-keyed queue state: DELETED in
  -- both modes. The consent EVIDENCE lives in deletion_consent_evidence, copied from
  -- legal_acceptances by mark_deletion_log_executing before this transaction; an
  -- undrained outbox row at T+7 is intent that never became an acceptance and is not
  -- evidence of one.
  DELETE FROM public.legal_acceptance_outbox WHERE user_id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('legal_acceptance_outbox', v_count);

  -- ========================================================================
  -- MODE BRANCH: hard_delete vs anonymize diverge at L2
  -- ========================================================================

  IF p_privacy_mode = 'hard_delete' THEN
    -- ====================================================================
    -- LAYER 2 (hard_delete): Hard-delete event/audit sources
    -- ====================================================================
    -- Children-before-parent FK-safe order. All event + session + audit rows removed.

    -- L2-01. practice_session_items (child of practice_sessions via ON DELETE CASCADE)
    DELETE FROM public.practice_session_items WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions
    DELETE FROM public.practice_sessions WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (child of review_session_items via ON DELETE CASCADE)
    DELETE FROM public.review_error_attempts WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-04. review_session_items (child of review_sessions via ON DELETE CASCADE)
    DELETE FROM public.review_session_items WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_session_items', v_count);

    -- L2-05. review_sessions
    DELETE FROM public.review_sessions WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- L2-06. mastery_event_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_event_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L2-07. mastery_domain_refresh_audit_log (no FK; student_id by convention)
    DELETE FROM public.mastery_domain_refresh_audit_log WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- LAYER 2 (hard_delete): exam runtime (Doc 04A §5, Doc 04B §9; E6b, SCL-143)
    -- ====================================================================
    -- test_sessions.student_id and score_runs.student_id are ON DELETE SET NULL
    -- (E6b), as practice and review are: the profile delete below would SEVER
    -- these rows, not remove them. hard_delete removes them here, explicitly.
    -- The sessions are collected first — the outbox carries only aggregate_id
    -- (no FK, no identity) and is reachable only through them.
    SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_exam_sessions
      FROM public.test_sessions WHERE student_id = p_profile_id;

    -- L2-08 .. L2-11. The four runtime children, children before parents.
    -- Answers before submissions: test_session_answers.last_submission_id
    -- references test_answer_submissions (NO ACTION).
    DELETE FROM public.test_session_answers WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_answers', v_count);

    DELETE FROM public.test_answer_submissions WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_answer_submissions', v_count);

    -- E7a (SCL-145): the workspace rows hang off test_session_items (CASCADE),
    -- so they go first, by name and counted, like every other exam child.
    DELETE FROM public.test_session_item_workspace WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_item_workspace', v_count);

    DELETE FROM public.test_session_items WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_items', v_count);

    DELETE FROM public.test_session_sections WHERE test_session_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_session_sections', v_count);

    -- L2-12 / L2-13. score_run_event_ledger and score_runs. Neither is deleted by
    -- name: score_runs is insert-once (Doc 04B §9.4) and its trigger refuses a
    -- DELETE while the parent session exists. Both leave with the session through
    -- test_session_id / score_run_id ON DELETE CASCADE, which the trigger admits
    -- (the parent is gone). Counted first, because that removal is invisible to
    -- GET DIAGNOSTICS.
    SELECT count(*) INTO v_count
      FROM public.score_run_event_ledger l
      JOIN public.score_runs r ON r.id = l.score_run_id
     WHERE r.test_session_id = ANY (v_exam_sessions);
    v_result := v_result || jsonb_build_object('score_run_event_ledger', v_count);

    SELECT count(*) INTO v_count FROM public.score_runs WHERE test_session_id = ANY (v_exam_sessions);
    v_result := v_result || jsonb_build_object('score_runs', v_count);

    -- L2-14. test_sessions (takes its score_runs and their ledger rows with it)
    DELETE FROM public.test_sessions WHERE id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('test_sessions', v_count);

    -- L2-15. exam_runtime_outbox — identity-free queue state, deleted in
    -- hard_delete like legal_acceptance_outbox (L1-13). After the sessions:
    -- score_runs and the ledger reference it (NO ACTION) and are gone now.
    DELETE FROM public.exam_runtime_outbox WHERE aggregate_id = ANY (v_exam_sessions);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('exam_runtime_outbox', v_count);

  ELSIF p_privacy_mode = 'anonymize' THEN
    -- ====================================================================
    -- FAIL-CLOSED SENTINEL (INV-05E-07): before severing identity, verify
    -- every retained row for this user has its grouping identifier.
    -- ====================================================================
    -- Defense-in-depth: actor_id is DB-enforced NOT NULL (PR-5c seal), so
    -- this cannot fire under normal operation. But INV-05E-07 requires
    -- explicit verification before the identity ↔ actor_id linkage is
    -- destroyed. Runs BEFORE SET NULL so identity col is still queryable.
    DECLARE
      v_sentinel_tbl text;
      v_sentinel_col text;
      v_sentinel_cnt bigint;
    BEGIN
      FOR v_sentinel_tbl, v_sentinel_col IN VALUES
        ('practice_sessions',                'user_id'),
        ('practice_session_items',           'user_id'),
        ('review_sessions',                  'student_id'),
        ('review_session_items',             'student_id'),
        ('review_error_attempts',            'student_id'),
        ('mastery_event_audit_log',          'student_id'),
        ('mastery_domain_refresh_audit_log', 'student_id'),
        ('test_sessions',                    'student_id'),   -- E6b (SCL-143)
        ('score_runs',                       'student_id')    -- E6b (SCL-143)
      LOOP
        EXECUTE format(
          'SELECT count(*) FROM public.%I WHERE %I = $1 AND actor_id IS NULL',
          v_sentinel_tbl, v_sentinel_col
        ) INTO v_sentinel_cnt USING p_profile_id;
        IF v_sentinel_cnt > 0 THEN
          RAISE EXCEPTION '05E-5d SENTINEL (INV-05E-07): % row(s) in public.% have identity present but actor_id IS NULL — refusing to sever identity from ungrouped row',
            v_sentinel_cnt, v_sentinel_tbl;
        END IF;
      END LOOP;
    END;

    -- ====================================================================
    -- LAYER 2 (anonymize): Sever identity + remove fingerprints on
    -- activity tables — rows RETAINED for world-model training (§5)
    -- ====================================================================
    -- §5.1: "Removed: the identity link and any client/device/session
    --   fingerprint that could enable re-identification."
    -- §5.1: "Retained: the learning interaction — item answered, response
    --   chosen, correctness, difficulty/domain/skill/section, ordering,
    --   timing, and shared question-bank content."
    -- actor_id (NOT NULL, PR-5c) is the surviving synthetic grouping id.
    -- Children before parents (convention match with hard-delete ordering).
    --
    -- Partial unique indexes (uq_practice_items_idem, uq_review_attempts_idem)
    -- are on (identity, client_attempt_id) WHERE client_attempt_id IS NOT NULL.
    -- Setting client_attempt_id = NULL removes rows from the partial index;
    -- no uniqueness violation. Live write path unaffected (non-anonymized
    -- users retain non-NULL identity and client_attempt_id).

    -- L2-01. practice_session_items (identity + fingerprint)
    UPDATE public.practice_session_items
       SET client_attempt_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_session_items', v_count);

    -- L2-02. practice_sessions (identity + fingerprint)
    UPDATE public.practice_sessions
       SET client_instance_id = NULL
     WHERE user_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('practice_sessions', v_count);

    -- L2-03. review_error_attempts (identity + fingerprint)
    UPDATE public.review_error_attempts
       SET client_attempt_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_error_attempts', v_count);

    -- L2-05. review_sessions (identity + fingerprint)
    UPDATE public.review_sessions
       SET client_instance_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('review_sessions', v_count);

    -- ====================================================================
    -- LAYER 3 (anonymize): Sever identity on audit tables
    -- ====================================================================
    -- §5: "Audit layer: one-way anonymized per Doc 05D §10, idempotency
    --   guarantees untouched."
    -- mastery_event_audit_log_dedup_uq is UNIQUE on (event_source_kind,
    -- event_id) — does NOT include student_id. SET NULL is safe; the
    -- idempotency anchor (INV-05A-10) is preserved.
    -- No FK to profiles (denormalized, convention only).

    -- L3-01. mastery_event_audit_log
    UPDATE public.mastery_event_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_event_audit_log', v_count);

    -- L3-02. mastery_domain_refresh_audit_log
    UPDATE public.mastery_domain_refresh_audit_log
       SET student_id = NULL
     WHERE student_id = p_profile_id;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_result := v_result || jsonb_build_object('mastery_domain_refresh_audit_log', v_count);

    -- ====================================================================
    -- LAYER 2 (anonymize): exam runtime (Doc 04A §5, Doc 04B §9; E6b, SCL-143)
    -- ====================================================================
    -- RETAINED under actor_id. The identity link is severed by
    -- test_sessions.student_id and score_runs.student_id ON DELETE SET NULL when
    -- the profile row goes below — the same mechanism as practice and review.
    -- score_runs is insert-once; its trigger admits exactly that FK action (the
    -- student_id -> NULL change with every other column equal, the profile gone).
    -- Nothing else to remove: test_sessions has no client/device fingerprint
    -- (Doc 04A omits client_instance_id); the children (E7a's workspace rows
    -- included: flags, eliminated opaque tokens, highlight offsets — no text) and
    -- the ledger carry no identity; the outbox carries none either and score_runs references it,
    -- so it stays. Counted HERE, before the profile delete, because a severance
    -- done by an FK action is invisible to GET DIAGNOSTICS.
    SELECT count(*) INTO v_count FROM public.test_sessions WHERE student_id = p_profile_id;
    v_result := v_result || jsonb_build_object('test_sessions', v_count);

    SELECT count(*) INTO v_count FROM public.score_runs WHERE student_id = p_profile_id;
    v_result := v_result || jsonb_build_object('score_runs', v_count);

    -- ====================================================================
    -- ANONYMIZED_ACTORS LEDGER — Doc 05E §3 Rule 4 / INV-05E-01 / INV-05E-02
    -- (build-derived ledger; no spec anchor — SCL-088. The earlier citation of section 3.1 ("Industry precedent")
    -- was wrong.)
    -- ====================================================================
    -- Records that this actor_id is anonymized, BEFORE the profile deletion below
    -- destroys the one linkage surface. actor_id ONLY: no timestamp (SCL-088 — a
    -- deletion time on the pseudonymous side joins a dated evidence record at this
    -- volume), and public.rewrite_anonymized_actors() strips insertion order after
    -- every executor pass so xmin/ctid carry no sequence either.
    INSERT INTO public.anonymized_actors (actor_id)
    VALUES (v_actor_id)
    ON CONFLICT (actor_id) DO NOTHING;
    v_result := v_result || jsonb_build_object('anonymized_actors', 1);

  END IF;

  -- ========================================================================
  -- PROFILE + AUTH DELETE (shared — both modes destroy the profile row)
  -- ========================================================================
  -- §3 Rule 4: "Linkage destroyed at anonymization." The profile row
  -- contains profiles.actor_id — the ONLY surface linking identity to the
  -- synthetic identifier. Deleting the row makes the link irreversible.
  -- auto-CASCADE FKs fire: rate_limit_ledger, abuse_score_incidents,
  -- abuse_scores, notification_events, notification_messages, legal_acceptances.
  -- profiles.guardian_profile_id SET NULL self-FK fires for other profiles.
  -- test_sessions.student_id and score_runs.student_id SET NULL fire here in
  -- anonymize mode (E6b); in hard_delete no exam row is left for them to reach.
  -- Operator-FK edges (36 config/history) are ON DELETE SET NULL — Postgres severs
  -- the attribution as the profile row goes; no enumeration here.
  -- In anonymize mode, L2/L3 identity columns are already NULL — no FK
  -- from those tables blocks this DELETE (FKs are NO ACTION, nullable).

  DELETE FROM public.profiles WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('profiles', v_count);

  DELETE FROM auth.users WHERE id = p_profile_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_result := v_result || jsonb_build_object('auth_users', v_count);

  RETURN jsonb_build_object(
    'status', 'completed',
    'profile_id', p_profile_id,
    'privacy_mode', p_privacy_mode,
    'rows_affected', v_result
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: every new function is server-only (E6's rule).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.exam_heartbeat(uuid, uuid, text, int)',
    'public.exam_module_workspace(uuid, uuid, text, text)',
    'public.exam_save_item_workspace(uuid, uuid, text, text, int, boolean, text[], jsonb)',
    'public.exam_list_forms(uuid)',
    'public.exam_report_source(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END;
$$;

COMMIT;
