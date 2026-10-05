/**
 * Cookie banner, Cookie settings dialog, GPC notice — and the switch that starts or stops PostHog.
 *
 * @spec [Doc 10 §9.11; docs/compliance/legal-drafts/cookie-banner-text.md Version 1 (every visible
 *       string below is that text); docs/compliance/legal-drafts/README.md banner requirements
 *       (accept and reject equally prominent, no pre-ticked boxes, GPC = reject with the notice in
 *       place of the banner, 6 months, withdrawal as easy as consent, under-13 never loads
 *       analytics, reject = zero analytics requests); SCL-201 IS 1; SCL-204; owner Step 0
 *       decisions 2026-10-05] | @implemented [2026-10-05]
 *
 * plain English: mounted once, inside the auth provider, on every route. Nothing renders and
 * nothing is read until the first effect runs, so the prerendered HTML carries no banner.
 *   - No valid choice and no GPC → the banner, with "Reject analytics" and "Accept analytics" as
 *     identical buttons, plus "Choose settings" and the Cookie Policy link.
 *   - GPC and no choice → the GPC notice instead (analytics is already off).
 *   - "Choose settings", the footer's "Cookie settings" and the Settings page open the dialog,
 *     whose Analytics box starts unticked unless the visitor already accepted.
 *   - PostHog starts only when the choice is "accepted" AND the account is not excluded: a
 *     signed-in account must be known to be 13 or over (`is_under_13 === false`). An excluded
 *     account sees no banner (there is nothing to ask), and if PostHog was already running in the
 *     tab — accepted while signed out, then an excluded account signed in — it is stopped.
 *
 * edge cases: while the session is still resolving nothing starts; an unknown age is excluded.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  closeCookieSettings,
  getConsentSnapshot,
  getServerConsentSnapshot,
  openCookieSettings,
  recordConsentChoice,
  refreshConsent,
  subscribeConsent,
} from "@/lib/analytics/consent";
import {
  analyticsRunning,
  startAnalytics,
  stopAnalytics,
} from "@/lib/analytics/posthog-client";

/**
 * The Cookie Policy is published before launch (owner decision 6, 2026-10-05). Until it is, the
 * link opens the Privacy Policy; on publication this becomes "/legal/cookie-policy".
 */
export const COOKIE_POLICY_HREF = "/legal/privacy-policy";

const GPC_NOTICE_DISMISSED_KEY = "lyceon.gpc-notice.dismissed";

function gpcNoticeDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(GPC_NOTICE_DISMISSED_KEY) === "1";
  } catch {
    // An unreadable store is a definite "not dismissed": the notice shows, which is the safe side.
    return false;
  }
}

function dismissGpcNotice(): void {
  try {
    window.sessionStorage.setItem(GPC_NOTICE_DISMISSED_KEY, "1");
  } catch {
    // Not persisted: the notice shows again on the next page load, which is harmless.
  }
}

export function useConsentSnapshot(): ReturnType<typeof getConsentSnapshot> {
  return useSyncExternalStore(
    subscribeConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  );
}

/** True when this account must never load analytics (SCL-201: under-13 excluded). */
export function useAnalyticsExcluded(): {
  resolved: boolean;
  excluded: boolean;
} {
  const { user, authLoading } = useSupabaseAuth();
  if (authLoading) return { resolved: false, excluded: true };
  return {
    resolved: true,
    excluded: user !== null && user.is_under_13 !== false,
  };
}

export function CookieConsentRoot(): JSX.Element | null {
  const { consent, settingsOpen } = useConsentSnapshot();
  const { resolved, excluded } = useAnalyticsExcluded();
  const [gpcDismissed, setGpcDismissed] = useState(true);

  useEffect(() => {
    refreshConsent();
    setGpcDismissed(gpcNoticeDismissed());
  }, []);

  useEffect(() => {
    // Nothing is decided until both the session and the stored choice have been read.
    if (!resolved || consent.status === "unknown") return;
    if (consent.status === "accepted" && !excluded) {
      void startAnalytics();
    } else if (analyticsRunning()) {
      stopAnalytics();
    }
  }, [consent.status, excluded, resolved]);

  if (consent.status === "unknown" || !resolved) return null;

  return (
    <>
      {!excluded && consent.status === "undecided" && <CookieBanner />}
      {!excluded &&
        consent.status === "refused" &&
        consent.byGpc &&
        !gpcDismissed && (
          <GpcNotice
            onClose={() => {
              dismissGpcNotice();
              setGpcDismissed(true);
            }}
          />
        )}
      <CookieSettingsDialog
        open={settingsOpen}
        excluded={excluded}
        accepted={consent.status === "accepted"}
      />
    </>
  );
}

function CookieBanner(): JSX.Element {
  return (
    <section
      aria-label="Cookies on LYCEON"
      data-testid="cookie-banner"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold">Cookies on LYCEON</h2>
          <p className="text-sm text-muted-foreground">
            We use cookies that are necessary for LYCEON to work. With your
            permission, we would also like to use analytics cookies to
            understand how the service is used and improve it. We do not use
            advertising cookies.
          </p>
          <p className="text-sm">
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={openCookieSettings}
            >
              Choose settings
            </button>
            {" · "}
            <Link
              href={COOKIE_POLICY_HREF}
              className="underline underline-offset-2"
            >
              Cookie Policy
            </Link>
          </p>
        </div>
        {/* Equal prominence: the same component, variant and size for both choices. */}
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            data-testid="cookie-reject"
            onClick={() => recordConsentChoice(false, "banner")}
          >
            Reject analytics
          </Button>
          <Button
            variant="outline"
            data-testid="cookie-accept"
            onClick={() => recordConsentChoice(true, "banner")}
          >
            Accept analytics
          </Button>
        </div>
      </div>
    </section>
  );
}

function GpcNotice({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <section
      aria-label="Global Privacy Control"
      data-testid="gpc-notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-lg"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <p className="text-sm">
          <strong>Your browser has asked us not to use analytics.</strong>{" "}
          Analytics cookies are off. You can change this in{" "}
          <button
            type="button"
            className="underline underline-offset-2"
            onClick={openCookieSettings}
          >
            Cookie settings
          </button>
          .
        </p>
        <Button variant="outline" onClick={onClose}>
          OK
        </Button>
      </div>
    </section>
  );
}

function CookieSettingsDialog({
  open,
  excluded,
  accepted,
}: {
  open: boolean;
  excluded: boolean;
  accepted: boolean;
}): JSX.Element {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) =>
        next ? openCookieSettings() : closeCookieSettings()
      }
    >
      <DialogContent data-testid="cookie-settings">
        {/* Mounted only while open, so the box restarts from the stored choice each time. */}
        {open && <CookieSettingsBody excluded={excluded} accepted={accepted} />}
      </DialogContent>
    </Dialog>
  );
}

function CookieSettingsBody({
  excluded,
  accepted,
}: {
  excluded: boolean;
  accepted: boolean;
}): JSX.Element {
  const [analytics, setAnalytics] = useState(accepted);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Your cookie settings</DialogTitle>
        <DialogDescription className="sr-only">
          Choose which cookies LYCEON may use.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div>
          <p className="font-semibold">Strictly necessary — Always on</p>
          <p className="text-muted-foreground">
            Keep you signed in, protect your account and remember your settings.
          </p>
        </div>
        <div className="flex items-start gap-3">
          <Checkbox
            id="cookie-analytics"
            data-testid="cookie-analytics-toggle"
            checked={analytics}
            disabled={excluded}
            onCheckedChange={(value) => setAnalytics(value === true)}
          />
          <label htmlFor="cookie-analytics">
            <span className="font-semibold">
              Analytics — {analytics ? "On" : "Off"}
            </span>
            <span className="block text-muted-foreground">
              Help us understand how LYCEON is used, including recordings of how
              pages are used. Provided by PostHog.
            </span>
          </label>
        </div>
      </div>
      <DialogFooter className="gap-2 sm:gap-2">
        {/* An excluded account (under 13 or age unknown) never loads analytics, so it has no
            choice to record: every control is disabled rather than logging a meaningless one. */}
        <Button
          variant="outline"
          disabled={excluded}
          onClick={() => recordConsentChoice(false, "settings")}
        >
          Reject all
        </Button>
        <Button
          variant="outline"
          data-testid="cookie-save"
          disabled={excluded}
          onClick={() => recordConsentChoice(analytics, "settings")}
        >
          Save my choices
        </Button>
        <Button
          variant="outline"
          disabled={excluded}
          onClick={() => recordConsentChoice(true, "settings")}
        >
          Accept all
        </Button>
      </DialogFooter>
    </>
  );
}
