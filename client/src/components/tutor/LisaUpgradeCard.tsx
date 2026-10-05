/**
 * @spec [Doc-03B §12.3 ("UI surfaces renewal path"), §6.5 (entitlement before
 *        every other step); Coding Standards §6.1, §11.3; closure plan W4-11;
 *        student-UI register UI-53, UI-44, OQ-44 (ruled 2026-10-03), OQ-54 (a)
 *        and OQ-57 (f) (owner ruling 2026-10-05: "Move the review runner's LISA
 *        panel onto student tokens in #1073 now"); DESIGN.md §1 (tokens only,
 *        14px floor), §3 "Upgrade modal"]
 * @implemented 2026-09-27 | @updated 2026-10-05 — on the student tokens, approved copy only
 *
 * plain English: what an unpaid student sees in the review runner's LISA panel
 * where the composer would be. It is the same card the /chat page shows a
 * free student (UI-56), sized for the panel: LISA's headline and the approved
 * prototype body, both read from the upgrade modal's one copy table
 * (`UPGRADE_MODAL_COPY.tutor_access.plan`, OQ-44), and "Unlock LISA", which
 * opens the app's one upgrade modal for `tutor_access` (UI-44). No new
 * wording: the unapproved `LISA_UPGRADE_PITCH.body` is not shown (OQ-57 (f)).
 *
 * Until 2026-10-05 this drew the shared billing card (`PremiumUpgradePrompt`)
 * with LISA's pitch, on the app-wide light tokens; that is what kept the review
 * runner on the light lock. Trade-off, the same one /chat took under UI-56: the
 * card no longer has the billing card's lapsed-student portal branch. A lapsed
 * student reaches the portal from the modal's "See plans" (Settings → Billing).
 *
 * WHERE IT IS DRAWN, AND WHY IT REPLACES THE COMPOSER. The server checks
 * entitlement before anything else on every tutor route, crisis detection
 * included (Doc 03B §6.5 — kept as is, owner ruling 2026-09-27). So a student
 * the server refuses must never hold a composer that accepts input: whatever
 * they typed would be refused unread. The panel draws this card IN PLACE OF
 * its composer the moment the server answers `entitlement_required`, and
 * never before — see `isLisaEntitlementDenial`.
 */
import type { HttpApiError } from "@/lib/api-error";
import { mapTutorErrorToPremiumReason } from "@/lib/api-error";
import { useUpgradeModal } from "@/components/billing/UpgradeModal";
import { UPGRADE_MODAL_COPY } from "@/components/billing/upgrade-modal";
import { Button } from "@/components/ui/button";
import { LISA_UPGRADE_PITCH } from "@/components/tutor/lisa-upgrade-pitch";

export { LISA_UPGRADE_PITCH };

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

export function LisaUpgradeCard(): JSX.Element {
  const upgrade = useUpgradeModal();
  // The card is drawn only on an `entitlement_required` refusal, which is the plan lock. An
  // under-13 refusal is AGE_RESTRICTION, not an entitlement denial, so it never reaches here.
  const copy = UPGRADE_MODAL_COPY.tutor_access.plan;
  return (
    <div className="shrink-0 p-4" data-testid="lisa-upgrade">
      <section
        aria-labelledby="lisa-upgrade-h"
        className="flex flex-col gap-3 rounded-lg border border-lyc-rule bg-lyc-paper p-5"
      >
        <h2
          id="lisa-upgrade-h"
          className="m-0 font-lyc-serif text-lyc-panel font-semibold text-lyc-ink-strong"
        >
          {copy.title}
        </h2>
        <p className="m-0 text-lyc-body text-lyc-ink">{copy.body}</p>
        <Button
          type="button"
          variant="lyc-primary"
          size="lyc"
          className="self-start"
          data-testid="lisa-upgrade-unlock"
          onClick={() => upgrade.open("tutor_access", "plan")}
        >
          {LISA_UPGRADE_PITCH.actionLabel}
        </Button>
      </section>
    </div>
  );
}
