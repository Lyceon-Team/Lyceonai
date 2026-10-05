/**
 * The homepage hero experiment (`homepage-hero`): its copy, where an assigned variant is kept,
 * and the inline script that shows it before first paint.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner rulings 2026-10-05 on F13 Step 0:
 *       decision 5 (no flicker: the variant applies from the NEXT homepage view, via an inline
 *       script with a CSP hash and `ph_`-prefixed storage, exposure only when displayed) and
 *       decision 6 (the experiment runs now, superseding R13/P2; recorded as an SCL-213
 *       addendum); owner Step 0 decision 1, 2026-10-05 (nothing loads or sends before Accept)]
 *       | @implemented [2026-10-05]
 *
 * plain English:
 *  - Variant A ("control") is what the page is prerendered with and what every visitor without
 *    analytics consent sees. No consent means PostHog never loads, so no flag is ever requested.
 *  - "Valid consent" is the consent store's own rule (`consentIsCurrent`): accepted on the
 *    current banner version, made no later than now and under 6 months ago.
 *  - With consent, PostHog's existing flag request assigns a variant. posthog-client.ts copies it
 *    into localStorage under HERO_VARIANT_STORAGE_KEY. The hero does NOT change on that view.
 *  - On a later homepage view, HERO_SWAP_SCRIPT (inline, right after the hero, before first paint)
 *    swaps in variant B's text when B is stored and consent is still valid; the React hero reads
 *    the same value on its first render, so nothing changes after paint. The exposure event is
 *    sent only on a view where the stored variant is what the visitor sees.
 *  - The key starts with `ph_`, so withdrawing consent deletes it with PostHog's own storage
 *    (deletePostHogStorage), and a reload then shows A.
 *
 * trade-off: a visitor who signs up from the view where they gave consent is never in the
 * experiment (owner-accepted, decision 5). The inline script restates the consent-cookie rule
 * (version, accepted, 6 months) in plain JS because it runs before any module loads;
 * hero-experiment.test.ts runs the script and `storedHeroVariant` over the same inputs and
 * requires the same answer, as theme.boot.test.ts does for the theme script.
 */
import {
  CONSENT_COOKIE_NAME,
  CONSENT_MAX_AGE_SECONDS,
  COOKIE_BANNER_VERSION,
  consentIsCurrent,
  parseConsentCookieValue,
} from "@lyceon/shared/analytics-consent-schema";

/** The PostHog feature flag behind the experiment. */
export const HERO_FLAG_KEY = "homepage-hero";

/** PostHog's multivariate keys for an experiment: "control" is A, "test" is B. */
export const HERO_VARIANTS = ["control", "test"] as const;
export type HeroVariant = (typeof HERO_VARIANTS)[number];

/** `ph_`-prefixed: withdrawal's deletePostHogStorage removes it with PostHog's own keys. */
export const HERO_VARIANT_STORAGE_KEY = "ph_lyceon_homepage_hero";

/** The element ids the swap script and the React hero share. */
export const HERO_TITLE_ID = "hero-title";
export const HERO_SUB_ID = "hero-sub";

/** Approved by Karl 2026-10-05 (F13 brief; Control A sub and Variant B per Step 0 rulings 1, 2). */
export const HERO_COPY: Readonly<
  Record<HeroVariant, { title: string; sub: string }>
> = {
  control: {
    title: "SAT prep that adapts to you.",
    sub: "An always-available alternative to private tutoring: free daily practice with a worked explanation for every question, and on paid plans a study plan that adapts to your weak areas, LISA your AI tutor, full-length practice tests and a progress view for parents.",
  },
  test: {
    title: "See real SAT progress before test day.",
    sub: "Your student practices every day. You see a read-only progress summary by section and topic while they are on a paid plan, without scheduling a single session.",
  },
};

export function isHeroVariant(value: unknown): value is HeroVariant {
  return value === "control" || value === "test";
}

/** The consent cookie's value from a `document.cookie` string, or null. */
function consentCookieValue(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === CONSENT_COOKIE_NAME) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * The variant to show on this homepage view: the stored one, only while analytics consent is
 * valid (current banner version, accepted, under 6 months old). Otherwise null, which is A.
 */
export function storedHeroVariant(
  cookie: string,
  storage: Pick<Storage, "getItem"> | null,
  nowSeconds: number,
): HeroVariant | null {
  const raw = consentCookieValue(cookie);
  const consent = raw === null ? null : parseConsentCookieValue(raw);
  if (consent === null || !consent.analytics) return null;
  if (!consentIsCurrent(consent.decidedAtSeconds, nowSeconds)) return null;
  if (storage === null) return null;
  const stored = storage.getItem(HERO_VARIANT_STORAGE_KEY);
  return isHeroVariant(stored) ? stored : null;
}

/** `storedHeroVariant` for this page; null where storage is unavailable (private mode, blocked). */
export function currentHeroVariant(): HeroVariant | null {
  if (typeof window === "undefined") return null;
  let storage: Storage | null;
  try {
    storage = window.localStorage;
  } catch (err) {
    // A blocked localStorage getter throws a SecurityError (a DOMException): an expected
    // failure, which means "nothing stored", so A. Anything else is a programming error.
    if (err instanceof DOMException) return null;
    throw err;
  }
  return storedHeroVariant(document.cookie, storage, Date.now() / 1000);
}

/** Keep the assigned variant for the next homepage view. False when storage refuses it. */
export function storeHeroVariant(variant: HeroVariant): boolean {
  try {
    window.localStorage.setItem(HERO_VARIANT_STORAGE_KEY, variant);
    return true;
  } catch (err) {
    // Quota exceeded or storage blocked (DOMException): the visitor simply stays on A.
    if (err instanceof DOMException) return false;
    throw err;
  }
}

/**
 * The inline script. Static text (its sha256 is in vercel.json's page script-src and checked
 * against the built page by scripts/ci/page-csp-built-hash-gate.mjs), so it may only depend on
 * constants. Runs after the hero's subtitle is parsed and before first paint.
 */
export const HERO_SWAP_SCRIPT = `(function(){try{var m=/(?:^|;\\s*)${CONSENT_COOKIE_NAME}=${COOKIE_BANNER_VERSION}\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.a\\.(\\d+)(?:;|$)/.exec(document.cookie);if(!m)return;var a=Math.floor(Date.now()/1000)-Number(m[1]);if(a<0||a>=${CONSENT_MAX_AGE_SECONDS})return;if(window.localStorage.getItem(${JSON.stringify(HERO_VARIANT_STORAGE_KEY)})!=="test")return;var t=document.getElementById(${JSON.stringify(HERO_TITLE_ID)}),s=document.getElementById(${JSON.stringify(HERO_SUB_ID)});if(!t||!s)return;t.textContent=${JSON.stringify(HERO_COPY.test.title)};s.textContent=${JSON.stringify(HERO_COPY.test.sub)};}catch(e){}})();`;
