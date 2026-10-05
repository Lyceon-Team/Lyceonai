/**
 * @spec [closure plan W4-11; student-UI register OQ-44 (ruled 2026-10-03), OQ-57 (f), OQ-54 (a)
 *        (owner ruling 2026-10-05: the review runner's LISA panel moves onto the student tokens)]
 *       | @implemented [2026-09-27; moved to its own module 2026-10-05]
 *
 * plain English: LISA's pitch words, in a module of their own so the upgrade modal's copy table
 * (`upgrade-modal.ts`, which takes LISA's headline from here) and the LISA upgrade card (which
 * takes its words from that table) do not import each other. Before 2026-10-05 this lived in
 * `LisaUpgradeCard.tsx`; that file re-exports it, so existing importers are unchanged.
 *
 * What is approved, and where it is shown (OQ-44, Karl 2026-10-03: "use the approved prototype
 * copy (Full-Length, mastery, and LISA's shipped headline). No new wording"):
 *   - `title`: Karl's headline. Shown by the upgrade modal, the /chat locked card and the review
 *     runner's LISA card, through `UPGRADE_MODAL_COPY.tutor_access`.
 *   - `actionLabel` ("Unlock LISA"): the button on both LISA locked cards.
 *   - `body`: a W4-11 draft that was never approved (OQ-44, OQ-57 (f)). Since 2026-10-05 NO
 *     surface renders it: the review runner's card shows the approved prototype body
 *     (`UPGRADE_MODAL_COPY.tutor_access.plan.body`), as /chat does. It stays only because the
 *     billing CTA resolver's pitch test (`billing-cta.pitch.test.ts`) exercises the pitch shape.
 */
import type { BillingCtaPitch } from "@/lib/billing-cta";

export const LISA_UPGRADE_PITCH: BillingCtaPitch = {
  title: "A Tutor That Knows The SAT And Knows You",
  body: "LISA knows which skills you've mastered and which still need work, and it teaches from the same questions you practice with. In review, it walks you through the exact questions you got wrong.",
  actionLabel: "Unlock LISA",
};
