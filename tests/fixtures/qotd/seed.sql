-- Question of the Day test fixture: four ORIGINAL example questions (not bank content), scheduled
-- on 2026-10-02 .. 2026-10-05. Applied to a database built from supabase/migrations, then
-- qotd_archive() and qotd_question_for() are read back as JSON into rows.json, so the tests
-- assert on what the SQL functions actually return (CLAUDE.md: derive the fixture from real
-- output). Regenerate with tests/fixtures/qotd/README.md.
INSERT INTO public.questions
  (id, section, source_type, domain, skill_codes, difficulty, stem, passage, options,
   correct_answer, correct_variants, explanation, status, published_at, item_type)
VALUES
  ('SATM1FXQ001', 'M', 1, 'Algebra', ARRAY['FX'], 1,
   'If $3x + 5 = 20$, what is the value of $x$?', NULL,
   '[{"key":"A","text":"3"},{"key":"B","text":"5"},{"key":"C","text":"15"},{"key":"D","text":"25"}]'::jsonb,
   'B', NULL,
   'Subtract 5 from both sides to get $3x = 15$, then divide both sides by 3 to get $x = 5$.',
   'published', now(), 'mcq'),
  ('SATRW1FXQ002', 'RW', 1, 'Standard English Conventions', ARRAY['FX'], 1,
   'Which choice completes the text so that it conforms to the conventions of Standard English?',
   'The museum''s new exhibit, which opened last spring, ______ more than ten thousand visitors in its first month.',
   '[{"key":"A","text":"attract"},{"key":"B","text":"attracting"},{"key":"C","text":"attracted"},{"key":"D","text":"to attract"}]'::jsonb,
   'C', NULL,
   'The subject is the singular noun "exhibit", and the sentence describes a completed event, so it needs a finite past-tense verb. "Attracted" is the only choice that supplies one.',
   'published', now(), 'mcq'),
  ('SATM1FXQ003', 'M', 1, 'Advanced Math', ARRAY['FX'], 1,
   'If $x^2 = 49$ and $x > 0$, what is the value of $x$?', NULL,
   '[]'::jsonb,
   '7', ARRAY['7', '7.0'],
   'Both 7 and -7 square to 49. Since $x > 0$, $x = 7$.',
   'published', now(), 'grid_in'),
  ('SATM1FXQ004', 'M', 1, 'Geometry and Trigonometry', ARRAY['FX'], 1,
   'A rectangle has a length of 8 and a width of 3. What is its area?', NULL,
   '[{"key":"A","text":"11"},{"key":"B","text":"22"},{"key":"C","text":"24"},{"key":"D","text":"48"}]'::jsonb,
   'C', NULL,
   'The area of a rectangle is length times width: $8 \times 3 = 24$.',
   'published', now(), 'mcq');

SELECT public.qotd_schedule_insert('2026-10-02', 'SATM1FXQ001');
SELECT public.qotd_schedule_insert('2026-10-03', 'SATRW1FXQ002');
SELECT public.qotd_schedule_insert('2026-10-04', 'SATM1FXQ003');
SELECT public.qotd_schedule_insert('2026-10-05', 'SATM1FXQ004');
