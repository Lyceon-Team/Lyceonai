/**
 * What the free plan includes and what a paid plan adds: the one approved wording.
 *
 * @spec [DESIGN.md §4 Help ("Seven FAQs, which are approved copy"); prototype Help.dc.html, FAQ 1
 *        "What is free, and what needs a paid plan?"; register §2 (the projection is free — Step 2
 *        ruling 4); student-UI register UI-58, OQ-59 (h) (owner ruling 2026-10-05: "replace
 *        /upgrade's plan copy with the approved free/paid wording from the Help FAQ (projection
 *        is free)"); register UI-64, OQ-68 (d) (owner ruling, Karl, 2026-10-08: "The '40
 *        questions' copy reads the server quota value (the same source as the 402)"); CLAUDE.md
 *        Public Disclosure Doctrine §2 (outcomes, never mechanisms)]
 *        | @implemented [2026-10-05; OQ-68 (d) 2026-10-08]
 *
 * plain English: the Help FAQ's answer is these two sentences joined by a space, and the plans
 * page (`/upgrade`) and Settings → Billing's free box show the same two sentences (the free box
 * since OQ-61 (e), owner ruling 2026-10-05: "your recommendations stand" — align it with the
 * Help FAQ wording). All three build them from here, so the surfaces cannot drift apart. Change
 * the wording here only, and only with the owner's approval.
 *
 * The daily number is never written here (OQ-68 (d)). It is `freeDailyLimit` from
 * `GET /api/practice/quota` (`useFreeDailyLimit`), the server's `daily_quota_free`, the value the
 * practice 402 carries. Until that read has answered, or when it fails, the sentence names
 * "daily practice questions" without a number, never a remembered one.
 */

/** The free plan, as the Help FAQ states it, with the server's daily limit (null: no number). */
export function planFreeIncludes(freeDailyLimit: number | null): string {
  const practice =
    freeDailyLimit === null
      ? "daily practice questions"
      : `${freeDailyLimit} practice ${freeDailyLimit === 1 ? "question" : "questions"} a day`;
  return `Free: the diagnostic, your projected score, ${practice} and unlimited review.`;
}

/** What a paid plan adds, as the Help FAQ states it. */
export const PLAN_PAID_ADDS =
  "Paid plans add your study calendar, mastery for every domain and skill, full-length tests and LISA, your tutor.";
