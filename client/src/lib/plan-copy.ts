/**
 * What the free plan includes and what a paid plan adds: the one approved wording.
 *
 * @spec [DESIGN.md §4 Help ("Seven FAQs, which are approved copy"); prototype Help.dc.html, FAQ 1
 *        "What is free, and what needs a paid plan?"; register §2 (the projection is free — Step 2
 *        ruling 4); student-UI register UI-58, OQ-59 (h) (owner ruling 2026-10-05: "replace
 *        /upgrade's plan copy with the approved free/paid wording from the Help FAQ (projection
 *        is free)"); CLAUDE.md Public Disclosure Doctrine §2 (outcomes, never mechanisms)]
 *        | @implemented [2026-10-05]
 *
 * plain English: the Help FAQ's answer is these two sentences joined by a space, and the plans
 * page (`/upgrade`) shows the same two sentences. Both import them from here, so the two surfaces
 * cannot drift apart. Change the wording here only, and only with the owner's approval.
 *
 * edge cases: "40 practice questions a day" states a configured value (OQ-59 (f)); if that value
 * changes, this sentence must change with it. Settings → Billing's free box keeps the Settings
 * prototype's own wording (a different approved source) and does not use these.
 */

/** The free plan, as the Help FAQ states it. The projection is free. */
export const PLAN_FREE_INCLUDES =
  "Free: the diagnostic, your projected score, 40 practice questions a day and unlimited review.";

/** What a paid plan adds, as the Help FAQ states it. */
export const PLAN_PAID_ADDS =
  "Paid plans add your study calendar, mastery for every domain and skill, full-length practice tests and LISA, your tutor.";
