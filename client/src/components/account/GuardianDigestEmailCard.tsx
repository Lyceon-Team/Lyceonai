/**
 * Guardian profile → Settings → "Daily summary email".
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Delivery": "The guardian
 *        can turn the digest email off in their notification settings (default on). Students
 *        can't affect it."; contracts/notifications.contract.md C2A.2] | @implemented [2026-10-13]
 *
 * plain English: one checkbox over the guardian's one switch. It shows the server's answer (ON
 * until the guardian turns it off) and writes through the guardian-only route. Turning it off
 * stops the evening email only: plan changes, missed days and back on track still appear in the
 * guardian's notifications as they happen. Rendered on the guardian's own profile page only; the
 * route refuses everyone else whatever the page does.
 */
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  useGuardianDigestPreference,
  useSetGuardianDigestPreference,
} from "@/hooks/useGuardianDigestPreference";
import { SURFACE } from "@/components/product-feedback/surface";

export function GuardianDigestEmailCard(): JSX.Element | null {
  const preference = useGuardianDigestPreference();
  const save = useSetGuardianDigestPreference();
  const look = SURFACE.default;

  if (preference.isError) {
    return (
      <div className={look.row} data-testid="guardian-digest-email-card">
        <p className={look.error} role="alert">
          We couldn&apos;t load your daily summary setting. Please try again.
        </p>
      </div>
    );
  }
  if (preference.data === undefined) return null;

  return (
    <div className={look.row} data-testid="guardian-digest-email-card">
      <div className="flex flex-col gap-2">
        <p className={look.rowTitle}>Daily summary email</p>
        <div className="flex items-start gap-2">
          <Checkbox
            id="guardian-digest-email"
            data-testid="guardian-digest-email-toggle"
            variant={look.checkbox}
            checked={preference.data.enabled}
            disabled={save.isPending}
            onCheckedChange={(checked) => save.mutate(checked === true)}
          />
          <Label
            htmlFor="guardian-digest-email"
            className="text-sm font-normal leading-5"
          >
            Email me a summary at 6 PM Central on days there&apos;s something to
            report about my student&apos;s study plan.
          </Label>
        </div>
        <p className={look.note}>
          Plan changes, missed days and back-on-track notes still appear in your
          notifications.
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
