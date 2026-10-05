/**
 * @spec [closure plan W4-11; student-UI register OQ-44 (ruled 2026-10-03), OQ-57 (f), OQ-54 (a)
 *        (owner ruling 2026-10-05: the review runner's LISA panel moves onto the student tokens),
 *        OQ-61 (h) (owner ruling 2026-10-05: the dead unapproved body is deleted)]
 *       | @implemented [2026-09-27; moved to its own module 2026-10-05; body deleted 2026-10-05]
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
 *
 * There is no body here. The W4-11 draft body was never approved (OQ-44, OQ-57 (f)); once no
 * surface rendered it, it and the billing resolver's `pitch` option that carried it were deleted
 * (OQ-61 (h), owner ruling 2026-10-05). Every LISA card shows the approved prototype body,
 * `UPGRADE_MODAL_COPY.tutor_access.plan.body`.
 */
export const LISA_UPGRADE_PITCH = {
  title: "A Tutor That Knows The SAT And Knows You",
  actionLabel: "Unlock LISA",
} as const;
