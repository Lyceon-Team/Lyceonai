# Review record: 2026-11-plan

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: 2026-11-plan
Batch PR: #1201

## 1. Claude self-audit

<!-- Written by the produce trigger (Claude Code). One row per item. -->

| Item | Gates | Notes |
| --- | --- | --- |
| `plan` | pass | 13 slots, one per Mon/Wed/Fri in November, from `scripts/content/plan-skeleton.ts`. Every SAT date comes from `shared/sat-test-dates.ts` (College Board, read 2026-10-11), not retyped. The 13 target keywords are unique against the 28 on the site, checked with `normalizedKeyword` (41 of 41 distinct). Each topic is tied to the Nov 7 test, its Nov 20 score release, or the Dec 5 registration deadlines. No topic names AI, automation or process, or anything proprietary; none is aimed at under-13s. Weak spots for Karl: the calendar keywords are not in the 2026-10-02 export (picked for timing, not volume), and two topics sit next to existing pages (see PLAN.md, Notes). W45 is produced now from this draft as the dry run. |

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
