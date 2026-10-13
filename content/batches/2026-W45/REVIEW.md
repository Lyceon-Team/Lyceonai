# Review record: 2026-W45

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: 2026-W45
Batch PR: #1202

## 1. Claude self-audit

<!-- Written by the produce trigger (Claude Code). One row per item. -->

| Item | Gates | Notes |
| --- | --- | --- |
| `what-to-bring-to-the-sat` | pass | Mon 2026-11-02 07:00 CT · target `what to bring to the sat`. The test-day checklist, ID rules, banned devices, exam setup and arrival time. Every block cites College Board (CB_WHAT_TO_BRING, CB_ID_REQUIREMENTS, CB_PROHIBITED_DEVICES, CB_DEVICE_READINESS, CB_WHAT_TO_EXPECT, CB_CALCULATOR, CB_SAT_DATES); no Lyceon claim. Gates run 2026-10-11 on the branch head, all green: draft gate, quality gates, publish gate and schedule (88/88 tests); Vale (Microsoft + ai-tells) and lychee via `scripts/content/lint-prose.sh`; `pnpm -s run build` and `gate:seo-output` ("3 withheld post(s) have no page, no sitemap entry and no copy in the build"). |
| `last-minute-sat-prep` | pass | Wed 2026-11-04 07:00 CT · target `last minute sat prep` (500/month in the 2026-10-02 export). Exam setup, the Bluebook test preview and its tools, the built-in calculator, one timed practice test, the module timing, the night before. All College Board (CB_DEVICE_READINESS, CB_PRACTICE, CB_WHAT_TO_EXPECT, CB_CALCULATOR, CB_BLUEBOOK_PRACTICE_TESTS, CB_STRUCTURE, CB_WHAT_TO_BRING, CB_SAT_DATES); no Lyceon claim. Two sentences are my reasoning from the sources, worth Codex's R2 look: early setup "leaves time to sort out a device problem" (CB_DEVICE_READINESS advises early download for that reason), and a practice test "shows you the pacing" (CB: the tests are "timed like a real test"). |
| `how-long-is-the-sat` | pass | Fri 2026-11-06 07:00 CT · target `how long is the sat`. Section and module timing (table), the adaptive second module as College Board describes it, the 10-minute break, the sample Saturday schedule, the Nov 20 score release, extended-time end times. All College Board (CB_STRUCTURE, CB_WHAT_TO_EXPECT, CB_SCORE_RELEASE_DATES); no Lyceon claim. |

Notes for Karl and Codex:

- **New sources.** Seven College Board pages were added to `shared/seo/sources.ts` and to the claim inventory's new table "Content pipeline sources (batch 2026-W45)", each with the quoted text, all read 2026-10-11. No Lyceon-specific claim was added or used.
- **Plan.** The topics come from the November plan, which is still a draft PR (#1201). This batch was produced ahead of it, as the pipeline's dry run, so the posts can go out before the Nov 7 test.
- **Publishing.** The posts are unapproved and withheld until Karl merges this PR into `social`, then `social` into `main`. Each goes live at 07:00 Central on its date.

## 2. Codex audit

Source: Codex manual run requested by Karl, 2026-10-12 (America/Chicago; verification completed 2026-10-13 UTC).
Audited content head: `191fa27034dc32bdd607cd6b683d844da9549e6b` (PR #1202).

**Review-order limitation:** the attempted filter of REVIEW.md did not remove Claude's self-audit, so it was exposed before verdicts were formed. This run does not satisfy the rubric's blind-order prerequisite. Findings below were recomputed from the drafts, current official pages, repository inventory and CI rather than accepted from the self-audit. APPROVE below describes the substantive checks; a fresh blind review is still needed for independent-stage clearance.

| Item | Verdict | Reasons | Evidence |
| --- | --- | --- | --- |
| `what-to-bring-to-the-sat` | REVISE | R2/R3: the device prohibition omits the approved-accommodation exception. The universal government-or-school photo-ID rule omits the accepted SAT Student ID Form and the age/country restrictions on school IDs. Qualify these rules and direct readers to the applicable ID requirements; retain the prior-school-year validity exception. The remaining checklist, arrival and setup facts are supported. R1 and R4–R12 pass substantively. | B2: current ID policy includes an ID form for qualifying U.S. test takers, requires government ID at age 21+, and accepts prior-year school IDs through December. B4: the prohibition expressly starts with an accommodation exception. B1/B5/B6/B7 support the other blocks. CI and links: C1/L1 below. |
| `last-minute-sat-prep` | APPROVE | R1–R12 pass substantively. Each factual block cites an official source; setup, preview/tools, calculator, timed/scored practice, timing, packing and arrival are supported. Early setup leaving troubleshooting time and a timed practice test showing pacing are reasonable inferences, not College Board guarantees. No score-gain claim is made. The final-three-days focus and operational checklist add value beyond the general study guide. | B5/B6/B8/B9/B10/B11; 2026-11-07 minus 2026-11-04 = 3 calendar days. 64/2 = 32 and 70/2 = 35 minutes. Closest page: `/how-to-study-for-the-sat`, `shared/content/pages/guides.ts`, which covers ongoing study rather than this final-days checklist. C1/L1 and claim check below. |
| `how-long-is-the-sat` | APPROVE | R1–R12 pass substantively. Section/question table, equal modules, adaptation, navigation, break rules, arrival, loaned-device setup, submission, score release and extended-time sample end times match official pages. Sample Saturday times are correctly qualified as approximate and dependent on the ticket/accommodation. The detailed schedule and accommodation FAQ add value beyond the existing format overview. | B3/B6/B7/B11. 64 + 70 = 134 minutes = 2 h 14 min; 54 + 44 = 98 questions; 134 + 10 = 144 minutes including the scheduled break, excluding check-in/instructions. Closest pages: `/online-sat-prep` and `/blog/is-digital-sat-harder`. C1/L1 and claim check below. |

### Current sources and sentence checks

All eleven cited URLs were reopened successfully. Evidence keys map to the drafts' cited sources, not to the inventory's historical quotes.

- **B1 — CB_WHAT_TO_BRING:** https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-bring — “Bringing a printed ticket is preferred”. The charged-device/Bluebook/setup, ticket, physical ID, scratch-work materials, login and optional calculator list matches the page. The watch, charger, backpack, snack/drink and backup-device list also matches. It additionally requires wired headphones for an approved embedded text-to-speech accommodation.
- **B2 — CB_ID_REQUIREMENTS:** https://satsuite.collegeboard.org/sat/what-to-bring-do/id-requirements — “SAT Student ID Form”; “valid through the end of December”; “only acceptable form of identification is an official government-issued photo ID”. These support the exceptions finding. The form is accepted at U.S. centers for students under 21; the government-ID-only rule applies at 21+. Country-specific restrictions also apply. Full legal-name matching, physical originals, the listed unacceptable documents and keeping ID during breaks are supported.
- **B3 — CB_SCORE_RELEASE_DATES:** https://satsuite.collegeboard.org/scores/score-release-dates — “Nov. 7, 2026” / “Nov. 20, 2026” in the test-date/student-release columns. The timing post uses the student date, not the Nov. 23 educator date.
- **B4 — CB_PROHIBITED_DEVICES:** https://satsuite.collegeboard.org/sat/what-to-bring-do/prohibited-devices — “Unless students have a College Board–approved accommodation”. The listed phones, watches/trackers, earbuds and separate timers are prohibited absent that exception. Simple non-smart watches are permitted; dismissal and score cancellation are possible penalties.
- **B5 — CB_DEVICE_READINESS:** https://satsuite.collegeboard.org/sat/device-readiness — “1–5 Days Before Your Test: Complete a quick exam setup”. Setup downloads the test and creates the ticket; the morning close/reopen/messages/center-information check is supported. The page advises downloading 30 days ahead for device troubleshooting; the draft's early-setup benefit is an inference, not that exact recommendation.
- **B6 — CB_WHAT_TO_EXPECT:** https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect — “each module is timed separately”; “Once you've moved on from a module, you cannot go back to it.” Supports the drafts' navigation/timer claims. Also confirms the preview/tools, individual timing, 10-minute break, lost time for unscheduled breaks, ID checks, automatic submission and before-noon expectation. Sample schedule: 7:45 check-in, 8:00 doors close, 8:15–8:30 start, 10:45–11:00 standard-time end, noon–12:15 time-and-one-half end, 1:00–1:15 double-time end. Ticket times can differ; device borrowers arrive 30 minutes early. These are official approximate end times, not calculated exact dismissal promises.
- **B7 — CB_SAT_DATES:** https://satsuite.collegeboard.org/sat/dates-deadlines — “Nov. 7, 2026”. This is the next SAT Weekend date at the posts' Nov. 2/4/6 publication slots. Those dates are Monday/Wednesday/Friday and respectively 5/3/1 calendar days beforehand.
- **B8 — CB_PRACTICE:** https://satsuite.collegeboard.org/practice — “Download Bluebook to take official digital practice tests”. This page resolves, but its current overview no longer contains the older test-preview sentence in the inventory. The co-cited B6 directly supports the preview/tools sentence, so that sentence remains supported.
- **B9 — CB_BLUEBOOK_PRACTICE_TESTS:** https://satsuite.collegeboard.org/practice/practice-tests/bluebook — “These tests are timed like a real test”; “Full-length practice tests are scored.” Supports the practice-test paragraph. The page also notes practice allows advancing early; the draft makes no contrary claim.
- **B10 — CB_CALCULATOR:** https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy redirects successfully to https://satsuite.collegeboard.org/in-school-assessments/calculator-policy — “Desmos calculator embedded in Bluebook”; “Calculators are not required”. Supports calculator availability throughout Math and the optional approved handheld calculator. The destination covers the SAT Suite and prohibits CAS calculators; the draft's FAQ correctly says an acceptable calculator.
- **B11 — CB_STRUCTURE:** https://satsuite.collegeboard.org/sat/whats-on-the-test/structure — “64 (two 32-minute modules)” / “70 (two 35-minute modules)”; “2 equal-length modules”. The official table gives 54/44 questions; its text describes the first-module difficulty mix and performance-dependent second module. Both drafts' timing and adaptation statements match. Arithmetic is recomputed in the verdicts.

### Other rubric checks

- **R4 claims:** no Lyceon capability or outcome claim in the new article prose. The rendered standard CTA, “Start with the free diagnostic. No credit card required.”, is supported by claim-inventory **W4** and the approved standard-CTA ruling. The inherited footer slogan maps to the inventory's **F13 / 2026-10-05 amendment** approving that visible slogan; the older X1 replacement row alone is not the current ruling.
- **R5/R8/R9/R12:** no proprietary mechanisms, bank size, invented people/statistics, production-process language or under-13 targeting in the three drafts. SAT module adaptivity is the official test's public format. Prose is direct. `blog-post.tsx` renders `PublicLayout` → `Footer.tsx`, which supplies the SAT registration/non-affiliation notice.
- **R6:** compared all drafts with their cited pages. No official test questions or copied narrative passages; short checklist/timing/policy phrases overlap with the official factual wording.
- **R7/R10:** distinct reader purposes: packing/ID, final-days preparation, and full test-day timing. None duplicates an existing normalized target keyword among the 28 existing pages. All have the standard CTA and relevant practice/score links. Each fits its corresponding plan slot; the plan itself remains unapproved PR #1201 and needs the separate plan decision.

### Links and CI

**L1:** Direct HTTP GETs on this run returned 200 for https://lyceon.ai/free-sat-practice-test, https://lyceon.ai/sat-practice-questions and https://lyceon.ai/what-is-a-good-sat-score. The shared CTA https://lyceon.ai/login?mode=signup&next=%2Fpractice%2Fdiagnostic also returned 200. The inherited related-resource links https://lyceon.ai/online-sat-prep, https://lyceon.ai/sat-practice-questions/math and https://lyceon.ai/sat-practice-questions/reading-and-writing returned 200. Web retrieval could not open the first three Lyceon URLs, so direct HTTP results, route definitions and CI crawl evidence were used.

**C1:** Head `191fa27034dc32bdd607cd6b683d844da9549e6b`: [CI run 38128890898](https://github.com/Lyceon-Team/Lyceonai/actions/runs/38128890898) and [Content batch checks 38128890912](https://github.com/Lyceon-Team/Lyceonai/actions/runs/38128890912) completed successfully; Vercel status also succeeded. Inspected latest jobs/steps: content prose, whole-suite tests, typechecks, lint, build, SEO output and built-site crawl all succeeded. CI job 114438979276 logs confirm all three posts pass Vale/lychee, draft/quality-gate tests pass, and all three withheld posts have no page, sitemap entry or copy in the build. Integration is explicitly skipped; no reported job failed or remained pending. The content review-record check passes while this PR is draft, which does not mean the Codex verdict requirement was already satisfied.

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
