# Review record: 2026-W46

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: 2026-W46
Batch PR: #1445

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
| `when-do-sat-scores-come-out` | When Do SAT Scores Come Out? Nov 2026 Dates \| Lyceon | 2026-11-09 07:00 CT | when do sat scores come out | <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/scores/score-release-dates> <https://satsuite.collegeboard.org/scores/score-release-dates/getting-sat-weekend-scores> <https://satsuite.collegeboard.org/scores/what-scores-mean> | Passed internal audit. |
| `should-you-retake-the-sat` | Should You Retake the SAT? Deciding on Dec 5 \| Lyceon | 2026-11-11 07:00 CT | should i retake the sat | <https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf> <https://satsuite.collegeboard.org/practice/build-your-study-plan> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-benefits> <https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees> <https://satsuite.collegeboard.org/scores/score-release-dates> <https://satsuite.collegeboard.org/scores/what-scores-mean/what-is-good-score> | Passed internal audit. |
| `bluebook-sat-practice-tests` | Bluebook SAT Practice Tests: How to Use Them \| Lyceon | 2026-11-13 07:00 CT | bluebook sat practice | <https://satsuite.collegeboard.org/practice/bluebook> <https://satsuite.collegeboard.org/practice/build-your-study-plan> <https://satsuite.collegeboard.org/practice/practice-tests/bluebook> <https://satsuite.collegeboard.org/practice/student-question-bank> <https://satsuite.collegeboard.org/sat/dates-deadlines> | Passed internal audit. |

## 2. Codex audit

Source: Independent Codex audit, 2026-11-05. Audited PR #1445 at `fb109ac709624d12dbefcdcdf5cc4228e2154594`. The Claude self-audit was excluded from the material read for this review.

| Item | Verdict | Reasons | Evidence |
| --- | --- | --- | --- |
| `when-do-sat-scores-come-out` | REVISE | R2–R3: the FAQ turns the scheduled release date into a guarantee for everyone. Qualify the FAQ and use scheduled-date wording throughout. | The [release calendar](https://satsuite.collegeboard.org/scores/score-release-dates) labels the column “Student Score Release Date.” College Board explicitly says scores “could be delayed while your complaint is investigated” on its [contact page](https://satsuite.collegeboard.org/contact-us). |
| `should-you-retake-the-sat` | REVISE | R2–R3: the same-day calendar entries do not guarantee that every student can see a score before registration closes. The fee figures also need U.S. scope because international testing carries a surcharge. R6: the good-score bullet and the admissions paragraph track the source wording closely. Paraphrase or use a short attributed quote. | [Test calendar](https://satsuite.collegeboard.org/sat/dates-deadlines): “SAT Weekend deadlines expire at 11:59 p.m. ET, U.S.” [Score calendar](https://satsuite.collegeboard.org/scores/score-release-dates): November 20 is the scheduled student release. [Fees](https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees) lists the $68 base fee and links separately to international fees. [Good score](https://satsuite.collegeboard.org/scores/what-scores-mean/what-is-good-score): “Your SAT score is only one piece of the puzzle.” |
| `bluebook-sat-practice-tests` | REVISE | R1–R3: the first paragraph's citation covers timing and scoring but needs direct support for “free.” “This weekend” does not necessarily put the second test on November 28. The FAQ should identify first-module performance as the basis for routing. | The [full-length practice page](https://satsuite.collegeboard.org/practice/practice-tests/bluebook) says the tests are “timed like a real test” with an early-advance exception. The [Bluebook guide](https://satsuite.collegeboard.org/practice/bluebook) says students can “take the same practice tests for free in Bluebook.” Worked check: Nov 14 + 14 days = Nov 28. Nov 15 + 14 days = Nov 29. Dec 5 − 14 days = Nov 21. |

### Source checks and worked evidence

- **Score release.** Reopened the [score calendar](https://satsuite.collegeboard.org/scores/score-release-dates). All five test/release pairs match: Nov 7/20, Dec 5/18, Mar 6/19, May 1/14 and Jun 5/21. “Most scores from weekend tests are released 2–4 weeks after test day” supports the general wait. The same page lists separate in-school dates. The [weekend score instructions](https://satsuite.collegeboard.org/scores/score-release-dates/getting-sat-weekend-scores) confirm the “score report PDF,” “See Score Details,” the four domains in each section, the benchmarks, account troubleshooting and the search by “SAT registration number.” The instructions specify students aged 13 or older for the online account and say the latest score “should be shown” at the top. Preserve those qualifications. [What scores mean](https://satsuite.collegeboard.org/scores/what-scores-mean) confirms 400–1600 total, 200–800 per section, “Score Range” and “each of the eight content areas.” The [test calendar](https://satsuite.collegeboard.org/sat/dates-deadlines) confirms Nov 20 and Nov 24 as December deadlines.
- **Retake.** The [score PDF](https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf) lists “Retaking the SAT if they’d like to test again” and explains expected variation “under identical conditions.” The [test calendar](https://satsuite.collegeboard.org/sat/dates-deadlines) confirms Dec 5, Nov 20 and Nov 24 and the Mar 6 and May 1 spring dates. It also lists June 5 if the copy intends a complete spring list. The [score calendar](https://satsuite.collegeboard.org/scores/score-release-dates) confirms Dec 18. Weekdays recomputed: Nov 20 and Dec 18 are Fridays, Nov 24 is Tuesday and Dec 5 is Saturday. Dec 5 − Nov 20 = 15 calendar days. Cite the calendars alongside the [study plan](https://satsuite.collegeboard.org/practice/build-your-study-plan) for the 15-day paragraph. The study plan supports practice results by content area and “at least two weeks before test day (if possible).” The [score PDF](https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf) supports the corresponding official score-report claim via its Knowledge and Skills section, so cite it with that bullet too. The [fee schedule](https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees) confirms late registration $38, on-time cancellation $34, cancellation free with a waiver, and the requirement to “cancel and register for a new test” to change dates. The [waiver page](https://satsuite.collegeboard.org/sat/registration/fee-waivers/fee-waiver-benefits) confirms “Two free SAT tests.” The [good-score page](https://satsuite.collegeboard.org/scores/what-scores-mean/what-is-good-score) supports college-specific expectations and consideration of grades, essays and extracurriculars.
- **Bluebook.** The [full-length practice page](https://satsuite.collegeboard.org/practice/practice-tests/bluebook) confirms the preview is untimed with no scores or feedback, full-length tests are scored, and early advancement is available in practice. The [how-to guide](https://satsuite.collegeboard.org/practice/bluebook) supports the desk and low-distraction setup, “at least one practice test in Bluebook in one sitting,” adaptive routing, My Practice scores, Score Details, Review, missed-question patterns and “Get Tailored Practice.” Its same-model wording refers to College Board's test format. The [score PDF](https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf) confirms routing is based on performance in the first module. The [study plan](https://satsuite.collegeboard.org/practice/build-your-study-plan) confirms “up to 90 days” for unfinished practice tests and spacing “at least two weeks if your study schedule allows.” Nov 13 to Dec 5 is 22 days, so “three weeks away” is a reasonable approximation. The [Student Question Bank guide](https://satsuite.collegeboard.org/practice/student-question-bank) lists filters for “assessment, test (Reading and Writing or Math), domain, skill, and difficulty level.” Use “section” for Reading and Writing versus Math to avoid confusing it with the assessment filter.

### Claims, links and CI

- The standard diagnostic CTA maps to approved claim inventory row W15 and H43. No additional Lyceon product or outcome promise appears in these three items. The content targets SAT students and families and contains no copied official questions or disclosure of Lyceon mechanisms. The trademark notice is supplied by the shared footer and visible on the existing [blog](https://lyceon.ai/blog).
- The posts match the November brief and each adds a distinct use case to the existing site: release logistics compared with [What Is a Good SAT Score?](https://lyceon.ai/what-is-a-good-sat-score), a date-specific retake decision compared with the score guide, and Bluebook's controls and score review compared with the [two-week plan](https://lyceon.ai/blog/two-week-sat-study-plan) and [free practice test page](https://lyceon.ai/free-sat-practice-test).
- Opened all cited source URLs and the explicit Lyceon links, including [practice questions](https://lyceon.ai/sat-practice-questions). The [score portal](https://studentscores.collegeboard.org), [Find Your Scores](https://findyourscores.collegeboard.org), and [diagnostic signup CTA](https://lyceon.ai/login?mode=signup&next=%2Fpractice%2Fdiagnostic) returned client-rendered pages. The destinations were reached, with authenticated functionality outside this check.
- Head CI was green: [Content batch checks](https://github.com/Lyceon-Team/Lyceonai/actions/runs/41856523236) and [CI](https://github.com/Lyceon-Team/Lyceonai/actions/runs/41856523156) completed successfully, with three CI jobs skipped and all executed jobs passing. Vercel reported success on the same SHA.

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
