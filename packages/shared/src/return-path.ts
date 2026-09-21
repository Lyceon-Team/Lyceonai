/**
 * @spec [contracts/auth-standard-flow.contract.md AS-5 (post-auth `next` is an ALLOWLIST, not a
 *        free relative path — server precedent in server/routes/oauth-callback-routes.ts);
 *        Coding Standards §6.1 (server-authoritative), §7.2 (one definition in packages/shared);
 *        owner brief 2026-09-15 Part B (login return path for the guardian deep link)]
 *        | @implemented [2026-09-15]
 *
 * plain English: THE one place that decides whether a "send me back here after login" value
 * is honoured. Consumed by the client (RequireRole captures it into `/login?next=…`, the login
 * page restores it, the Google sign-in forwards it to the server callback) and by the server
 * callback's `parseSafeNext`, so the email/password path and the OAuth path cannot diverge.
 * Expected outcome: only a same-origin, relative path on the allowlist survives — path and
 * query intact — and everything else yields `null`, which callers turn into the role default.
 * Trade-off: the allowlist names route prefixes rather than exact paths because the guardian
 * deep link carries a query (`/guardian?code=…`); a prefix is still an allowlist, and every
 * entry is a route App.tsx mounts. Edge cases rejected on purpose: absolute URLs, protocol-
 * relative `//host`, backslash tricks (`/\evil`), anything with a scheme, control characters,
 * and paths whose first segment is not listed. `/login` itself is never a return path.
 */

export const RETURN_PATH_PARAM = "next";

/** Route prefixes a signed-in user may be returned to. Every entry is a route in App.tsx. */
export const RETURN_PATH_ALLOWLIST: readonly string[] = [
  "/guardian",
  "/dashboard",
  "/profile",
  "/practice",
  "/chat",
  "/full-test",
  "/mastery",
  "/upgrade",
  "/update-password",
  "/notifications",
];

const MAX_RETURN_PATH_LENGTH = 512;

/**
 * Same-origin, relative, allowlisted — or `null`. Pure and total: never throws.
 * `raw` is `unknown` because it comes off a query string on both sides.
 */
export function sanitizeReturnPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_RETURN_PATH_LENGTH) return null;
  // Must be a single leading slash: rejects "", "http://…", "//host", "\\host", "javascript:".
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return null;
  }
  // No control characters, no backslashes anywhere (browsers normalise "\" to "/").
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null;

  // Parse against a fixed origin: anything that resolves elsewhere is off-origin. A malformed
  // value is an EXPECTED failure (Coding Standards §3.6): the URL constructor signals it with a
  // TypeError, which maps to `null`. Anything else is a programming error and is rethrown (§13).
  let parsed: URL;
  try {
    parsed = new URL(value, "https://lyceon.invalid");
  } catch (err) {
    if (err instanceof TypeError) return null;
    throw err;
  }
  if (parsed.origin !== "https://lyceon.invalid") return null;
  if (parsed.username || parsed.password) return null;

  const pathname = parsed.pathname;
  const allowed = RETURN_PATH_ALLOWLIST.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!allowed) return null;

  return `${pathname}${parsed.search}`;
}

/** The login URL that carries a return path, e.g. `/login?next=%2Fguardian%3Fcode%3DABC234`. */
export function loginPathWithReturn(pathAndSearch: string): string {
  const safe = sanitizeReturnPath(pathAndSearch);
  if (safe === null) return "/login";
  return `/login?${RETURN_PATH_PARAM}=${encodeURIComponent(safe)}`;
}

/** Read and sanitise the return path from a query string (`?next=…`), or `null`. */
export function returnPathFromSearch(search: string): string | null {
  // URLSearchParams never throws for a string input; the sanitiser is total.
  return sanitizeReturnPath(new URLSearchParams(search).get(RETURN_PATH_PARAM));
}
