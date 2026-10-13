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
| `what-to-bring-to-the-sat` | What to Bring to the SAT: Test Day Checklist \| Lyceon | 2026-11-02 07:00 CT | what to bring to the sat | <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/device-readiness> <https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy> <https://satsuite.collegeboard.org/sat/what-to-bring-do/id-requirements> <https://satsuite.collegeboard.org/sat/what-to-bring-do/prohibited-devices> <https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-bring> <https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect> | Passed internal audit. |
| `last-minute-sat-prep` | Last-Minute SAT Prep: The Final Three Days \| Lyceon | 2026-11-04 07:00 CT | last minute sat prep | <https://satsuite.collegeboard.org/practice> <https://satsuite.collegeboard.org/practice/practice-tests/bluebook> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/device-readiness> <https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy> <https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-bring> <https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect> <https://satsuite.collegeboard.org/sat/whats-on-the-test/structure> | Passed internal audit. |
| `how-long-is-the-sat` | How Long Is the SAT? Timing and Breaks \| Lyceon | 2026-11-06 07:00 CT | how long is the sat | <https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect> <https://satsuite.collegeboard.org/sat/whats-on-the-test/structure> <https://satsuite.collegeboard.org/scores/score-release-dates> | Passed internal audit. |

## 2. Codex audit

Source: Codex manual re-audit requested by Karl, 2026-10-12 America/Chicago (2026-10-13 UTC).
Audited content head: `6daf95d42ed764de180998f63b284b115e1d9d1c` (PR #1202).
Eligibility: checklist and claim-inventory changes follow the previously audited content head.

The current Claude self-audit and Claude response were withheld from tool output and not read before these verdicts. This is a new source-based review of all three items. Historical limitation: the earlier run in this conversation exposed the old self-audit; this rerun cannot erase that prior exposure.

| Item | Verdict | Reasons | Evidence |
| --- | --- | --- | --- |
| `what-to-bring-to-the-sat` | REVISE | The prior ID/accommodation issues are fixed. One R2 issue remains in the revised opening ID sentence: “Most students bring…” asserts what a majority of students actually bring, while its source establishes acceptable ID requirements, not observed student behavior. Describe the generally accepted ID types without asserting usage prevalence. The remaining policies, dates, citations, originality, purpose, claims, links and CI pass. | S2 below: the page's requirement is “Be a valid (unexpired) photo ID”; it contains no majority-use evidence. S2 supports the newly added form/age/prior-year/country qualifications, and S4 supports the new accommodation exception. S1/S5/S6/S7/S10 support the rest. |
| `last-minute-sat-prep` | APPROVE | R1–R12 pass. Rechecked every factual block against current sources: date, setup, preview/tools, calculator, timed/scored practice, module navigation/timing, packing and arrival. Early setup allowing troubleshooting and timed practice exposing pacing are reasonable practical inferences, not guaranteed outcomes. The operational final-days checklist adds value beyond the general study guide. | S1/S5/S6/S7/S8/S9/S10/S11. Nov. 7 minus Nov. 4 = 3 days; 64/2 = 32 and 70/2 = 35 minutes. Closest existing page: `/how-to-study-for-the-sat` in `shared/content/pages/guides.ts`, read at the current head. Links/CI and shared claims below. |
| `how-long-is-the-sat` | APPROVE | R1–R12 pass. Rechecked the timing table, adaptation, navigation, breaks/ID, approximate Saturday schedule, device borrowers, submission, release date and extended-time FAQ. The draft distinguishes testing duration from check-in and qualifies the sample schedule. It adds schedule/accommodation detail beyond the existing format overview. | S3/S6/S11. 64 + 70 = 134 min = 2 h 14 min; 54 + 44 = 98 questions; 134 + 10 = 144 min including the scheduled break. These do not calculate an exact dismissal time. Closest pages: `/online-sat-prep` and `/blog/is-digital-sat-harder`, read at the current head. |

### Source fidelity and accuracy (R1–R3)

All eleven cited URLs were reopened on this run. Each source below is mapped to the factual blocks that use it.

- **S1 — CB_WHAT_TO_BRING:** https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-bring — “Bringing a printed ticket is preferred”. Supports the required device/Bluebook/setup, ticket, physical ID, scratch-work materials, account credentials and optional approved calculator, plus every item in the optional packing list. Also supports the last-minute article's packing block. The list is a summary, not a comprehensive accommodations checklist.
- **S2 — CB_ID_REQUIREMENTS:** https://satsuite.collegeboard.org/sat/what-to-bring-do/id-requirements — “Be a valid (unexpired) photo ID”; “SAT Student ID Form”; “valid through the end of December”. Confirms accepted government/current-school physical IDs, exact-name rule, the prior-school-year exception, listed unacceptable documents and keeping ID through breaks. The form is prepared by the current school or a notary for homeschooling and accepted in U.S. centers for under-21 students. Government photo ID is required at 21+. The country-specific section supports directing overseas test takers to applicable rules. It does not report what most students use.
- **S3 — CB_SCORE_RELEASE_DATES:** https://satsuite.collegeboard.org/scores/score-release-dates — “Nov. 7, 2026” / “Nov. 20, 2026” in the test-date/student-release columns. Supports the timing article's release sentence.
- **S4 — CB_PROHIBITED_DEVICES:** https://satsuite.collegeboard.org/sat/what-to-bring-do/prohibited-devices — “Unless students have a College Board–approved accommodation”. Supports the revised prohibition's exception, listed devices, ordinary non-smart watches and possible dismissal/cancellation penalties.
- **S5 — CB_DEVICE_READINESS:** https://satsuite.collegeboard.org/sat/device-readiness — “1–5 Days Before Your Test: Complete a quick exam setup”. Supports setup timing, download/ticket generation and the morning close/reopen/messages/center-info check. Its early-download advice addresses device problems; the prep article's early-setup benefit is an inference.
- **S6 — CB_WHAT_TO_EXPECT:** https://satsuite.collegeboard.org/sat/what-to-bring-do/what-to-expect — “each module is timed separately”; “Once you've moved on from a module, you cannot go back to it.” Supports navigation, preview/reference/calculator/annotation/cross-out/review tools, break/ID rules and automatic submission. Its approximate schedule matches check-in 7:45, doors 8:00, start 8:15–8:30, standard end 10:45–11:00, time-and-one-half noon–12:15, double time 1:00–1:15. Ticket arrival can differ; device borrowers arrive 30 minutes early. The before-noon statement is qualified to standard time.
- **S7 — CB_SAT_DATES:** https://satsuite.collegeboard.org/sat/dates-deadlines — “Nov. 7, 2026”. The Nov. 2/4/6 publication slots are Monday/Wednesday/Friday, respectively 5/3/1 days before that next SAT Weekend test.
- **S8 — CB_PRACTICE:** https://satsuite.collegeboard.org/practice — “Download Bluebook to take official digital practice tests”. Resolves and supports official practice generally; S6, co-cited by the prep article, directly supports the preview/tools claim.
- **S9 — CB_BLUEBOOK_PRACTICE_TESTS:** https://satsuite.collegeboard.org/practice/practice-tests/bluebook — “These tests are timed like a real test”; “Full-length practice tests are scored.” Supports the timed/scored paragraph; the source notes early advancement is possible in practice, which the draft does not contradict.
- **S10 — CB_CALCULATOR:** https://satsuite.collegeboard.org/sat/what-to-bring-do/calculator-policy resolves by redirect to https://satsuite.collegeboard.org/in-school-assessments/calculator-policy — “Desmos calculator embedded in Bluebook”; “Calculators are not required”. Supports built-in graphing/scientific options throughout Math and an optional approved handheld model. The destination applies to the SAT Suite.
- **S11 — CB_STRUCTURE:** https://satsuite.collegeboard.org/sat/whats-on-the-test/structure — “64 (two 32-minute modules)” / “70 (two 35-minute modules)”. The table confirms 54/44 questions. The text confirms equal-length modules, a mixed-difficulty first module and performance-dependent second-module difficulty. Recomputed totals are in the verdict table.

### Claims, originality, purpose and rendering (R4–R10/R12)

Read `docs/compliance/claim-inventory.md` at the current head. No new article-body Lyceon capability or score-gain claim. The inherited free/no-credit-card diagnostic CTA maps to **W4** and the approved standard CTA. The footer slogan maps to the **F13 2026-10-05 amendment** approving its visible use.

Read the current article/CTA renderer, marketing links and footer. The SAT trademark/non-affiliation notice is supplied by the public footer. No proprietary mechanisms, internal product labels, production-process mentions, under-13 targeting, synthetic people or official test questions in the drafts. Short shared factual phrases do not amount to copied narrative passages. The three purposes remain distinct: packing/ID, final-days preparation and full test-day timing. All include relevant practice/score links and the standard CTA. Compared against the existing content definitions: no duplicate normalized keyword among the 28 existing pages.

### Links and head CI (R11)

Direct HTTP GETs returned 200 on this run for every explicit article destination: https://lyceon.ai/free-sat-practice-test, https://lyceon.ai/sat-practice-questions and https://lyceon.ai/what-is-a-good-sat-score. Also opened the rendered CTA https://lyceon.ai/login?mode=signup&next=%2Fpractice%2Fdiagnostic and inherited resource destinations https://lyceon.ai/online-sat-prep, https://lyceon.ai/sat-practice-questions/math and https://lyceon.ai/sat-practice-questions/reading-and-writing; all returned 200.

At audited head `6daf95d42ed764de180998f63b284b115e1d9d1c`, [CI 38337569866](https://github.com/Lyceon-Team/Lyceonai/actions/runs/38337569866) and [Content batch checks 38337569858](https://github.com/Lyceon-Team/Lyceonai/actions/runs/38337569858) completed successfully; Vercel succeeded. Inspected latest jobs and steps: Vale/lychee, whole-suite tests, build, SEO output, built-site crawl and review-record check succeeded. Integration is intentionally skipped; no reported job failed or remained pending.

The checklist remains unapproved after the revision round. Under Doc 10B §8.7 it should be carried to the next cycle by the author. This audit changes only this section; it does not remove the item or alter its publication state.

## 3. Claude response

<!--
Written by the revise trigger (Claude Code). A row for every REVISE (and every REJECT): what was
changed, or why not. One revision round: an item still not approved is carried to the next cycle
("Carried to 2026-W44") and leaves this batch; a REJECTed item is dropped ("Dropped").
-->

| Item | Finding | Response | Commit |
| --- | --- | --- | --- |
| `what-to-bring-to-the-sat` | R2/R3: the device prohibition omits the approved-accommodation exception; the ID rule omits the SAT Student ID Form, the 21+ and country restrictions, and the prior-year school ID exception. | Fixed. The ID section now says a school ID from last school year works through the end of December; adds a paragraph on the SAT Student ID Form (U.S. centers, under 21, prepared by the school or a notary for students schooled at home), the government-ID-only rule at 21 or older, and a pointer to College Board's country-specific rules. The device paragraph now opens "Unless College Board has approved an accommodation for you". Both pages re-read 2026-10-13; the new quotes are in the claim inventory's CB_ID_REQUIREMENTS and CB_PROHIBITED_DEVICES rows. Gates re-run 2026-10-13, all green: draft, quality, publish and schedule (88/88), Vale and lychee (3 posts pass), build, `gate:seo-output`. | 5e686fbf |

## 4. Karl decision

<!-- Karl's merge of the batch pull request is the approval (Doc 10B §2.4); a workflow records it. Notes optional. -->
