# Review record: 2026-W47

<!--
Doc 10B §8.7: one review record per cycle, written in this order. Karl reads this one file.
Copy to content/batches/<cycle>/REVIEW.md (cycle: 2026-W43 for a weekly batch, 2026-11-plan for a
monthly plan). Keep the four headings exactly as written; CI reads them
(scripts/content/check-batch-pr.ts). One table row per item: the post's slug in backticks, or
`plan` for a monthly plan.
-->

Cycle: 2026-W47
Batch PR: #1476

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
| `sat-registration-deadlines` | SAT Registration Deadlines for 2026-27 \| Lyceon | 2026-11-16 07:00 CT | sat registration deadline | <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/sat/registration/change-cancel/canceling-registration> <https://satsuite.collegeboard.org/sat/registration/change-cancel/changing-registration-info> <https://satsuite.collegeboard.org/sat/registration/fees-refunds/test-fees> <https://satsuite.collegeboard.org/waitlist> | Passed internal audit. |
| `sat-score-report-explained` | The SAT Score Report, Explained \| Lyceon | 2026-11-18 07:00 CT | sat score report | <https://satsuite.collegeboard.org/media/pdf/sat-understanding-scores.pdf> <https://satsuite.collegeboard.org/practice/content-domains> <https://satsuite.collegeboard.org/scores/score-release-dates> <https://satsuite.collegeboard.org/scores/score-release-dates/getting-sat-weekend-scores> <https://satsuite.collegeboard.org/scores/what-scores-mean> | Passed internal audit. |
| `sat-superscore` | What's an SAT Superscore? \| Lyceon | 2026-11-20 07:00 CT | sat superscore | <https://blog.collegeboard.org/what-is-an-sat-superscore> <https://satsuite.collegeboard.org/help-center/which-scores-will-colleges-look-if-my-child-took-sat-more-once> <https://satsuite.collegeboard.org/sat/dates-deadlines> <https://satsuite.collegeboard.org/scores/score-release-dates> <https://satsuite.collegeboard.org/scores/sending-sat-scores/weekend> | Passed internal audit. |

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
