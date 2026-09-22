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
 * `/practice/*`, `/full-test`, `/mastery`, `/review-errors`, `/dashboard`,
 * `/profile/*`, `/notifications`, `/guardian`, `/admin/*`, `/upgrade`,
 * `/account/recover`, `/update-password` and anything not listed do not.
 *
 * trade-offs:
 *  - This duplicates the *classification* that Doc 06A §5.3 puts in
 *    `infra/route-surface-classification.yaml`. That file does not exist and
 *    belongs to the Doc 06A workstream; the owner ruling leaves it there. So
 *    the coupling is asserted instead of imported: the contract test requires
 *    every `PUBLIC_SSR_ROUTES` key to be allowed here, and every `RequireRole`
 *    route in `App.tsx` to be denied. A route that gains a role guard without
 *    losing its analytics reddens a test.
 *  - Prefix matching, so `/blog/<slug>` and `/legal/<slug>` work without
 *    enumerating slugs. The prefix is matched at a path SEGMENT boundary, so
 *    `/blogging-internal` does not inherit `/blog`'s allowance.
 *  - `/tutor` IS NOT HERE, although `PUBLIC_SSR_ROUTES` lists it. That path is
 *    both: the server renders a public "Tutor Transparency" page for a
 *    logged-out visitor or a crawler, and the SPA route is wrapped in
 *    `RequireRole allow={["student","admin"]}`. Two different pages live at
 *    one URL and the analytics event cannot tell them apart, so the
 *    student-facing reading wins and the marketing page loses its page view.
 *    Deny-on-conflict is the whole point of defaults-to-deny.
 *
 * edge cases:
 *  - A malformed or relative URL parses to nothing useful; the predicate
 *    denies rather than guessing. Denying costs a data point.
 *  - Query strings and fragments are ignored: the verdict is the path's.
 *  - Trailing slashes are normalised, so `/blog/` behaves as `/blog`.
 */

/**
 * Exact public paths. These mirror the marketing surface; the contract test
 * holds them to `server/seo-content.ts`'s `PUBLIC_SSR_ROUTES`.
 */
const PUBLIC_EXACT: readonly string[] = [
  "/",
  "/login",
  "/signup",
  "/digital-sat",
  "/digital-sat/math",
  "/digital-sat/reading-writing",
  "/blog",
  "/trust",
  "/trust/evidence",
  "/legal",
  "/privacy",
  "/terms",
];

/**
 * Public path prefixes, matched at a segment boundary. Only where the tail is
 * a content slug — never where it could be an identifier belonging to a person
 * or a session.
 */
const PUBLIC_PREFIXES: readonly string[] = ["/blog/", "/legal/"];

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
