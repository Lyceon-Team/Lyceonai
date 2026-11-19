# Review record: 2026-W48

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: 2026-W48
Batch PR: #1497

## 1. Claude self-audit

<!--
Written by the produce trigger (Claude Code). Claude's self-audit is private (Karl, 2026-10-13;
SCL-229): Claude audits and fixes everything before opening the pull request, and this section is
only the structural record of what was produced. Print it, never type it:
  pnpm exec tsx scripts/content/production-record.ts <cycle>
One row per item; the last cell is "Passed internal audit.". No findings, reasoning, notes or
doubts, here or anywhere else in this section; CI refuses any other line.
-->

| Item | Title | Publishes | Target keyword | Sources | Audit |
| --- | --- | --- | --- | --- | --- |
| `send-sat-scores-to-colleges` | How to Send SAT Scores to Colleges \| Lyceon | 2026-11-23 07:00 CT | send sat scores | <https://blog.collegeboard.org/what-is-an-sat-superscore> <https://satsuite.collegeboard.org/media/pdf/sat-student-guide.pdf> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees> <https://satsuite.collegeboard.org/scores/score-release-dates> <https://satsuite.collegeboard.org/scores/sending-sat-scores/weekend> | Passed internal audit. |
| `sat-test-strategies` | SAT Test Strategies: Pacing and Habits \| Lyceon | 2026-11-25 07:00 CT | sat test strategies | <https://satsuite.collegeboard.org/media/pdf/sat-student-guide.pdf> <https://satsuite.collegeboard.org/practice/practice-tests/bluebook> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy> <https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing> <https://satsuite.collegeboard.org/sat/whats-on-the-test/structure> | Passed internal audit. |
| `desmos-on-the-sat` | Desmos on the SAT: Using the Built-In Calculator \| Lyceon | 2026-11-27 07:00 CT | desmos sat | <https://blog.desmos.com/articles/how-to-points-of-interest/> <https://bluebook.collegeboard.org/students/tools> <https://satsuite.collegeboard.org/media/pdf/sat-student-guide.pdf> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy> <https://www.desmos.com/assessment-pdfs/CollegeBoard_Desmos_Calculator_AP_SAT.pdf> | Passed internal audit. |

## 2. Codex audit

Source: Codex scheduled task, 2026-11-19
Audited head: `dd11951fe9a09b844e53cc5a78aaadf1ca90a216` on `claude/content-2026-W48`.
Discovery: the only open PR targeting `social` was #1497. This section contained a template, not a completed audit; all three items qualified.

| Item | Verdict | Reasons | Evidence |
| --- | --- | --- | --- |
| `send-sat-scores-to-colleges` | REVISE | R3: remove the assertion that 10 business days “is two weeks on the calendar.” Holidays can extend that interval, especially in this Thanksgiving-week publication slot. Retain the source's typical sending window and distinguish sending from guaranteed arrival or college processing. R11: its superscore link currently returns HTTP 404; verify it after the destination's scheduled November 20 publication and before this article publishes November 23. This is a scheduled dependency, not proof of a broken route. Other source, claim, originality, audience and brief checks passed. | Worked calendar check and source evidence below; direct HTTP result for https://lyceon.ai/blog/sat-superscore on November 19: 404. CI and content checks passed on the audited head. |
| `sat-test-strategies` | APPROVE | R1–R12 passed. Timing, question counts, tools, guessing guidance and Reading and Writing ordering match official sources; computed averages and publication-relative date are correct. Pacing checkpoints, reading the question first and reserving review time are the article's practical advice, not measured outcome claims or College Board requirements. Adds question-by-question habits beyond the existing duration and final-days checklists. | 32×60÷27 = 71.111… seconds; 35×60÷22 = 95.4545… seconds; December 5 minus November 25 = 10 days. Official evidence and successful link/CI checks below. |
| `desmos-on-the-sat` | APPROVE | R1–R12 passed. Calculator availability, modes, restrictions, testing-version differences and points of interest match the sources. Both original worked examples are correct. The only article-specific Lyceon product sentence matches approved claim W13 verbatim; no new outcome claim. Adds testing-version differences and graph examples beyond the formula reference and practice hub. | 2x+3 = 7−x ⇒ 3x = 4 ⇒ x = 4/3 ≈ 1.333; x²−6x+5 = (x−1)(x−5) = (x−3)²−4 ⇒ roots 1 and 5, minimum (3,−4). December 5 minus November 27 = 8 days. W13 approval and official evidence below. |

### Score-sending evidence and required correction

- [College Board sending instructions](https://satsuite.collegeboard.org/scores/sending-sat-scores/weekend): “typically sent within 5–10 business days”. This supports a sending estimate, not a guaranteed college receipt deadline. The page also supports the four ordering steps, whole-test-date selection, college-policy display, released-scores-only rush delivery, free registration sends around two weeks after testing, direct official reporting and unlimited eligible fee-waiver reports.
- Worked counterexample to the calendar conversion: place an illustrative order Monday, November 23; begin counting Tuesday, November 24; omit weekends and Thanksgiving Thursday, November 26. The ten business dates are November 24, 25, 27, 30 and December 1, 2, 3, 4, 7, 8. That reaches December 8, fifteen calendar days after the order. This illustrates the problem; it does not predict College Board's actual processing schedule. [OPM's 2026 holiday calendar](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/#url=2026) lists Thanksgiving on November 26. Revise to allow for weekends, holidays and each college's receipt/processing requirements.
- [College Board fees](https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees): “$15 per report”; rush “$31” and “Additional score report fees apply.” Worked total: $31+$15 = $46 for one paid rush report. The article's fees agree.
- [2026–27 Student Guide](https://satsuite.collegeboard.org/media/pdf/sat-student-guide.pdf), printed pp. 19–20: supports the four free recipients, nine-day selection/change window, current-registration scores unless others are requested, one fee for multiple dates to the same institution, noncancelable orders, campus-system caution and paid Score Choice. Default reporting covers the “most recent six administrations.” November 7 + 9 days = November 16, before this article's November 23 slot; December 5 + 9 days = December 14.
- [Score-release calendar](https://satsuite.collegeboard.org/scores/score-release-dates): “Nov. 7, 2026” → “Nov. 20, 2026”; “Dec. 5, 2026” → “Dec. 18, 2026”. November 20 is Friday. [Test calendar](https://satsuite.collegeboard.org/sat/dates-deadlines) lists “December 5, 2026”; the article's test date matches.
- [Superscore definition](https://blog.collegeboard.org/what-is-an-sat-superscore): “use your best section-level scores, even if they’re from different tests.” Supports the explanation; this post concentrates on ordering rather than duplicating the existing superscore article.

### Strategy evidence

- [Official structure](https://satsuite.collegeboard.org/sat/whats-on-the-test/structure): “64 (two 32-minute modules)” / 54 questions; “70 (two 35-minute modules)” / 44 questions. The per-module counts are 54÷2 = 27 and 44÷2 = 22. Standard-time scope is implicit in these official timings; students with accommodations should use their own time allowance.
- [Student Guide](https://satsuite.collegeboard.org/media/pdf/sat-student-guide.pdf), printed p. 2 and p. 18: confirms the hideable countdown and five-minute alert/forced display, within-module return, skipped/marked question menu, option elimination, non-Math highlighting, Math reference sheet and “For most students, it’s better to guess than leave a question blank”. The article preserves the qualification.
- [Reading and Writing](https://satsuite.collegeboard.org/sat/whats-on-the-test/reading-writing): “short reading passages (or passage pairs) followed by a single multiple-choice question”; similar-skill questions are “arranged from easiest to hardest.” The article's passage shorthand is consistent with this format.
- [Bluebook practice](https://satsuite.collegeboard.org/practice/practice-tests/bluebook): “These tests are timed like a real test”; “Full-length practice tests are scored.” Supports the rehearsal paragraph. The calculator-policy source below supports calculator-optional Math and scratch-work advice.

### Desmos evidence and claims

- [Calculator policy](https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy) resolves to College Board's SAT Suite calculator policy. “Students can toggle between scientific and graphing options at any point in the Math section.” The policy also confirms non-CAS handheld restrictions, keeping handhelds under the desk during Reading and Writing, familiar-calculator advice, scratch work, questions better solved without a calculator, and built-in fallback if a handheld fails.
- [Bluebook tools](https://bluebook.collegeboard.org/students/tools): “You can drag it anywhere on the screen.” Supports calculator positioning; the Student Guide confirms availability throughout Math.
- [Desmos testing-calculator specification](https://www.desmos.com/assessment-pdfs/CollegeBoard_Desmos_Calculator_AP_SAT.pdf): “Images, folders, and notes are disabled on your test.” Also confirms the unchanged scientific version, automatic Log mode for applicable regressions, and Testing-page practice versions.
- [Desmos points of interest](https://blog.desmos.com/articles/how-to-points-of-interest/): “Click on your curve or the equation to display its Points of Interest.” Supports the graph interaction; the algebra above independently verifies both examples.
- Claim inventory W13 explicitly covers “Lyceon practice includes a built-in Desmos calculator on every Math question,” with F6 approval, October 3, 2026, answer 4. The post reproduces that approved wording. No additional Lyceon product/outcome claim requires approval. The shared CTA matches the approved free-diagnostic wording.

### Shared rubric and link checks

All 13 unique external citations were reopened on November 19, 2026, including both PDFs. No copied official test question, invented student/statistic, internal mechanism, bank size, AI/process disclosure or under-13 targeting found. The shared public footer on the audited head carries the SAT trademark/non-affiliation notice. Existing claim approvals apply to the common CTA/footer. No new Karl approval for a novel claim is requested by these items; Karl's batch approval remains required.

Compared with `sat-superscore`, `how-long-is-the-sat`, `last-minute-sat-prep`, the live practice hub and formula article: these three posts add distinct ordering, pacing and calculator tasks, respectively. Keywords, audiences, scheduled slots and intent match the November plan.

Opened every explicit internal article link. HTTP 200 confirmed for:
- https://lyceon.ai/what-is-a-good-sat-score
- https://lyceon.ai/sat-practice-questions
- https://lyceon.ai/free-sat-practice-test
- https://lyceon.ai/blog/sat-math-formulas
- https://lyceon.ai/blog/last-minute-sat-prep
- https://lyceon.ai/blog/how-long-is-the-sat

The web reader could not retrieve the last two; independent direct HTTP requests returned 200. https://lyceon.ai/blog/sat-superscore returned 404 by direct request; its head-branch source schedules publication for November 20, so this dependency must be rechecked before November 23. No content was edited to resolve it.

### CI on audited head

- [CI run 44334683880](https://github.com/Lyceon-Team/Lyceonai/actions/runs/44334683880): success. Inspected jobs and steps: Vale/lychee content prose gates, tests, typechecks, lint, build, SEO output gate and built-site crawl passed; executed PG and consent-browser jobs passed. Configuration-skipped jobs/steps are not represented as executed passes.
- [Content batch checks 44334684257](https://github.com/Lyceon-Team/Lyceonai/actions/runs/44334684257): success; review-record job passed.
- Vercel commit status: success. Earlier canceled attempts are superseded by the successful latest runs.
- These results apply to `dd11951fe9a09b844e53cc5a78aaadf1ca90a216`, before the audit-only commit. Any later content revision requires renewed audit and green checks.

## 3. Claude response

<!--
Written by the revise trigger (Claude Code). A row for every REVISE (and every REJECT): what was
changed, or why not. One revision round: an item still not approved is carried to the next cycle
("Carried to 2026-W44") and leaves this batch; a REJECTed item is dropped ("Dropped").
-->

| Item | Finding | Response | Commit |
| --- | --- | --- | --- |
| `slug` | The finding. | Fixed: what changed. | abc1234 |

## 4. Karl decision

<!-- Karl's merge of the batch pull request is the approval (Doc 10B §2.4); a workflow records it. Notes optional. -->
