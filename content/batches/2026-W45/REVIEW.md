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

<!--
Written by Codex only (Doc 10B §8.7, "Codex audits, it doesn't edit"). One verdict per item:
APPROVE, REVISE or REJECT, each with reasons and evidence (a URL and the quoted text, a recomputed
figure, a CI run). Codex commits carry the trailer `Audit-By: Codex` and may change only this
section. If Codex posted its audit as a pull request comment instead, Claude copies it here
verbatim and the Source line names the comment's URL.
-->

Source: Codex scheduled task, YYYY-MM-DD

| Item | Verdict | Reasons | Evidence |
| --- | --- | --- | --- |
| `slug` | APPROVE | Why. | Source URL and quoted text. |

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
