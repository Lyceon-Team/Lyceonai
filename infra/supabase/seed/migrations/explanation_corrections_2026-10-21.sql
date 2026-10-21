-- Explanation corrections, 2026-10-21 (owner brief "student cleanups", Karl, Part D).
--
-- @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part D: "Correct the explanation for
--       'Solve 2(x−3)+5=3x−4': its reasons for the wrong choices don't match the algebra. Use the
--       normal question-publishing path." and "F-57: fix the two explanations that refer to
--       choices by their stored letter."; docs/questions_governance.md §A.1 (`version`:
--       "Increment on any content edit after initial authoring"), §A.6 (explanations name a
--       choice by its content, never by letter; each distractor's reason must be the real one);
--       student-UI register F-57; Doc 02 Preamble §12 (explanation is post-submit only)]
--       | @implemented [2026-10-21]
--
-- plain English: the same path as `deletter_explanations.sql` beside it — content edits to
-- published rows, applied by Karl after the Codex audit (DO NOT apply to prod from a session).
-- `public.questions.explanation` is the one column changed, plus `version + 1`; nothing about
-- serving changes: the explanation is still revealed only after submit.
--
--  1. SATM26DQWW4 ("Solve for x: 2(x − 3) + 5 = 3x − 4", key 3). The three distractor reasons
--     were wrong: "−3 from a sign error combining −6 + 5" (−6 + 5 = +1 gives x = 5, not −3);
--     "1 from not distributing the 2" (2x − 3 + 5 = 3x − 4 gives x = 6, not 1); "−1 from an
--     arithmetic slip" (no derivation). Re-derived (each checked by substitution):
--       −3: −x − 1 = −4 → −x = −3, then dividing only the left side by −1 gives x = −3;
--        1: moving 3x − 4 to the left WITHOUT changing signs: 2x − 1 + 3x − 4 = 0 → 5x = 5 → x = 1;
--       −1: stopping at −1 = x − 4 and reading x as −1, without adding 4 to both sides.
--
--  2. F-57: production held 2 of 5,843 MCQ explanations matching
--     `\m(choice|option|answer)\s+[A-D]\M` (read-only, 2026-10-02). The register does not name
--     them, and production is not read from a session. Every explanation in this repository's
--     seeds that ever matched that pattern is one of the three below (a replay of all 80
--     proving batches, 2026-10-21); each already has a letter-free text in
--     deletter_explanations.sql. They are re-stated here GUARDED by the same pattern, so a row
--     already fixed is not touched, and the post-check reports how many servable explanations
--     still match. If it is not 0, the two are outside this repository and need their ids
--     (owner-run query in the PR).
--
-- Rollback: each UPDATE's previous text is the matching line of deletter_explanations.sql
-- (items 2) or the WAS text below (item 1); `version` is decremented by the same statement.

BEGIN;

-- 1. SATM26DQWW4 — WAS (deletter_explanations.sql:63): "The correct answer is $3$. Distribute
--    the 2 on the left side: $2x - 6 + 5 = 3x - 4$, which simplifies to $2x - 1 = 3x - 4$.
--    Adding 4 and subtracting $2x$ from both sides gives $3 = x$. $-3$ results from a sign error
--    when combining $-6 + 5$. $1$ comes from forgetting to distribute the 2 across both terms in
--    $(x - 3)$, effectively solving $2x - 3 + 5 = 3x - 4$. $-1$ results from an arithmetic slip
--    when moving terms across the equal sign."
UPDATE public.questions
   SET explanation = $exp$The correct answer is $3$. Distribute the 2 on the left side: $2x - 6 + 5 = 3x - 4$, which simplifies to $2x - 1 = 3x - 4$. Subtracting $2x$ from both sides gives $-1 = x - 4$, and adding 4 to both sides gives $x = 3$. $-3$ comes from a sign error in the last step: subtracting $3x$ from both sides instead gives $-x - 1 = -4$, so $-x = -3$, and dividing only the left side by $-1$ gives $x = -3$. $1$ comes from moving $3x - 4$ to the left side without changing its signs: $2x - 1 + 3x - 4 = 0$, so $5x = 5$ and $x = 1$. $-1$ comes from stopping too early: after subtracting $2x$ the equation is $-1 = x - 4$, and reading $x$ as $-1$ skips adding 4 to both sides.$exp$,
       version = version + 1
 WHERE id = 'SATM26DQWW4'
   AND explanation NOT LIKE '%reading $x$ as $-1$%';

-- 2. F-57 — only where the explanation still names a choice by letter.
UPDATE public.questions SET explanation = $exp$The correct answer is $1$. Substituting $x = 1$ gives $4(1) + 3 = 7$, and $7 \leq 15$ is true. Solving the inequality algebraically: subtract $3$ from both sides to get $4x \leq 12$, then divide by $4$ to get $x \leq 3$. Only $x = 1$ satisfies this condition. $x = 4$ gives $4(4) + 3 = 19 > 15$, which violates the inequality. $x = 5$ gives $23 > 15$, and $x = 6$ gives $27 > 15$, both of which also fail.$exp$,
       version = version + 1
 WHERE id = 'SATM2IRA60X' AND explanation ~ '\m(choice|option|answer)\s+[A-D]\M';

UPDATE public.questions SET explanation = $exp$The correct answer is "Although green roofs provide benefits such as reduced stormwater runoff…" The student's goal is to emphasize a disadvantage, and only this choice highlights the higher installation cost of green roofs. The concessive clause ("Although green roofs provide benefits") acknowledges the advantages while the main clause focuses on the cost disadvantage, effectively emphasizing it. The choices about rainfall retention and cooler roof surfaces present advantages of green roofs without mentioning any disadvantage. The choice providing a neutral definition does not address either advantages or disadvantages.$exp$,
       version = version + 1
 WHERE id = 'SATRW2E2HX6V' AND explanation ~ '\m(choice|option|answer)\s+[A-D]\M';

UPDATE public.questions SET explanation = $exp$The correct answer is "They carry power sources that generate electricity from radioactive decay and have no moving…" The passage explicitly states that the probes' radioisotope thermoelectric generators convert heat from decaying plutonium-238 into electricity "without moving parts that could wear out," directly supporting this. The claim about solar panels engineered to absorb energy at great distances is incorrect because the passage describes nuclear generators, not solar panels. The claims about periodically uploaded software patches and redundant copies of instruments introduce details not mentioned in the passage.$exp$,
       version = version + 1
 WHERE id = 'SATRW2O44RO5' AND explanation ~ '\m(choice|option|answer)\s+[A-D]\M';

-- Post-check: F-57's own measure ("The same count returns 0 after the content fix").
DO $$
DECLARE
  v_left integer;
BEGIN
  SELECT count(*) INTO v_left
    FROM public.servable_questions
   WHERE explanation ~ '\m(choice|option|answer)\s+[A-D]\M';
  IF v_left = 0 THEN
    RAISE NOTICE 'F-57 post-check OK: 0 servable explanations name a choice by letter';
  ELSE
    RAISE NOTICE 'F-57 post-check: % servable explanation(s) still name a choice by letter — ids needed (see PR #1277)', v_left;
  END IF;
END $$;

COMMIT;
