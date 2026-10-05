/**
 * Cookie banner, Cookie settings dialog, GPC notice — and the switch that starts or stops PostHog.
 *
 * @spec [Doc 10 §9.11; docs/compliance/legal-drafts/cookie-banner-text.md Version 2 (every visible
 *       string below is that text); docs/compliance/legal-drafts/README.md banner requirements
 *       (accept and reject equally prominent, no pre-ticked boxes, GPC = reject with the notice in
 *       place of the banner, 6 months, withdrawal as easy as consent, under-13 never loads
 *       analytics, reject = zero analytics requests); SCL-201 IS 1; SCL-204; owner Step 0
 *       decisions 2026-10-05; owner ruling 2026-10-05 (industry-standard wording and layout:
 *       Version 2)] | @implemented [2026-10-05]
 *
 * plain English: mounted once, inside the auth provider, on every route. Nothing renders and
 * nothing is read until the first effect runs, so the prerendered HTML carries no banner.
 *   - No valid choice and no GPC → the banner: "We use cookies", the body with its Cookie Policy
 *     link, and three buttons of one size and style — "Reject all", "Accept all", "Cookie
 *     settings" (which opens the dialog).
 *   - GPC and no choice → the GPC notice instead (analytics is already off), with "OK".
 *   - The banner's "Cookie settings", the footer's and the Settings page's open the dialog,
 *     whose Analytics switch starts off unless the visitor already accepted.
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { readDocumentTheme, subscribeDocumentTheme } from "@/lib/theme";
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

/**
 * The consent surfaces follow the app's one theme setting (<html data-theme>) with the app's own
 * dark tokens: `dark` on the surface scopes index.css's `.dark` values to it alone. Owner ruling
 * 2026-10-05: banner and dialog in light and dark. Prerender reads "light".
 */
function useSurfaceThemeClass(): string {
  const theme = useSyncExternalStore(
    subscribeDocumentTheme,
    readDocumentTheme,
    () => "light" as const,
  );
  return theme === "dark" ? "consent-surface dark" : "consent-surface";
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

/** One size and one style for every choice, so Reject is exactly as prominent as Accept. */
const CHOICE_BUTTON = "w-full sm:w-auto sm:min-w-[9rem]";

function CookieBanner(): JSX.Element {
  const themeClass = useSurfaceThemeClass();
  return (
    <section
      aria-labelledby="cookie-banner-heading"
      data-testid="cookie-banner"
      className={`${themeClass} fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 text-foreground shadow-lg sm:p-6`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2 md:max-w-2xl">
          <h2 id="cookie-banner-heading" className="text-base font-semibold">
            We use cookies
          </h2>
          <p className="text-sm text-muted-foreground">
            We use necessary cookies to make LYCEON work. With your permission,
            we&apos;d also like to use analytics cookies to understand how
            people use the site and improve it. We don&apos;t use advertising
            cookies.{" "}
            <Link
              href={COOKIE_POLICY_HREF}
              className="font-medium text-foreground underline underline-offset-2"
            >
              Cookie Policy
            </Link>
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className={CHOICE_BUTTON}
            data-testid="cookie-reject"
            onClick={() => recordConsentChoice(false, "banner")}
          >
            Reject all
          </Button>
          <Button
            variant="outline"
            className={CHOICE_BUTTON}
            data-testid="cookie-accept"
            onClick={() => recordConsentChoice(true, "banner")}
          >
            Accept all
          </Button>
          <Button
            variant="outline"
            className={CHOICE_BUTTON}
            data-testid="cookie-open-settings"
            onClick={openCookieSettings}
          >
            Cookie settings
          </Button>
        </div>
      </div>
    </section>
  );
}

function GpcNotice({ onClose }: { onClose: () => void }): JSX.Element {
  const themeClass = useSurfaceThemeClass();
  return (
    <section
      aria-label="Global Privacy Control"
      data-testid="gpc-notice"
      className={`${themeClass} fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 text-foreground shadow-lg sm:p-6`}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">
          Your browser sent a Global Privacy Control signal, so analytics
          cookies are off.
        </p>
        <Button variant="outline" className={CHOICE_BUTTON} onClick={onClose}>
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
  const themeClass = useSurfaceThemeClass();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) =>
        next ? openCookieSettings() : closeCookieSettings()
      }
    >
      <DialogContent
        data-testid="cookie-settings"
        className={`${themeClass} max-w-lg bg-background text-foreground`}
      >
        {/* Mounted only while open, so the toggle restarts from the stored choice each time. */}
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
        <DialogTitle>Cookie settings</DialogTitle>
        <DialogDescription className="sr-only">
          Choose which cookies LYCEON may use.
        </DialogDescription>
      </DialogHeader>
      <div className="divide-y divide-border text-sm">
        <div className="flex items-start justify-between gap-4 py-3">
          <div>
            <p className="font-semibold">Strictly necessary</p>
            <p className="text-muted-foreground">
              Keep you signed in, protect your account and remember your
              settings.
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            Always on
          </span>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <div>
            <p id="cookie-analytics-label" className="font-semibold">
              Analytics
            </p>
            <p className="text-muted-foreground">
              Help us understand how LYCEON is used, including recordings of how
              pages are used. Provided by PostHog.
            </p>
          </div>
          {/* A standard on/off switch; off unless the visitor already accepted (no pre-ticking). */}
          <button
            type="button"
            role="switch"
            aria-checked={analytics}
            aria-labelledby="cookie-analytics-label"
            data-testid="cookie-analytics-toggle"
            disabled={excluded}
            onClick={() => setAnalytics((on) => !on)}
            // Off: outlined track, muted knob. On: filled track, contrasting knob. Distinct in
            // both themes without relying on colour alone (the knob also moves).
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              analytics
                ? "border-primary bg-primary"
                : "border-muted-foreground bg-transparent"
            }`}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-4 w-4 rounded-full transition-transform ${
                analytics
                  ? "translate-x-[1.375rem] bg-primary-foreground"
                  : "translate-x-[0.125rem] bg-muted-foreground"
              }`}
            />
          </button>
        </div>
      </div>
      {/* An excluded account (under 13 or age unknown) never loads analytics, so it has no
          choice to record: every control is disabled rather than logging a meaningless one. */}
      <DialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
        <Button
          variant="outline"
          className={CHOICE_BUTTON}
          disabled={excluded}
          onClick={() => recordConsentChoice(false, "settings")}
        >
          Reject all
        </Button>
        <Button
          variant="outline"
          className={CHOICE_BUTTON}
          data-testid="cookie-save"
          disabled={excluded}
          onClick={() => recordConsentChoice(analytics, "settings")}
        >
          Save choices
        </Button>
        <Button
          variant="outline"
          className={CHOICE_BUTTON}
          disabled={excluded}
          onClick={() => recordConsentChoice(true, "settings")}
        >
          Accept all
        </Button>
      </DialogFooter>
    </>
  );
}
