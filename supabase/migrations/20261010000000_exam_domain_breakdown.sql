-- ===========================================================================
-- G1: the exam report's per-domain breakdown (student report first; guardians project it)
-- ===========================================================================
-- @spec [Doc 04C §8.1 / §9.1 (report payloads), §2.3 (no Module 2 path), §2.6 rule 7
--        (guardian payload a strict subset of the student's), §6 ("aggregations belong
--        in 04B, which already produces the canonical decomposition"); Doc 04 Parent Q9
--        as amended by SCL-180; E7b owner ruling ("The Score breakdown tab is E8 — it
--        needs per-domain counts no endpoint serves yet"); SCL-160 (premise gated)]
-- @implemented [2026-09-27]
--
-- plain English: for one owned session, per SCORED section and per domain, how many
-- items the student was served and how many they got right. It is the report's
-- "Score breakdown" tab, which E7b built disabled because nothing served these counts.
-- A guardian sees the same rows (G1): domains only, never skills.
--
-- WHAT IT COUNTS, AND AGAINST WHAT.
--   total   = the section's served items in that domain: Module 1 plus the ONE Module 2
--             the session was routed to (test_form_items, module IN ('1', '2' ||
--             module2_path); the section stores the path as 'A'|'B', the items as '2A'|'2B').
--   correct = the answers `is_answer_correct` accepts — the scoring engine's own
--             predicate (20260930040000), so a domain's correct is exactly the part of the
--             section's module1_correct + module2_correct that falls in that domain. Gate
--             D2 proves the sums agree with score_runs for every scored section.
--   Only sections the score run SCORED appear (rw_scored / math_scored). A section with
--   no scaled score has no breakdown: no count ever appears beside a score that does not
--   exist (partial_scored, and nothing at all while pending or failed).
--
-- THE ROUTING PATH IS NOT RECOVERABLE FROM THIS OUTPUT, and that is a gated premise, not a
-- hope (SCL-160). `module2_path` is read to select the served items and is never emitted:
-- no module, no path, no difficulty, no skill, no question id leaves this function. The
-- TOTALS could still betray the path if 2A and 2B differed by domain; they cannot, because
-- `validate_form_composition` pins identical per-domain quotas for 2A and 2B at publish
-- (20260930030000) and published forms are immutable. Gate D3 asserts that premise
-- against the live forms, so a future form or quota change that broke it fails CI.
--
-- ACCESS: service_role only, and ownership is checked here exactly as
-- exam_report_source does it — a missing or foreign session is the same bare 403.
-- Guardians reach it only through the report service, after resolveSubject.
--
-- OWNER-RUN: `supabase db push --include-all`. Additive: one new function.
--
-- ROLLBACK (INV-06): transactional.
-- LYCEON-MIGRATION-REVIEWED (INV-06): rollback reviewed —
--   DROP FUNCTION public.exam_domain_breakdown(uuid, uuid);
-- ===========================================================================

BEGIN;

CREATE FUNCTION public.exam_domain_breakdown(p_student_id uuid, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT student_id INTO v_owner FROM test_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_owner IS DISTINCT FROM p_student_id THEN
    RETURN jsonb_build_object('status', 403, 'error', jsonb_build_object(
      'code', 'forbidden', 'message', 'Report not available.'));
  END IF;

  RETURN jsonb_build_object('status', 200, 'body', jsonb_build_object('domains', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'section', d.section, 'domain', d.domain,
             'correct', d.correct, 'total', d.total)
           ORDER BY d.section, d.domain)
      FROM (
        SELECT fi.section, q.domain,
               count(*)::int AS total,
               count(*) FILTER (
                 WHERE a.answer IS NOT NULL
                   AND public.is_answer_correct(a.answer, fi.question_id))::int AS correct
          FROM test_sessions s
          JOIN score_runs r              ON r.test_session_id = s.id
          JOIN test_session_sections sec ON sec.test_session_id = s.id
          JOIN test_form_items fi        ON fi.test_form_id = s.test_form_id
                                        AND fi.section = sec.section
                                        AND fi.module IN ('1', '2' || sec.module2_path)
          JOIN questions q               ON q.id = fi.question_id
          LEFT JOIN test_session_answers a
                 ON a.test_session_id = s.id
                AND a.section = fi.section AND a.module = fi.module
                AND a.ordinal = fi.ordinal AND a.question_id = fi.question_id
         WHERE s.id = p_session_id
           AND ((sec.section = 'RW' AND r.rw_scored) OR (sec.section = 'M' AND r.math_scored))
         GROUP BY fi.section, q.domain
      ) d
  ), '[]'::jsonb)));
END;
$$;

COMMENT ON FUNCTION public.exam_domain_breakdown(uuid, uuid) IS
  'G1: per scored section, per domain, correct-of-total over the served items (Module 1 + the routed Module 2). Emits section/domain/correct/total only: never a module, path, skill, difficulty or question id. 403 for a missing or foreign session, as exam_report_source.';

REVOKE ALL ON FUNCTION public.exam_domain_breakdown(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exam_domain_breakdown(uuid, uuid) TO service_role;

COMMIT;
