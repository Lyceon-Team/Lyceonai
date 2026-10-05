/**
 * Settings → Data & Privacy → "Cookies and analytics".
 *
 * @spec [Doc 10 §9.11 ("consent withdrawal mechanism in user settings"); GDPR Art. 7(3) via
 *       docs/compliance/legal-drafts/README.md ("Withdrawing is as easy as consenting (footer link,
 *       account settings)"); cookie-banner-text.md "Account settings" heading] | @implemented [2026-10-05]
 *
 * plain English: shows the standing choice and opens the same Cookie settings dialog the banner
 * and the footer open — one dialog, one writer, so withdrawing here records exactly what
 * withdrawing from the footer records.
 */
import { Button } from "@/components/ui/button";
import { openCookieSettings } from "@/lib/analytics/consent";
import {
  useAnalyticsExcluded,
  useConsentSnapshot,
} from "@/components/consent/CookieConsentRoot";

export function CookiesAnalyticsCard(): JSX.Element {
  const { consent } = useConsentSnapshot();
  const { excluded } = useAnalyticsExcluded();
  const status = !excluded && consent.status === "accepted" ? "On" : "Off";
  return (
    <div
      className="flex items-start justify-between gap-4 rounded-md border border-border p-4"
      data-testid="cookies-analytics-card"
    >
      <div>
        <p className="font-medium">Cookies and analytics</p>
        <p className="text-sm text-muted-foreground">Analytics — {status}</p>
      </div>
      <Button variant="outline" onClick={openCookieSettings}>
        Cookie settings
      </Button>
    </div>
  );
}
