/**
 * @spec [Doc-03B §12.3 ("UI surfaces renewal path"), §6.5 (entitlement before
 *        every other step); Coding Standards §6.1, §11.3; closure plan W4-11]
 * @implemented 2026-09-27
 *
 * plain English: what an unpaid student sees wherever LISA would otherwise
 * be — the one billing card (`PremiumUpgradePrompt`), with LISA's own pitch.
 * Not a second card: the state, the destination, the lapsed-student portal
 * branch and the look all stay the shared card's. Only the words for a
 * student who has never paid are LISA's.
 *
 * WHERE IT IS DRAWN, AND WHY IT REPLACES THE COMPOSER. The server checks
 * entitlement before anything else on every tutor route, crisis detection
 * included (Doc 03B §6.5 — kept as is, owner ruling 2026-09-27). So a student
 * the server refuses must never hold a composer that accepts input: whatever
 * they typed would be refused unread. Every LISA surface draws this card IN
 * PLACE OF its composer the moment the server answers `entitlement_required`,
 * and never before — see `isLisaEntitlementDenial`.
 */
import type { HttpApiError } from "@/lib/api-error";
import { mapTutorErrorToPremiumReason } from "@/lib/api-error";
import { PremiumUpgradePrompt } from "@/components/billing/PremiumUpgradePrompt";
import type { BillingCtaPitch } from "@/lib/billing-cta";

/**
 * LISA's pitch. The headline is Karl's; the supporting line and the button
 * are drafts awaiting his approval (W4-11 PR). Every claim is true of the
 * shipped tutor: its context carries the student's mastery (Doc 03A), it
 * teaches from the platform's own question bank, and in review it opens on
 * the exact question the student missed.
 */
export const LISA_UPGRADE_PITCH: BillingCtaPitch = {
  title: "A Tutor That Knows The SAT And Knows You",
  body: "LISA knows which skills you've mastered and which still need work, and it teaches from the same questions you practice with. In review, it walks you through the exact questions you got wrong.",
  actionLabel: "Unlock LISA",
};

/**
 * True only when the SERVER refused this request for entitlement. The client
 * never decides access: with no refusal there is no card, so a paying student
 * — whose requests are never refused — never sees one, and a network or 5xx
 * error keeps its own handling instead of turning into a paywall.
 */
export function isLisaEntitlementDenial(
  error: HttpApiError | null | undefined,
): boolean {
  return error != null && mapTutorErrorToPremiumReason(error) !== null;
}

export function LisaUpgradeCard() {
  return (
    <div className="p-4" data-testid="lisa-upgrade">
      <PremiumUpgradePrompt
        featureBenefit="LISA"
        pitch={LISA_UPGRADE_PITCH}
        mode="inline"
      />
    </div>
  );
}
