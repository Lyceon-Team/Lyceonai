-- ============================================================================
-- POST-APPLY VERIFICATION — 20260816010000_canonical_domain_checks
-- ============================================================================
-- Both constraints present AND enforcing. The presence check alone is not
-- sufficient: a constraint can exist and still be NOT VALID, or be defined over
-- the wrong column. The spot insert proves enforcement.
--
-- This file performs ONE transactional write and rolls it back. It is the only
-- file under scripts/prod-verify/ that is not strictly read-only, and it leaves
-- no trace: the INSERT is expected to FAIL, and the surrounding transaction is
-- rolled back regardless.
--
-- EXPECTED
--   both_constraints_present = t
--   the hyphenated spot insert raises 23514 (printed as a caught exception)
--   the canonical spot insert succeeds, then is rolled back
--
-- USAGE: psql -f scripts/prod-verify/1.2-post-apply.sql
-- ============================================================================

\pset footer off
\echo '=== 1.2 POST-APPLY — canonical domain constraints present and enforcing ==='

SELECT
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'questions_domain_section_canonical')     AS questions_constraint,
  EXISTS (SELECT 1 FROM pg_constraint
           WHERE conname = 'psi_question_domain_section_canonical')  AS psi_constraint,
  (EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'questions_domain_section_canonical')
   AND
   EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'psi_question_domain_section_canonical'))
                                                                     AS both_constraints_present;

\echo ''
\echo '--- constraint definitions ---'
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('questions_domain_section_canonical',
                  'psi_question_domain_section_canonical')
ORDER BY conname;

\echo ''
\echo '--- enforcement proof (writes nothing: every branch is rolled back) ---'

BEGIN;

DO $proof$
DECLARE
  v_sqlstate text;
  v_hyphen_rejected      boolean := false;
  v_cross_rejected       boolean := false;
  v_canonical_accepted   boolean := false;
BEGIN
  -- (a) hyphenated M domain must be REJECTED
  BEGIN
    INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                  stem, options, correct_answer, explanation)
    VALUES ('SATM1Z99901', 'M', 1, 'Problem-Solving and Data Analysis', ARRAY['PSD.01'], 2, 'proof',
      '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
      'A', 'proof');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_hyphen_rejected := (v_sqlstate = '23514');
  END;

  -- (b) valid RW domain under section M must be REJECTED (the pairing, not just the list)
  BEGIN
    INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                  stem, options, correct_answer, explanation)
    VALUES ('SATM1Z99902', 'M', 1, 'Craft and Structure', ARRAY['CAS.01'], 2, 'proof',
      '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
      'A', 'proof');
  EXCEPTION WHEN check_violation THEN
    v_cross_rejected := true;
  END;

  -- (c) the canonical form must still be ACCEPTED — not a blanket refusal
  BEGIN
    INSERT INTO public.questions (id, section, source_type, domain, skill_codes, difficulty,
                                  stem, options, correct_answer, explanation)
    VALUES ('SATM1Z99903', 'M', 1, 'Problem Solving and Data Analysis', ARRAY['PSD.01'], 2, 'proof',
      '[{"key":"A","text":"a"},{"key":"B","text":"b"},{"key":"C","text":"c"},{"key":"D","text":"d"}]'::jsonb,
      'A', 'proof');
    v_canonical_accepted := true;
  EXCEPTION WHEN OTHERS THEN
    v_canonical_accepted := false;
  END;

  IF NOT v_hyphen_rejected THEN
    RAISE EXCEPTION 'STOP — hyphenated domain was ACCEPTED; the CHECK is not enforcing';
  END IF;
  IF NOT v_cross_rejected THEN
    RAISE EXCEPTION 'STOP — cross-section pair (M, Craft and Structure) was ACCEPTED; pairing not enforced';
  END IF;
  IF NOT v_canonical_accepted THEN
    RAISE EXCEPTION 'STOP — canonical domain was REJECTED; the CHECK is too strict';
  END IF;

  RAISE NOTICE 'OK — hyphen rejected (23514), cross-section rejected, canonical accepted';
END $proof$;

ROLLBACK;

\echo ''
\echo '--- confirm the proof left nothing behind (expect 0) ---'
SELECT count(*) AS leftover_proof_rows
FROM public.questions
WHERE id LIKE 'SATM1Z999%';
