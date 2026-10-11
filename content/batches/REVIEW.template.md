# Review record: CYCLE

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: CYCLE
Batch PR: #PR

## 1. Claude self-audit

<!-- Written by the produce trigger (Claude Code). One row per item. -->

| Item | Gates | Notes |
| --- | --- | --- |
| `slug` | pass | What was checked and anything Karl should know. |

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
