/**
 * Settings → Data & Privacy → "Product update emails" (the marketing opt-in toggle).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R26 ("Settings toggle"), row Q5; Doc 10 §9.21
 *       (revocable, separate from ToS); owner answers 2026-10-05: its own endpoint
 *       (PUT /api/profile/marketing-consent); self-contained so the student-UI rebuild (UI-58)
 *       must mount it on its new Settings page] | @implemented [2026-10-05]
 *
 * plain English: one checkbox with the same sentence as the onboarding step. Reads the stored
 * value from the shared profile query and writes through `useSetMarketingConsent`; the box shows
 * the server's answer, never an optimistic guess. Hidden for an account that cannot opt in
 * (under 13, or no date of birth) unless it is somehow on, in which case it is shown so it can be
 * turned off — revocation always works. Consent is never a default: the box is only ever ticked
 * by the person.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  useMarketingToggleState,
  useSetMarketingConsent,
} from "@/lib/product-feedback-api";
import { SURFACE, type Surface } from "@/components/product-feedback/surface";
import { MARKETING_CONSENT_LABEL } from "../../../../packages/shared/src/marketing-consent-schema";

export function MarketingEmailCard({
  variant = "default",
}: {
  /** `lyc` on student Settings (inside the `.lyc` root); `default` on the guardian page. */
  variant?: Surface;
} = {}): JSX.Element | null {
  const state = useMarketingToggleState();
  const save = useSetMarketingConsent();
  if (state.kind !== "ready") return null;
  const look = SURFACE[variant];

  return (
    <div className={look.row} data-testid="marketing-email-card">
      <div className="flex flex-col gap-2">
        <p className={look.rowTitle}>Product update emails</p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="settings-marketing-opt-in"
            data-testid="settings-marketing-opt-in"
            variant={look.checkbox}
            checked={state.optedIn}
            disabled={save.isPending}
            onCheckedChange={(checked) => save.mutate(checked === true)}
          />
          <Label
            htmlFor="settings-marketing-opt-in"
            className={
              variant === "lyc"
                ? "text-lyc-body font-normal text-lyc-ink"
                : "text-sm font-normal leading-5"
            }
          >
            {MARKETING_CONSENT_LABEL}
          </Label>
        </div>
        <p className={look.note}>
          You can change this at any time. Account and security emails are sent
          either way.
        </p>
        {save.isError ? (
          <p className={look.error} role="alert">
            Your choice couldn&apos;t be saved. Please try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}
