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
--  F-57 is CLOSED (owner rulings on #1277, Karl, 2026-10-21): the pattern behind it,
--  `\m(choice|option|answer)\s+[A-D]\M`, run against production returned 0 rows (Claude chat's
--  report of 2026-10-21). The three guarded F-57 re-statements this file first carried
--  (SATM2IRA60X, SATRW2E2HX6V, SATRW2O44RO5) are therefore dropped; only the SATM26DQWW4
--  correction remains.
--
-- Rollback: the WAS text below; `version` is decremented by the same statement.

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

COMMIT;
