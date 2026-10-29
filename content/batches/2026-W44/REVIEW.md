# Review record: 2026-W44

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: 2026-W44
Batch PR: #1289

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
| `sat-grammar-questions` | SAT Grammar Questions: What They Test \| Lyceon | 2026-10-26 07:00 CT | sat grammar questions | <https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf> <https://satsuite.collegeboard.org/practice/practice-tests/bluebook> <https://satsuite.collegeboard.org/practice/student-question-bank> <https://satsuite.collegeboard.org/sat/dates-deadlines> | Passed internal audit. |
| `sat-math-formulas` | SAT Math Formulas: What You Get and What to Know \| Lyceon | 2026-10-28 07:00 CT | sat math formulas | <https://bluebook.collegeboard.org/students/tools> <https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf> <https://satsuite.collegeboard.org/media/pdf/english-sat-test-directions-bb.pdf> <https://satsuite.collegeboard.org/practice/practice-tests/bluebook> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy> | Passed internal audit. |
| `sat-device-requirements` | SAT Device Requirements: Will Your Device Work? \| Lyceon | 2026-10-30 07:00 CT | sat device requirements | <https://bluebook.collegeboard.org/students/prepare-your-device/approved-devices> <https://bluebook.collegeboard.org/students/sat-weekend> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/device-lending> <https://satsuite.collegeboard.org/sat/device-readiness> | Passed internal audit. |

## 2. Codex audit

Source: Codex scheduled task, 2026-10-22
Audited head: `bd0c02cd510245c9282c1d0e5d2d871869dac527` (PR #1289, `claude/content-2026-W44`).
Scope: all three 2026-W44 articles, including metadata, FAQs, sources and internal links; rubric R1–R12.

| Item | Verdict | Reasons | Evidence |
| --- | --- | --- | --- |
| `sat-grammar-questions` | REVISE | R2/R3: the description reduces grammar to sentence boundaries and word forms, and the Form, Structure, and Sense introduction says these questions ask which word form fits. That omits the listed sentence-structure/modifier-placement skill. Broaden both summaries to match the actual coverage. The restrictive-clause example is sound under its intended identifying reading; the subject/verb, pronoun, finite-verb, tense and modifier examples are original and coherent. The 26% / 11–15 claim and the two skill families are supported. R11: main CI is red; see shared CI evidence below. | [Framework](https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf), printed pp. 67 and 182: “Approximately 26% of operational questions (11–15 questions)” and “Subject-Modifier Placement”. The latter tests placement, not merely inflection. Worked grammar check: “The lab opened late” and “the results were due the next morning” are independent clauses, so a semicolon joins them; a comma alone creates a splice. “Box” takes “is”; the singular team takes “its”; “meeting” alone leaves the committee fragment without a finite predicate; “meets” supplies one. Practice-source checks G1–G2 and date check D1 below. |
| `sat-math-formulas` | REVISE | R1/R2: “you'll work faster if you've used each formula enough to know where it applies” is a factual studying/performance assertion supported only by test directions, which do not establish that effect. Recast it as practical advice without a promised speed benefit, or cite evidence supporting that assertion. The reference-sheet inventory, omitted algebra/trigonometry formulas, calculator availability and date arithmetic check out. R11: main CI is red. | [Bluebook directions](https://satsuite.collegeboard.org/media/pdf/english-sat-test-directions-bb.pdf), §1.7 and reference sheet, PDF pp. 6 and 8: “A reference sheet, calculator, and these directions can be accessed throughout the test.” The reference page contains the listed geometry formulas and angle facts, but no slope, quadratic, vertex, trigonometric-ratio, circle-equation or mean formula. [Testing tools](https://bluebook.collegeboard.org/students/tools): “A reference sheet with commonly used formulas”. [Calculator policy](https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy), which resolves to the in-school calculator-policy page: “toggle between scientific and graphing options at any point in the Math section.” [Framework](https://satsuite.collegeboard.org/media/pdf/assessment-framework-for-digital-sat-suite.pdf), Appendix B, includes linear/nonlinear equations, “quadratic formula”, circles and trigonometry. Worked formula checks M1 below. |
| `sat-device-requirements` | REVISE | R3: the blanket requirement to arrive with exam setup finished needs a College Board loan-device exception. This article explicitly discusses those loans for later tests, whose recipients instead complete setup at the center. Scope the advance-setup instruction to personal/school/friend devices and add the loan-device arrival/setup instruction. Device compatibility, storage, charge, keyboard and Apple-upgrade advice are supported; the article correctly says a new Nov 7 loan request is too late. R11: main CI is red. | [Device lending](https://satsuite.collegeboard.org/sat/device-lending), Step 4: “arrive 30 minutes before the standard check-in time”; the following sentence places pickup, sign-in, exam setup and ticket generation at the center. Its comparability statement is explicitly College Board's reported finding: “no difference in scores”. [Approved devices](https://bluebook.collegeboard.org/students/prepare-your-device/approved-devices): “You cannot run Bluebook on a personal Chromebook or mobile phone.” Windows/Mac/managed Chromebook storage is 1 GB; iPad storage is 250 MB; charge is 3–4 hours. The same page confirms laptop keyboard restrictions, iPad permission, and postponing Apple upgrades. [SAT Weekend](https://bluebook.collegeboard.org/students/sat-weekend): “5 days before test day, complete exam setup”; [device readiness](https://satsuite.collegeboard.org/sat/device-readiness): “1–5 Days Before Your Test”. Date/deadline checks D1 below. |

### Supporting checks

- **G1, question-bank fidelity:** [Student Question Bank](https://satsuite.collegeboard.org/practice/student-question-bank) says “filter the question bank by assessment, test”, and then lists domain, skill and difficulty. This supports the article's filter instructions.
- **G2, practice-test fidelity:** [Bluebook practice tests](https://satsuite.collegeboard.org/practice/practice-tests/bluebook) says “Full-length practice tests are scored” and “review questions, analyze your performance”. This supports reviewing errors after a scored practice test. The study routines in the articles are recommendations, not College Board quotations.
- **D1, dates recomputed:** [Dates and deadlines](https://satsuite.collegeboard.org/sat/dates-deadlines) lists “Nov. 7, 2026” and “Dec. 5, 2026”. November 7 is Saturday. November 7 minus October 26/28/30 is respectively 12/10/8 days. November 7 minus 5 days is Monday, November 2. November 7 minus 30 days is October 8, already past on the device article's October 30 publication date. December 5 minus 30 days is November 5. The [lending page](https://satsuite.collegeboard.org/sat/device-lending) requires registration followed by a request at least 30 days before the test; local borrowing/later registration and the absence of a loan guarantee match the article.
- **M1, mathematics recomputed:** circle area/circumference at r=2 give 4π/4π; rectangle 3×4 gives 12; triangle b=4,h=3 gives 6; 3²+4²=5². Special triangles satisfy x²+(x√3)²=(2x)² and s²+s²=(s√2)². With l=2,w=3,h=4, prism/pyramid volumes are 24/8; with r=2,h=3, cylinder/cone volumes are 12π/4π; sphere volume is 32π/3. A full circle is 360°=2π radians, and a Euclidean triangle totals 180°. Slope from (1,3) to (3,7) is 2, giving y=2x+1. For x²−5x+6=0 the quadratic formula gives (5±1)/2=3 or 2. In vertex form y=a(x−h)²+k, x=h gives y=k (a≠0). A 3–4–5 triangle gives sin=3/5, cos=4/5, tan=3/4 for the angle opposite 3. Center (1,2), r=3 gives (x−1)²+(y−2)²=9; (4,2) satisfies it. Mean of 2,4,6 is 12/3=4. No erroneous formula found.
- **R4/R5/R8/R9/R12:** no new Lyceon capability/outcome claim, mechanism disclosure, bank-size claim, fabricated person/statistic, prohibited process/AI mention or under-13 targeting found in these article bodies. Checked against the head's [claim inventory](https://github.com/Lyceon-Team/Lyceonai/blob/bd0c02cd510245c9282c1d0e5d2d871869dac527/docs/compliance/claim-inventory.md); the standard free diagnostic CTA matches its approved free diagnostic claim. The shared footer supplies the College Board trademark/non-affiliation notice. No article-specific image or video needs alt text or captions.
- **R6/R7/R10:** original grammar examples do not reproduce the framework's sample questions. Standard formulas and official skill labels are not presented as proprietary work. Compared the head's `shared/content/blog.ts`, `shared/content/posts/index.ts` and `shared/content/pages/practice-questions.ts`: the nearest pages are the Reading and Writing section/domain practice pages, the algebra-mistakes article, and the test-day packing article. These new articles add a detailed grammar-skill explanation, a reference-sheet/omitted-formula guide, and device compatibility/borrowing guidance respectively. No duplicate target keyword found in those records. Topics, audiences, dates, internal practice links and CTA fit the approved October plan.
- **R11, links:** reopened all 11 distinct external citations, including both PDFs; they resolve. The calculator-policy URL redirects as described above. All four distinct article-body internal links returned HTTP 200 on 2026-10-22: [practice hub](https://lyceon.ai/sat-practice-questions), [Math](https://lyceon.ai/sat-practice-questions/math), [Reading and Writing](https://lyceon.ai/sat-practice-questions/reading-and-writing), [free practice test](https://lyceon.ai/free-sat-practice-test). The web reader could not retrieve those four, so direct HTTP checks were used. This verifies resolution, not the interactive sign-up flow. The scheduled articles themselves are not yet approved/published.
- **R11, CI blocks every item:** on audited head `bd0c02c`, [CI run 39616786442](https://github.com/Lyceon-Team/Lyceonai/actions/runs/39616786442) concluded **failure**. Job [pg / 119280070954](https://github.com/Lyceon-Team/Lyceonai/actions/runs/39616786442/job/119280070954) failed at **Genesis fresh-apply + determinism + anti-leak gate**; subsequent PG steps were skipped. Main `ci` and `analytics-consent-e2e` jobs passed, including prose, tests, typecheck, build, SEO and crawl checks. [Content batch checks 39616786445](https://github.com/Lyceon-Team/Lyceonai/actions/runs/39616786445) passed; Vercel's status is success. Those successes do not satisfy the rubric's all-green requirement while the main workflow is red. Resolve the failing gate and establish green checks on the revised head before approval.

## 3. Claude response

<!--
Written by the revise trigger (Claude Code). A row for every REVISE (and every REJECT): what was
changed, or why not. One revision round: an item still not approved is carried to the next cycle
("Carried to 2026-W44") and leaves this batch; a REJECTed item is dropped ("Dropped").
-->

| Item | Finding | Response | Commit |
| --- | --- | --- | --- |
| `sat-grammar-questions` | R2/R3: description and Form, Structure, and Sense introduction reduce the group to word forms, omitting sentence structure and modifier placement. | Fixed: the description now says the questions cover boundaries, and form, structure and sense; the section introduction now says they ask whether a word form or a sentence's structure fits its meaning. | 34fac00 |
| `sat-math-formulas` | R1/R2: "you'll work faster if you've used each formula enough" asserts a speed benefit the cited directions do not support. | Fixed: recast as practical advice with no promised effect: look the sheet over before test day to know what is on it and what is not. | 34fac00 |
| `sat-device-requirements` | R3: the blanket instruction to arrive with exam setup finished omits the College Board loan-device exception. | Fixed: the instruction is scoped to your own, a school's or a friend's device; added that a College Board loan device is picked up and set up at the test center, so arrive 30 minutes before the standard check-in time (device lending page added as a source). | 34fac00 |
| all items | R11: main CI red on the audited head (pg job, Genesis fresh-apply + determinism + anti-leak gate). | Not changed by this batch: the batch touches only content modules and this record. Gates run locally on the revised head: build, gate:seo-output, the four content vitest files, Vale and lychee all pass. Green main CI on the revised head is awaited from CI. | n/a |

## 4. Karl decision

<!-- Karl's merge of the batch pull request is the approval (Doc 10B §2.4); a workflow records it. Notes optional. -->
