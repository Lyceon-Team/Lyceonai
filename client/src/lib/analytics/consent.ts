/**
 * The visitor's cookie choice: read, decided, remembered, logged.
 *
 * @spec [Doc 10 §9.11 (one-click accept / refuse; 6-month do-not-re-ask; machine-readable browser
 *       signal honoured; consent log; withdrawal in settings); docs/compliance/legal-drafts/README.md
 *       banner requirements (GPC = reject and the GPC notice replaces the banner; nothing beyond
 *       strictly necessary storage before a choice; reject means zero analytics requests);
 *       cookie-banner-text.md Version 1; owner Step 0 decision 1, 2026-10-05 (nothing loads or
 *       sends before Accept)] | @implemented [2026-10-05]
 *
 * plain English: one small store, read with `useSyncExternalStore`. The state is
 *   - `undecided`  — no valid consent cookie and no GPC signal: the banner shows;
 *   - `refused`    — the visitor refused, or the browser sends GPC and the visitor has not opted
 *                    in since: analytics never loads;
 *   - `accepted`   — the visitor accepted: analytics may load (the exclusions in
 *                    AnalyticsConsentRoot still apply).
 * A choice writes the strictly necessary consent cookie (6 months) and POSTs the consent log.
 * An explicit choice made in Cookie settings overrides GPC — the GPC notice says so.
 *
 * The store reads `document` only from `refreshConsent()`, which the root calls in an effect, so
 * the prerendered HTML never contains a banner and the server never touches browser globals.
 */
import {
  CONSENT_COOKIE_NAME,
  CONSENT_MAX_AGE_SECONDS,
  consentIsCurrent,
  COOKIE_BANNER_VERSION,
  formatConsentCookieValue,
  parseConsentCookieValue,
  type ConsentChoiceSource,
  type StoredConsent,
} from "@lyceon/shared/analytics-consent-schema";

export type ConsentState =
  | { status: "unknown" }
  | { status: "undecided" }
  | { status: "refused"; byGpc: boolean }
  | { status: "accepted" };

type Snapshot = { consent: ConsentState; settingsOpen: boolean };

let snapshot: Snapshot = {
  consent: { status: "unknown" },
  settingsOpen: false,
};
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

export function subscribeConsent(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getConsentSnapshot(): Snapshot {
  return snapshot;
}

/** The server snapshot: nothing is known while prerendering. */
export function getServerConsentSnapshot(): Snapshot {
  return { consent: { status: "unknown" }, settingsOpen: false };
}

/** The Global Privacy Control signal (globalprivacycontrol.org). */
export function browserSendsGpc(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: unknown };
  return nav.globalPrivacyControl === true;
}

function readStoredConsent(): StoredConsent | null {
  const prefix = `${CONSENT_COOKIE_NAME}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return parseConsentCookieValue(
        decodeURIComponent(trimmed.slice(prefix.length)),
      );
    }
  }
  return null;
}

function stateFrom(stored: StoredConsent | null, gpc: boolean): ConsentState {
  if (stored !== null) {
    if (consentIsCurrent(stored.decidedAtSeconds, Date.now() / 1000)) {
      return stored.analytics
        ? { status: "accepted" }
        : { status: "refused", byGpc: false };
    }
  }
  if (gpc) return { status: "refused", byGpc: true };
  return { status: "undecided" };
}

/** Re-read the cookie and the GPC signal. Browser-only; called from an effect. */
export function refreshConsent(): void {
  publish({
    ...snapshot,
    consent: stateFrom(readStoredConsent(), browserSendsGpc()),
  });
}

/** The consent id to reuse for a new choice, so one browser's choices share one id. */
function consentIdForNewChoice(): string {
  return readStoredConsent()?.consentId ?? crypto.randomUUID();
}

/**
 * Record a choice: write the cookie, update the store, POST the log. The POST is best-effort —
 * the visitor's choice takes effect from the cookie whether or not the log write succeeds, and a
 * failure is not retried from here (it is visible server-side as a missing row, never as a
 * wrong one).
 */
export function recordConsentChoice(
  analytics: boolean,
  source: ConsentChoiceSource,
): void {
  const stored: StoredConsent = {
    consentId: consentIdForNewChoice(),
    analytics,
    bannerVersion: COOKIE_BANNER_VERSION,
    decidedAtSeconds: Math.floor(Date.now() / 1000),
  };
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(formatConsentCookieValue(stored))}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; Path=/; SameSite=Lax${secure}`;
  publish({
    settingsOpen: false,
    consent: analytics
      ? { status: "accepted" }
      : { status: "refused", byGpc: false },
  });
  void fetch("/api/public/cookie-consent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "omit",
    keepalive: true,
    body: JSON.stringify({
      consent_id: stored.consentId,
      analytics,
      banner_version: COOKIE_BANNER_VERSION,
      source,
    }),
  }).catch((err: unknown) => {
    // The choice already stands (cookie written above); only the audit row is missing.
    // eslint-disable-next-line no-console -- the client has no structured logger; error name only.
    console.warn(
      "cookie consent log write failed",
      err instanceof Error ? err.name : "unknown",
    );
  });
}

export function openCookieSettings(): void {
  publish({ ...snapshot, settingsOpen: true });
}

export function closeCookieSettings(): void {
  publish({ ...snapshot, settingsOpen: false });
}
