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
 *
 * @spec [AS-5; AS-3 post-auth landing matrix; student-ui register UI-03] | @implemented [2026-09-29]
 * plain English: the return path now also survives first-time onboarding (`/profile/complete?next=…`),
 * and the final landing is role-aware — `postAuthDestination` is the one decision the login page,
 * the OAuth callback and the onboarding page all make, so none of them can drop `next` again.
 */

export const RETURN_PATH_PARAM = "next";

/** The three roles RequireRole distinguishes (client/src/components/auth/RequireRole.tsx). */
export type ReturnPathRole = "student" | "guardian" | "admin";

/**
 * Route prefixes a signed-in user may be returned to, each with the roles App.tsx's RequireRole
 * admits on that route. Every key is a route App.tsx mounts, and every role list mirrors that
 * route's `allow={[…]}` — client/src/review-entry-points.test.ts enforces both.
 *
 * @spec [AS-5; register UI-03] | @implemented [2026-09-29] | plain English: the role lists exist so
 * a return path is honoured only for a role that can open it — a guardian who signs in with
 * `next=/calendar` lands on /guardian, not on a student page RequireRole would bounce them off.
 * Trade-off: this states App.tsx's gate as data; the entry-points test pins the two together.
 * The server stays the authority either way: this decides where to land, never what to serve.
 */
export const RETURN_PATH_ROUTE_ROLES: Readonly<
  Record<string, readonly ReturnPathRole[]>
> = {
  // G2-01 (merged from `main`): App.tsx gates /guardian to the guardian role only, and the
  // server refuses admins too, so an admin is never landed there.
  "/guardian": ["guardian"],
  "/dashboard": ["student", "admin"],
  "/profile": ["student", "guardian", "admin"],
  "/practice": ["student", "admin"],
  "/review": ["student", "admin"],
  "/chat": ["student", "admin"],
  // "/full-test" removed — E1 exam deletion ruling, 2026-09-23: the pre-baseline
  // full-length page is deleted pending the Doc 04 rebuild, and every entry here must be
  // a route App.tsx mounts (client/src/review-entry-points.test.ts enforces it).
  //
  // @spec [Doc-04A §16, Doc-04C §16.1; register UI-03] | @implemented [2026-09-29]
  // The rebuilt full-length surface. A prefix, so the /tests/:sessionId,
  // /tests/:sessionId/report and /tests/:sessionId/:section/:module deep links all
  // survive sign-in.
  "/tests": ["student", "admin"],
  // @spec [Doc-05F §17.1; register UI-03] | @implemented [2026-09-29]
  // The student's calendar — and the one path the full-length notification emails link
  // to (server/lib/notifications/templates/full-length.ts, CALENDAR_HREF).
  "/calendar": ["student", "admin"],
  "/mastery": ["student", "admin"],
  "/upgrade": ["student", "admin"],
  "/update-password": ["student", "guardian", "admin"],
  "/notifications": ["student", "guardian", "admin"],
  // @spec [Doc-03_V3 §21.3, SCL-025; closure plan W2-8] | @implemented [2026-09-24]
  // The crisis review surface. Slack crisis alerts link to
  // /admin/crisis-review/<case id>; without this entry a signed-out admin who
  // follows an alert is returned to /dashboard after sign-in and loses the
  // case — the last step of the escalation path. Deliberately the one mounted
  // admin route, not a bare "/admin" prefix: every entry must be a route
  // App.tsx mounts. A non-admin is never returned here (admin-only role list),
  // and the API is requireSupabaseAdmin regardless.
  "/admin/crisis-review": ["admin"],
};

/** Route prefixes a signed-in user may be returned to. Every entry is a route in App.tsx. */
export const RETURN_PATH_ALLOWLIST: readonly string[] = Object.keys(
  RETURN_PATH_ROUTE_ROLES,
);

/** Where first-time onboarding happens. A return path is carried THROUGH it, never TO it. */
export const ONBOARDING_PATH = "/profile/complete";

const MAX_RETURN_PATH_LENGTH = 512;

/** The allowlist entry a pathname falls under (exact, or a `/`-delimited sub-path), or `null`. */
function matchingAllowlistEntry(pathname: string): string | null {
  return (
    RETURN_PATH_ALLOWLIST.find(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) ?? null
  );
}

/** The pathname of an already-sanitised return path (the sanitiser emits `pathname + search`). */
function pathnameOf(safe: string): string {
  const q = safe.indexOf("?");
  return q === -1 ? safe : safe.slice(0, q);
}

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
  if (matchingAllowlistEntry(pathname) === null) return null;

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

/**
 * @spec [AS-5; register UI-03] | @implemented [2026-09-29] | plain English: the sanitised return
 * path, but only when `role` may open it (RETURN_PATH_ROUTE_ROLES); otherwise `null`, which the
 * caller turns into the role default. Edge case: a sanitised value always has an entry, so the
 * lookup cannot miss — if it somehow did, the answer is still `null` (fail closed).
 */
export function returnPathForRole(
  raw: unknown,
  role: ReturnPathRole,
): string | null {
  const safe = sanitizeReturnPath(raw);
  if (safe === null) return null;
  const entry = matchingAllowlistEntry(pathnameOf(safe));
  if (entry === null) return null;
  const roles = RETURN_PATH_ROUTE_ROLES[entry];
  return roles !== undefined && roles.includes(role) ? safe : null;
}

/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner ruling 2026-10-05, Step 0 decision 4
 * ("?intent=guardian: approved, as a default only, with server validation unchanged")]
 * | @implemented [2026-10-05] | plain English: true when the return path is one only a guardian
 * may open (today `/guardian`). The homepage's "I'm a parent or guardian" button signs up with
 * `next=/guardian`, and the onboarding form reads this to make Guardian its DEFAULT role. The
 * intent rides the existing `next` channel, which already survives Google sign-in (the OAuth
 * callback) and onboarding; a separate parameter would need its own path through both. It only
 * pre-selects a field the user can change; the server validates the submitted role as before.
 */
export function returnPathPrefersGuardian(raw: unknown): boolean {
  return (
    returnPathForRole(raw, "guardian") !== null &&
    returnPathForRole(raw, "student") === null
  );
}

/** Where a role lands when no return path is honoured (the AS-3 landing matrix). */
export function defaultPathForRole(role: ReturnPathRole): string {
  return role === "guardian" ? "/guardian" : "/dashboard";
}

/**
 * @spec [AS-5; register UI-03] | @implemented [2026-09-29] | plain English: the onboarding URL,
 * carrying the sanitised return path as `?next=` so a first-time sign-in still ends where the
 * user was going. Deliberately NOT role-filtered: the onboarding form is where the role is chosen,
 * so the role check happens once onboarding completes (`postAuthDestination`). A disallowed value
 * is dropped (plain /profile/complete), and a return path that is itself the onboarding page is
 * dropped too — onboarding never returns to onboarding.
 */
export function onboardingPathWithReturn(raw: unknown): string {
  const safe = sanitizeReturnPath(raw);
  if (safe === null || pathnameOf(safe) === ONBOARDING_PATH) {
    return ONBOARDING_PATH;
  }
  return `${ONBOARDING_PATH}?${RETURN_PATH_PARAM}=${encodeURIComponent(safe)}`;
}

/**
 * @spec [AS-5; AS-3 post-auth landing matrix; register UI-03] | @implemented [2026-09-29]
 * | plain English: THE post-auth landing decision, shared by the login page, the OAuth callback
 * and the onboarding page so the three cannot diverge. Onboarding wins, carrying the return path
 * through it; otherwise the return path wins if this role may open it; otherwise the role
 * default. `needsOnboarding` is the caller's fact — each caller already owns that rule (the login
 * page exempts admins; the OAuth callback reads the profile row).
 */
export function postAuthDestination(input: {
  role: ReturnPathRole;
  needsOnboarding: boolean;
  next: unknown;
}): string {
  if (input.needsOnboarding) return onboardingPathWithReturn(input.next);
  return (
    returnPathForRole(input.next, input.role) ?? defaultPathForRole(input.role)
  );
}
