/**
 * The sign-up channel and campaign in the browser: read once from the landing address, carried
 * into sign-up on the link itself, sent with the sign-up.
 *
 * @spec [owner brief "Smart landing: new students land on Home; capture sign-up channel" (Karl,
 *       2026-10-28) item 2 ("It must work without the analytics cookie")] | @implemented
 *       [2026-10-28]
 *
 * plain English: at boot the first touch is derived from this page's address
 * (`deriveSignupAttribution`) and held in memory. Nothing is written to a cookie or storage, so
 * no consent is needed and none is consulted. A full page load into sign-up (the homepage's
 * "Sign in" is a plain link) would lose the memory, so a click on a same-origin link to an
 * entry into sign-up gets the two coarse parameters appended to its address; the sign-up page
 * then reads them back as the earlier touch. The values are allowlisted words, never a URL.
 */
import {
  deriveSignupAttribution,
  signupAttributionParams,
  type SignupAttribution,
} from "@lyceon/shared/signup-attribution";

/** Same-origin paths that lead into sign-up (`/signup` redirects to `/login`). */
const SIGNUP_ENTRY_PATHS = new Set(["/login", "/signup"]);

let attribution: SignupAttribution | null = null;
let listening = false;

/**
 * `href` with the first touch appended, when it is a same-origin link into sign-up that does not
 * carry one already; otherwise `href` unchanged.
 */
export function withSignupAttribution(
  href: string,
  origin: string,
  touch: SignupAttribution,
): string {
  const extra = signupAttributionParams(touch);
  if (Object.keys(extra).length === 0) return href;
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch (err: unknown) {
    // Not a URL the browser could follow either: left as it is.
    void err;
    return href;
  }
  if (url.origin !== origin || !SIGNUP_ENTRY_PATHS.has(url.pathname)) {
    return href;
  }
  for (const [name, value] of Object.entries(extra)) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return url.toString();
}

function carryOnClick(event: MouseEvent): void {
  const touch = attribution;
  if (touch === null) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return;
  const current = anchor.getAttribute("href") ?? "";
  const next = withSignupAttribution(current, window.location.origin, touch);
  if (next !== current) anchor.setAttribute("href", next);
}

/** Called once from the client entry, before any client-side navigation can change the URL. */
export function captureSignupAttribution(): void {
  attribution ??= deriveSignupAttribution(window.location.search);
  if (!listening) {
    listening = true;
    // Capture phase: the address is set before the browser (or the router) follows the link.
    document.addEventListener("click", carryOnClick, true);
  }
}

export function signupAttribution(): SignupAttribution {
  return attribution ?? { channel: "direct", campaign: null };
}

/** Tests only: forget the in-memory value, as a new page load would. */
export function resetSignupAttributionForTests(): void {
  attribution = null;
}
