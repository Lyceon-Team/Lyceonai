/**
 * @spec [Coding Standards §12.2 ("No invasive analytics on student-facing
 *        pages"; "Minimize data collection on all student surfaces");
 *        Privacy Policy v4 §6.6 and §5.2 (Vercel Analytics disclosed);
 *        Doc-06A §5.3 (`infra/route-surface-classification.yaml`, defaults to
 *        deny); owner ruling 2026-09-22 E1 option 3]
 * @implemented 2026-09-22
 *
 * plain English: decides whether a page view may be reported to Vercel
 * Analytics. It answers yes only for the public marketing and legal pages, and
 * no for everything else — which is every page a signed-in student can reach.
 *
 * WHY AN ALLOWLIST AND NOT A BLOCKLIST. A blocklist of student routes is
 * correct on the day it is written and wrong the day someone adds a route.
 * The failure is silent in exactly the wrong direction: the new student page
 * starts reporting and nothing says so. Doc 06A §5.3 specifies the registry
 * that owns this classification as defaults-to-deny for the same reason. An
 * allowlist fails the other way — a new marketing page silently reports
 * nothing until it is added here, which is a missing chart, not a minor's
 * activity on a third-party service.
 *
 * WHY A PREDICATE AND NOT A CONDITIONAL MOUNT. Unmounting `<Analytics />` on
 * student routes is a race: the SPA's first pageview can fire before the
 * router has resolved, and a remount re-injects the script. `beforeSend` runs
 * once per event with that event's URL, after the route is known, and dropping
 * the event means nothing leaves the browser. One predicate, one call site —
 * which is what the ruling asked for.
 *
 * expected outcome: `/`, the marketing pages, the blog, the trust pages, the
 * legal documents and the pre-auth sign-in page report page views. `/chat`,
 * `/practice/*`, `/mastery`, `/review/*`, `/dashboard`,
 * `/profile/*`, `/notifications`, `/guardian`, `/admin/*`, `/upgrade`,
 * `/account/recover`, `/update-password` and anything not listed do not.
 *
 * trade-offs:
 *  - This duplicates the *classification* that Doc 06A §5.3 puts in
 *    `infra/route-surface-classification.yaml` (created 2026-10-03, SEO F12).
 *    The coupling is asserted rather than imported, because this module ships
 *    to the browser and the registry is read at build time: the contract test
 *    requires every prerendered registry route to be allowed here, and every
 *    `RequireRole` route in `App.tsx` to be denied. (Vercel Analytics, and
 *    with it this predicate, is retired by SEO F10.) A route that gains a role guard without
 *    losing its analytics reddens a test.
 *  - Prefix matching, so `/blog/<slug>` and `/legal/<slug>` work without
 *    enumerating slugs. The prefix is matched at a path SEGMENT boundary, so
 *    `/blogging-internal` does not inherit `/blog`'s allowance.
 *  - `/tutor` IS NOT HERE. It is retired (owner ruling 2026-09-29, UI-04): the
 *    SPA route only redirects to the role-gated `/chat`, and it is no longer a
 *    public page. An unlisted path is denied by default, so the redirect
 *    reports nothing.
 *
 * edge cases:
 *  - A malformed or relative URL parses to nothing useful; the predicate
 *    denies rather than guessing. Denying costs a data point.
 *  - Query strings and fragments are ignored: the verdict is the path's.
 *  - Trailing slashes are normalised, so `/blog/` behaves as `/blog`.
 */

/**
 * Exact public paths. These mirror the marketing surface; the contract test
 * holds them to the prerendered rows of `infra/route-surface-classification.yaml`.
 */
const PUBLIC_EXACT: readonly string[] = [
  "/",
  "/login",
  "/signup",
  "/digital-sat",
  "/digital-sat/math",
  "/digital-sat/reading-writing",
  "/blog",
  "/sat-question-of-the-day",
  "/trust",
  "/legal",
  "/privacy",
  "/terms",
];

/**
 * Public path prefixes, matched at a segment boundary. Only where the tail is
 * a content slug — never where it could be an identifier belonging to a person
 * or a session.
 */
const PUBLIC_PREFIXES: readonly string[] = [
  "/blog/",
  "/legal/",
  // The tail is a calendar date (an archive day), never a person or session (SEO Wave 2, Q3).
  "/sat-question-of-the-day/",
];

/** Normalises a path: strips a trailing slash, leaves "/" alone. */
function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

/**
 * True when a page view for this path may be reported. Defaults to false.
 */
export function isAnalyticsAllowedPath(pathname: string): boolean {
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;

  const path = normalisePath(pathname);
  if (PUBLIC_EXACT.includes(path)) return true;

  // `${prefix}` already ends in "/", so this is a segment-boundary match:
  // "/blog/x" matches "/blog/", "/blogging" does not. The tail must be
  // non-empty, or "/blog/" would match here as well as above (harmless, but
  // the two rules should not overlap).
  return PUBLIC_PREFIXES.some(
    (prefix) => path.startsWith(prefix) && path.length > prefix.length,
  );
}

/**
 * The `beforeSend` predicate itself, for `<Analytics />`. Returns the event
 * unchanged on a public path and `null` — which cancels the send — everywhere
 * else.
 *
 * `event.url` is an absolute URL in the browser. It is parsed rather than
 * string-matched so that a query string carrying a path-like value (say
 * `/?next=/chat`) cannot change the verdict.
 */
export function analyticsBeforeSend<T extends { url: string }>(
  event: T,
): T | null {
  const pathname = pathnameOf(event.url);
  return pathname !== null && isAnalyticsAllowedPath(pathname) ? event : null;
}

/**
 * The path an event's URL refers to, or null when it refers to nothing.
 *
 * A base is NOT passed to the absolute parse. `new URL("", base)` succeeds and
 * yields the base's own path, so an empty or junk url would resolve to "/" and
 * be reported as a home-page view — a page the person never visited, counted
 * because the event was malformed. The relative branch is entered only for a
 * string that already starts with "/".
 */
function pathnameOf(url: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  try {
    return new URL(url).pathname;
  } catch {
    // Not absolute. Fall through.
  }
  if (!url.startsWith("/")) return null;
  try {
    return new URL(url, "https://lyceon.ai").pathname;
  } catch {
    return null;
  }
}
