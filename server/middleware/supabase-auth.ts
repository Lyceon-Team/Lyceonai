import { Request, Response, NextFunction } from "express";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../logger.js";
import {
  ensureProfileForAuthUser,
  AccountEmailConflictError,
  UnrecognizedRoleError,
} from "../lib/profile-bootstrap.js";
import { ROLE_UNRECOGNIZED } from "../../packages/shared/src/runtime-role-schema";
import {
  GUARDIAN_LINK_REQUIRED,
  PROFILE_INCOMPLETE,
} from "../../packages/shared/src/guardian-link-gate";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { hasActiveGuardianLink } from "../lib/guardian-link-state.js";
import { createSupabaseServerClient } from "../lib/supabase-ssr.js";

/**
 * Derive the `@supabase/ssr` access token from the request cookies.
 *
 * `@supabase/ssr` stores the session as a (possibly chunked) base64url-prefixed JSON blob under a
 * cookie named `sb-<ref>-auth-token`. We decode it here ONLY to expose a stable session identifier
 * for CSRF binding and diagnostics — never as the authorization seam. Authorization always runs
 * through the SSR client's server-side `getUser()` validation (see supabaseAuthMiddleware).
 */
function extractSsrAccessToken(req: Request): string | null {
  const cookies = (req.cookies ?? {}) as Record<string, string>;

  const authCookieEntries = Object.keys(cookies)
    .filter((name) => /^sb-.*-auth-token(\.\d+)?$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (authCookieEntries.length === 0) {
    return null;
  }

  let raw = authCookieEntries.map((name) => cookies[name] ?? "").join("");
  if (raw.startsWith("base64-")) {
    try {
      raw = Buffer.from(raw.slice("base64-".length), "base64").toString(
        "utf-8",
      );
    } catch {
      return null;
    }
  }

  try {
    const parsed = JSON.parse(raw) as { access_token?: unknown };
    if (
      typeof parsed.access_token === "string" &&
      parsed.access_token.length >= 20
    ) {
      return parsed.access_token;
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Token resolution result with diagnostics
 */
export interface TokenResolutionResult {
  token: string | null;
  tokenSource: "bearer" | `cookie:${string}` | null;
  tokenLength: number | null;
  bearerParsed: boolean;
  authHeaderPresent: boolean;
  cookieKeys: string[];
}

/**
 * SHARED AUTH HELPER: Extract access token from request
 * Used by practice endpoints, auth debug, and health check
 *
 * SECURITY: Only accepts exact cookie names to prevent stale/legacy cookies from breaking auth
 *
 * ENFORCED: For user-facing auth, tokens MUST come from httpOnly cookies only.
 * Any Authorization: Bearer header is rejected for user-facing routes.
 * Internal bearer usage must NOT use this function.
 */
export function resolveTokenFromRequest(req: Request): TokenResolutionResult {
  const result: TokenResolutionResult = {
    token: null,
    tokenSource: null,
    tokenLength: null,
    bearerParsed: false,
    authHeaderPresent: false,
    cookieKeys: [],
  };

  // Get all cookie keys for diagnostics
  const cookies = req.cookies || {};
  result.cookieKeys = Object.keys(cookies);

  // Reject Authorization: Bearer for user-facing auth
  const authHeader =
    req.headers.authorization ||
    (req.headers["Authorization"] as string) ||
    req.get("authorization");
  result.authHeaderPresent = !!authHeader;
  if (authHeader && typeof authHeader === "string") {
    const lowerHeader = authHeader.toLowerCase();
    if (lowerHeader.startsWith("bearer ")) {
      // Explicitly reject Bearer tokens for user-facing auth
      result.bearerParsed = true;
      result.tokenSource = "bearer";
      result.token = null;
      result.tokenLength = 0;
      return result;
    }
  }

  // G8: the @supabase/ssr session cookie (sb-<ref>-auth-token) is the SINGLE session store. The legacy
  // sb-access-token cookie fallback was removed — one cookie mechanism end-to-end. This token is read
  // for CSRF binding / diagnostics only; authorization always runs through the SSR getUser() validation.
  const ssrToken = extractSsrAccessToken(req);
  if (ssrToken) {
    result.token = ssrToken;
    result.tokenSource = "cookie:sb-ssr-auth-token";
    result.tokenLength = ssrToken.length;
    return result;
  }

  return result;
}

export interface SupabaseUser {
  id: string;
  email: string;
  display_name: string | null;
  role: "student" | "admin" | "guardian";
  isAdmin: boolean;
  isGuardian: boolean;
  is_under_13?: boolean;
  profile_completed_at?: string | null;
  jwt?: string;
  username?: string;
  name?: string;
  student_link_code?: string | null;
  actor_id: string;
}

export interface AuthenticatedRequest extends Request {
  supabase?: SupabaseClient;
  user?: SupabaseUser;
}

export type DeletionStatusState =
  | "active"
  | "pending_deletion"
  | "deleted"
  | "unavailable";

export type DeletionStatusResult = {
  status: DeletionStatusState;
  executedAt: string | null;
};

export type DeletionStatusResolver = (args: {
  userId: string;
  requestId?: string;
}) => Promise<DeletionStatusResult>;

type DenialResponseOptions = {
  error: string;
  message: string;
  requestId?: string;
  extra?: Record<string, unknown>;
};

declare global {
  namespace Express {
    interface Request {
      supabase?: SupabaseClient;
      user?: SupabaseUser;
      /**
       * G2-02: set by `supabaseAuthMiddleware` when the signed-in account's stored role is not
       * one the application recognises. No `user` is attached, and every "signed-in user
       * required" refusal answers 403 `ROLE_UNRECOGNIZED` instead of 401 — a 401 would read as
       * "signed out" to the client and loop it back to the login page.
       */
      roleUnrecognized?: boolean;
    }
  }
}

/**
 * Detect if running in test environment
 * In test mode, placeholder clients are allowed
 * In production/dev, missing env vars must throw on first use
 */
function sendDenial(
  res: Response,
  status: number,
  options: DenialResponseOptions,
) {
  return res.status(status).json({
    error: options.error,
    message: options.message,
    requestId: options.requestId,
    ...(options.extra ?? {}),
  });
}

export function sendUnauthenticated(res: Response, requestId?: string) {
  return sendDenial(res, 401, {
    error: "Authentication required",
    message: "You must be signed in to access this resource",
    requestId,
  });
}

/**
 * @spec [Guardian_Closure_Plan G2-02; audit G-AUD-23] | @implemented [2026-09-29]
 *
 * plain English: the refusal for a signed-in account whose role the application does not know.
 * 403, with `code: ROLE_UNRECOGNIZED`, so the client can show a neutral "account unavailable"
 * screen rather than treat it as a sign-out. The body names no role and nothing about the account.
 */
export function sendRoleUnrecognized(res: Response, requestId?: string) {
  return sendDenial(res, 403, {
    error: "Account unavailable",
    message:
      "This account can't be opened. Please contact support.",
    requestId,
    extra: { code: ROLE_UNRECOGNIZED },
  });
}

/**
 * The one "no signed-in user" refusal: 403 `ROLE_UNRECOGNIZED` when the middleware refused an
 * unrecognised role, otherwise the ordinary 401.
 */
export function sendNoUser(req: Request, res: Response) {
  if (req.roleUnrecognized) {
    // G-NEW-12: the refusal logs its code. (The middleware's own `role_unrecognized` line
    // records the detection; this records that a request was refused because of it.)
    logger.warn(
      "AUTH",
      "role_unrecognized_refused",
      "Refused a request from a session with an unrecognised role",
      { code: ROLE_UNRECOGNIZED, method: req.method, path: req.path },
      { requestId: req.requestId },
    );
    return sendRoleUnrecognized(res, req.requestId);
  }
  return sendUnauthenticated(res, req.requestId);
}

export function sendForbidden(
  res: Response,
  options: Omit<DenialResponseOptions, "requestId"> & { requestId?: string },
) {
  return sendDenial(res, 403, options);
}

export function requireRequestUser(
  req: AuthenticatedRequest,
  res: Response,
): SupabaseUser | null {
  if (!req.user?.id) {
    sendNoUser(req, res);
    return null;
  }

  return req.user;
}

function isTestEnvironment(): boolean {
  return process.env.VITEST === "true" || process.env.NODE_ENV === "test";
}

let deletionStatusResolverOverride: DeletionStatusResolver | null = null;

export function setDeletionStatusResolverForTests(
  resolver: DeletionStatusResolver | null,
) {
  deletionStatusResolverOverride = resolver;
}

async function testDefaultDeletionResolver(): Promise<DeletionStatusResult> {
  return { status: "active", executedAt: null };
}

async function defaultSupabaseDeletionResolver(args: {
  userId: string;
  requestId?: string;
}): Promise<DeletionStatusResult> {
  try {
    const admin = getSupabaseAdmin();

    // Hard-deleted (a completed request) takes precedence over the soft-delete grace: the account is
    // anonymized and gone — "deleted" everywhere, no allowlist. Checked FIRST because deleted_at stays
    // set through hard-delete, so a completed row must not be mis-read as a recoverable grace state.
    const { data: completed, error: completedError } = await admin
      .from("account_deletion_requests")
      .select("status, completion_at")
      .eq("profile_id", args.userId)
      .eq("status", "completed")
      .maybeSingle();

    if (completedError && completedError.code !== "PGRST116") {
      logger.error(
        "DELETION",
        "auth_check_failed",
        "Failed to verify deletion status",
        {
          userId: args.userId,
          error: completedError.message,
          requestId: args.requestId,
        },
      );
      return { status: "unavailable", executedAt: null };
    }

    if (completed?.status === "completed") {
      // Canonical column is `completion_at` (genesis); the internal result field stays `executedAt`.
      return { status: "deleted", executedAt: completed.completion_at ?? null };
    }

    // @spec [Doc-01_V8 §40.3] Soft-delete grace: profiles.deleted_at is set but the request is still
    // pending → the account is RECOVERABLE. A distinct "pending_deletion" state lets the global
    // deletion lock (enforceDeletionLock) allow the minimal recovery/cancel/profile allowlist while
    // blocking everything else, instead of a blunt 403 that would strand in-app cancel. Flag-gated
    // (ACCOUNT_DELETION_LIFECYCLE_V2): pre-activation nothing sets deleted_at, so this branch is inert.
    if (process.env.ACCOUNT_DELETION_LIFECYCLE_V2 === "true") {
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("deleted_at")
        .eq("id", args.userId)
        .maybeSingle();

      if (profileError && profileError.code !== "PGRST116") {
        logger.error(
          "DELETION",
          "soft_delete_check_failed",
          "Failed to verify soft-delete state",
          {
            userId: args.userId,
            error: profileError.message,
            requestId: args.requestId,
          },
        );
        return { status: "unavailable", executedAt: null };
      }

      if (profile?.deleted_at) {
        return { status: "pending_deletion", executedAt: profile.deleted_at };
      }
    }

    return { status: "active", executedAt: null };
  } catch (err) {
    logger.error(
      "DELETION",
      "auth_check_error",
      "Unhandled error while verifying deletion status",
      {
        userId: args.userId,
        error: err instanceof Error ? err.message : String(err),
        requestId: args.requestId,
      },
    );
    return { status: "unavailable", executedAt: null };
  }
}

async function resolveDeletionStatus(args: {
  userId: string;
  requestId?: string;
}): Promise<DeletionStatusResult> {
  if (deletionStatusResolverOverride) {
    return deletionStatusResolverOverride(args);
  }

  if (isTestEnvironment()) {
    return testDefaultDeletionResolver();
  }

  return defaultSupabaseDeletionResolver(args);
}

// Supabase client with service role (bypasses RLS for admin operations)
// Lazy initialization with environment-based error handling
let _supabaseAdmin: SupabaseClient | null = null;
const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!_supabaseAdmin) {
      const url = process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !key) {
        if (isTestEnvironment()) {
          // In test environment, return placeholder client
          _supabaseAdmin = createClient(
            "https://placeholder.supabase.co",
            "placeholder-key",
          );
        } else {
          // In production/dev, throw on first use
          throw new Error(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in production/development",
          );
        }
      } else {
        _supabaseAdmin = createClient(url, key);
      }
    }
    const value = (_supabaseAdmin as any)[prop];
    if (typeof value === "function") {
      return value.bind(_supabaseAdmin);
    }
    return value;
  },
});

/**
 * @spec [Doc-01_V8 Identity/Access; Coding Standards §6.1 server-authoritative auth | AUTH-001]
 * @implemented 2026-06-15
 * plain English: Middleware that validates the Supabase session, attaches req.user from the canonical
 * profile, and attaches a request-scoped, RLS-bound Supabase client carrying the validated user token.
 *
 * NATIVE VALIDATION SEAM (must never regress): the session is validated SERVER-SIDE via the
 * `@supabase/ssr` server client's `getUser()` — never by trusting a decoded JWT or any client claim.
 * The same request-scoped SSR client becomes req.supabase, so every downstream Supabase query runs
 * under the user's identity (RLS-bound), and it is recreated per request (never shared).
 *
 * AUTH-001 (converted): the SSR `createServerClient` cookie adapter owns the session cookie read AND
 * write. `getUser()` validates the token AND triggers transparent token refresh, with the refreshed
 * session written straight back to the response cookies by the adapter. This REPLACES the custom
 * `/api/auth/refresh` endpoint and the hand-rolled raw-cookie authorization seam. `resolveTokenFromRequest`
 * survives only as a CSRF-binding / diagnostics helper (it never authorizes anything).
 *
 * expected outcome: cookie-native session management with no custom refresh path; trade-off: SSR owns
 * cookie naming (`sb-<ref>-auth-token`); edge case: a legacy `sb-access-token` cookie (older sessions /
 * tests) is still honored as a fallback validation path so existing sessions are not force-logged-out.
 */
export async function supabaseAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    // Build the request-scoped @supabase/ssr server client. Its cookie adapter reads the session from
    // the request cookies and writes any refreshed session back onto the response automatically.
    const ssrClient = createSupabaseServerClient(req, res);

    // SERVER-SIDE validation via the SSR client. This contacts the Auth server (never trusts a decoded
    // JWT) and performs transparent refresh, persisting new cookies through the adapter. AUTH-NATIVE-001:
    // native @supabase/ssr getUser() is the ONLY user-auth path — there is NO legacy-token fallback that
    // validates a custom cookie and mints an authorized client. (resolveTokenFromRequest survives for
    // inspect-only CSRF binding / diagnostics; it never authorizes a request here.)
    const {
      data: { user },
      error: authError,
    } = await ssrClient.auth.getUser();

    if (authError || !user) {
      if (authError) {
        logger.warn(
          "AUTH",
          "jwt_validation",
          "Invalid or expired Supabase session",
          { error: authError },
        );
      }
      return next(); // Continue without user (public routes)
    }

    let emailConflict = false;
    let roleUnrecognized = false;
    const profile = await ensureProfileForAuthUser(supabaseAdmin, user, {
      source: "supabase_auth_middleware",
      requestId: req.requestId,
    }).catch((profileError) => {
      // G2-02: a stored role the application does not know. Refuse the SESSION, not the request:
      // no user is attached, public routes still answer (sign-out works), and every route that
      // needs a signed-in user answers 403 ROLE_UNRECOGNIZED. The row is not touched.
      if (profileError instanceof UnrecognizedRoleError) {
        roleUnrecognized = true;
        logger.warn(
          "AUTH",
          "role_unrecognized",
          "Refused a session whose profile role is not recognised",
          { userId: user.id, requestId: req.requestId },
        );
        return null;
      }
      // AL-7 (profile-per-human): this email is already owned by another identity. Fail closed with a
      // deliberate 409, never a 500 and never a forked profile.
      if (profileError instanceof AccountEmailConflictError) {
        emailConflict = true;
        logger.warn(
          "AUTH",
          "account_email_conflict",
          "Blocked second-provider session for an email owned by another identity",
          { userId: user.id, requestId: req.requestId },
        );
        return null;
      }
      logger.error(
        "AUTH",
        "profile_load_failed",
        "Failed to load or bootstrap profile",
        {
          userId: user.id,
          error:
            profileError instanceof Error
              ? profileError.message
              : String(profileError),
          requestId: req.requestId,
        },
      );
      return null;
    });

    if (roleUnrecognized) {
      req.roleUnrecognized = true;
      return next();
    }

    if (emailConflict) {
      return res.status(409).json({
        error: {
          message:
            "An account already exists for this email. Sign in with your original method.",
          code: "ACCOUNT_EMAIL_CONFLICT",
        },
      });
    }

    if (!profile) {
      logger.error(
        "AUTH",
        "profile_null",
        "Profile is null after fetch/create",
        { userId: user.id },
      );
      return res.status(500).json({ error: "Failed to load user profile" });
    }

    // Attach user to request (with backward compatibility fields)
    req.user = {
      id: profile.id,
      email: profile.email,
      display_name: profile.display_name,
      role: profile.role,
      isAdmin: profile.role === "admin",
      isGuardian: profile.role === "guardian",
      is_under_13: profile.is_under_13,
      profile_completed_at: profile.profile_completed_at ?? null,
      student_link_code: profile.student_link_code,
      actor_id: profile.actor_id,
      // Legacy fields for backward compatibility with old auth
      username: profile.email.split("@")[0], // Use email prefix as username
      name: profile.display_name || profile.email.split("@")[0],
    };

    // Attach the request-scoped RLS-bound Supabase client. AUTH-NATIVE-001: this is ALWAYS the
    // native @supabase/ssr client (cookie-native, carries the getUser()-validated session). No
    // authorized client is ever minted from a legacy bearer token.
    req.supabase = ssrClient;

    // NOTE: PostgreSQL RLS via session GUCs (set_current_user_id) does NOT work with Neon
    // because Neon uses stateless connection pooling that doesn't preserve session variables.
    //
    // Data isolation is enforced at the APPLICATION LAYER via WHERE user_id = req.user.id
    // in all storage methods and API routes. This is verified by the RLS test suite.
    //
    // If you need true database-level RLS, consider:
    // 1. Using Supabase PostgreSQL (supports auth.uid() for RLS)
    // 2. Using a non-pooled Neon connection (session mode)
    // 3. Wrapping queries in transactions with session variables set in same connection

    logger.info(
      "AUTH",
      "user_authenticated",
      "User authenticated successfully",
      // @spec [Coding Standards §12.1; Doc 01A §14; register F-10, OQ-14 ruling 2026-09-29] |
      // @implemented [2026-09-29] | plain English: no email in the per-request auth log; userId
      // (digested by the logger), role and requestId identify the event without personal data.
      {
        userId: req.user.id,
        role: req.user.role,
        requestId: req.requestId,
      },
    );
    next();
  } catch (error) {
    logger.error(
      "AUTH",
      "middleware_error",
      "Supabase auth middleware error",
      error,
    );
    next(); // Continue without user on error
  }
}

/**
 * Middleware to require authentication
 * Returns 401 if user is not authenticated
 */
export async function requireSupabaseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // 401 gate only. The deletion lock (deleted / pending-deletion) is enforced ONCE, structurally, by
  // the global enforceDeletionLock middleware (default-deny + minimal allowlist) — not per-route — so
  // requireRequestUser routes can't bypass it and a new route is locked by default. (Was: this also
  // did the deletion 403; subsumed by enforceDeletionLock so the two can never diverge.)
  if (!req.user) {
    return sendNoUser(req, res);
  }
  return next();
}

// @spec [Doc-01_V8 §40.3 soft-delete state behaviour | §40.4 recovery] | @implemented 2026-06-21
// plain English: the ONE structural enforcement point for the account-deletion lock. Mounted globally
// (after supabaseAuthMiddleware, before the API routers), it default-denies every /api route for a
// deleted/pending-deletion user, with a minimal pending-only allowlist so the grace-window user can
// still load their profile, cancel in-app, recover via the email token, and sign out — and nothing
// else. Hard-deleted (completed) accounts are gone: 403 everywhere, no allowlist. Flag-gated
// (ACCOUNT_DELETION_LIFECYCLE_V2): flag-OFF => pure pass-through (dormant), so it activates atomically
// with the rest of the lifecycle. Non-/api paths (SPA + static) are never blocked — the client must
// load to render the pending-deletion screen.
type AllowlistEntry = { method: string; path: string };
const DELETION_LOCK_PENDING_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [
  { method: "GET", path: "/api/profile" }, // client reads pendingDeletion → routes to the pending screen
  { method: "POST", path: "/api/account/cancel-deletion" }, // in-app cancel (strand-prevention)
  { method: "POST", path: "/api/account/recover-deletion" }, // email-token recovery (strand-prevention)
  { method: "POST", path: "/api/auth/signout" }, // a pending user can always sign out
];

function isPendingDeletionAllowlisted(method: string, path: string): boolean {
  const normalizedPath =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return DELETION_LOCK_PENDING_ALLOWLIST.some(
    (entry) =>
      entry.method === method.toUpperCase() && entry.path === normalizedPath,
  );
}

export async function enforceDeletionLock(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // Dormant until the lifecycle is activated.
  if (process.env.ACCOUNT_DELETION_LIFECYCLE_V2 !== "true") {
    return next();
  }
  // Only guard the API surface. The SPA/static must always load so the client can render the
  // pending-deletion screen and call the allowlisted endpoints.
  if (!req.path.startsWith("/api/")) {
    return next();
  }
  // Nothing to enforce for unauthenticated requests (login/health/etc.).
  if (!req.user) {
    return next();
  }

  const deletionStatus = await resolveDeletionStatus({
    userId: req.user.id,
    requestId: req.requestId,
  });

  if (deletionStatus.status === "unavailable") {
    // Fail closed: if we can't determine the state, do not let a possibly-deleted user through.
    return res.status(503).json({
      error: "Deletion status unavailable",
      code: "DELETION_STATUS_UNAVAILABLE",
      requestId: req.requestId,
    });
  }

  if (deletionStatus.status === "deleted") {
    // G-NEW-12: every 403 logs its code before it answers.
    logger.warn(
      "AUTH",
      "deletion_lock_refused",
      "Refused a request from a deleted account",
      { code: "ACCOUNT_DELETED", method: req.method, path: req.path },
      { requestId: req.requestId, userId: req.user.id },
    );
    return res.status(403).json({
      error: "Account deleted",
      code: "ACCOUNT_DELETED",
      message:
        "This account has been deleted and can no longer access the service.",
      requestId: req.requestId,
    });
  }

  if (deletionStatus.status === "pending_deletion") {
    if (isPendingDeletionAllowlisted(req.method, req.path)) {
      return next();
    }
    logger.warn(
      "AUTH",
      "deletion_lock_refused",
      "Refused a request from an account pending deletion",
      { code: "PENDING_DELETION", method: req.method, path: req.path },
      { requestId: req.requestId, userId: req.user.id },
    );
    return res.status(403).json({
      error: "Account pending deletion",
      code: "PENDING_DELETION",
      message:
        "This account is scheduled for deletion. Cancel the deletion to continue using your account.",
      requestId: req.requestId,
    });
  }

  return next();
}

/**
 * Middleware to require admin role
 * Returns 403 if user is not an admin
 */
export function requireSupabaseAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return sendNoUser(req, res);
  }

  if (!req.user?.isAdmin) {
    logger.warn(
      "AUTH",
      "admin_required",
      "User attempted to access admin route without permission",
      {
        userId: req.user?.id,
        role: (req.user as any)?.role,
      },
    );

    return sendForbidden(res, {
      error: "Admin access required",
      message: "You do not have permission to access this resource",
      requestId: req.requestId,
    });
  }

  return next();
}

/**
 * @spec [Guardian_Closure_Plan G2-04; owner ruling R6 (2026-09-27); SCL-187 rule 1 (accepted
 *       2026-09-29); Coding Standards §4.3, §6.1] | @implemented [2026-09-29]
 *
 * plain English: the under-13 link gate. A STUDENT whose profile says they are under 13 passes
 * only while at least one guardian link to them is ACTIVE, and that is READ FROM `guardian_links`
 * ON THIS REQUEST — there is no stored flag and nothing cached on the session. A guardian who
 * unlinks partway through a session closes the student's very next learning request, with no
 * sign-in in between. Refused: 403 `GUARDIAN_LINK_REQUIRED`.
 *
 * Who it applies to: only `role === 'student'`. Admins and guardians pass untouched (so a guardian
 * reading a linked student under /api/students/:id is never refused here). The link read happens
 * only for `is_under_13 === true`; students of 13 or over pass without a query.
 *
 * Fails closed: a read error is a 500, never a pass (`hasActiveGuardianLink` throws).
 *
 * Mounted two ways: `requireStudentOrAdmin` ends in it, so every mount behind that gate (practice,
 * tests, review, calendar, questions, progress, streak) carries it; and it is placed directly on
 * the routes that are not behind that gate but are learning surfaces for the student — the
 * student's own reads under /api/students/:id (after the subject resolver) and billing
 * checkout/portal. Replaces `requireConsentCompliance`, which read a stored consent flag, and
 * keeps its per-route places on the practice, review and exam routers — so on those an under-13
 * student's request reads the link twice (mount, then route). Kept deliberately: a router mounted
 * anywhere else is still gated. The cost falls only on under-13 students.
 *
 * G2-06 (G-NEW-09): learning requires a KNOWN AGE, and that is checked FIRST. A student whose age
 * is unknown gets 403 `PROFILE_INCOMPLETE` before the under-13 check is reached. "Unknown" is
 * `is_under_13` not being a boolean: the genesis trigger `profiles_set_age` sets it to NULL
 * exactly when `date_of_birth` is NULL, and G2-03's `profiles_lock_date_of_birth` forbids writing
 * it on its own — so it cannot disagree with the date of birth, and the session need not carry the
 * date itself. Anything else (a field missing from the session) also counts as unknown: fail
 * closed. Production (owner, 2026-09-29): no completed student has a NULL date of birth, so this
 * locks out no completed student.
 */
export async function requireGuardianLinkForUnder13(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.user) {
    sendNoUser(req, res);
    return;
  }
  const user = req.user;
  if (user.isAdmin || user.role !== "student") {
    next();
    return;
  }

  // G2-06: age unknown → refused before anything else is asked.
  if (typeof user.is_under_13 !== "boolean") {
    logger.warn(
      "AUTH",
      "age_unknown",
      "Student with no date of birth refused a learning endpoint",
      { userId: user.id, path: req.path, requestId: req.requestId },
    );
    sendForbidden(res, {
      error: "Profile incomplete",
      message: "Please complete your profile before accessing this feature.",
      requestId: req.requestId,
      extra: { code: PROFILE_INCOMPLETE },
    });
    return;
  }

  if (!user.is_under_13) {
    next();
    return;
  }

  let linked: boolean;
  try {
    linked = await hasActiveGuardianLink(supabaseServer, user.id);
  } catch (err) {
    logger.error(
      "AUTH",
      "guardian_link_read_failed",
      "Could not read guardian link state; refusing",
      {
        userId: user.id,
        path: req.path,
        requestId: req.requestId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    res
      .status(500)
      .json({ error: "Internal server error", requestId: req.requestId });
    return;
  }

  if (linked) {
    next();
    return;
  }

  logger.warn(
    "AUTH",
    "guardian_link_required",
    "Under-13 student without an active guardian link refused",
    { userId: user.id, path: req.path, requestId: req.requestId },
  );
  sendForbidden(res, {
    error: "Guardian link required",
    message:
      "A guardian needs to connect to your account before you can use this.",
    requestId: req.requestId,
    extra: { code: GUARDIAN_LINK_REQUIRED },
  });
}

/**
 * Middleware to require completed onboarding profile before feature access.
 * Blocks when profile_completed_at is null ("DOB not yet set"). An under-13 student is gated
 * separately, on every request, by the live link check `requireGuardianLinkForUnder13` (G2-04);
 * there is no stored consent state.
 * @spec [Doc-01_V8 §9 Login and signup flows / §37.1 Under-13 gating] server-side DOB soft-gate
 */
export function requireProfileComplete(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return sendNoUser(req, res);
  }

  if (!req.user.profile_completed_at) {
    logger.warn(
      "AUTH",
      "profile_incomplete",
      "Feature access attempted before profile completion",
      {
        userId: req.user.id,
        path: req.path,
        requestId: req.requestId,
      },
    );
    return sendForbidden(res, {
      error: "Profile incomplete",
      message: "Please complete your profile before accessing this feature.",
      requestId: req.requestId,
      extra: { code: PROFILE_INCOMPLETE },
    });
  }

  return next();
}

/**
 * @spec [Doc-03B_V2 §3.1; Karl ruling 2026-08-05 #1; Doc-03 §12.5; INV-03-07] | @implemented 2026-08-05
 * plain English: LISA student-only role gate + under-13 age gate (fail-closed).
 * `/api/tutor/*` permits role `student` ONLY — all other roles get 403 `ROLE_NOT_PERMITTED`.
 * Age gate is fail-closed: only `is_under_13 === false` passes. Absent, undefined, or
 * unrecognized values are denied (403 `age_restriction`). This means a student whose
 * DOB has not yet been set is blocked — the profile-completion gate upstream
 * (requireProfileComplete) should catch this first, but the age gate is a hard backstop.
 * Doc 03 §12.5: "Accounts with age < 13 have no LISA access." No guardian-consent exception.
 * INV-03-07: "LISA access requires student age >= 13." Violation: COPPA exposure.
 * Doc 03B §3.2.1: denial reason `age_below_minimum` → 403, code `age_restriction`.
 *
 * expected outcome: only role=student with is_under_13 === false reaches tutor route handlers.
 * trade-offs: admin must use a dedicated admin surface (not built yet) for tutor review.
 *   Under-13 students are blocked even with guardian consent — spec is explicit, no exception.
 *   Students with unknown age state are blocked until DOB is confirmed.
 */
export function requireStudentOnly(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return sendNoUser(req, res);
  }

  if (req.user.role !== "student") {
    logger.warn(
      "AUTH",
      "role_not_permitted",
      "Non-student role attempted to access student-only surface",
      {
        userId: req.user.id,
        role: req.user.role,
        path: req.path,
        requestId: req.requestId,
      },
    );

    return sendForbidden(res, {
      error: "Role not permitted",
      message: "Only students can access this feature.",
      requestId: req.requestId,
      extra: { code: "ROLE_NOT_PERMITTED" },
    });
  }

  // INV-03-07 + Doc 03 §12.5: unconditional age gate — no guardian-consent exception.
  // Doc 03B §3.2.1: age_below_minimum → 403, code age_restriction.
  // Fail-closed: absent/undefined/unrecognized is_under_13 is denied.
  // Only explicit `false` (age confirmed ≥ 13) passes.
  if (req.user.is_under_13 !== false) {
    logger.warn(
      "AUTH",
      "age_restriction",
      "Under-13 student blocked from LISA access",
      {
        userId: req.user.id,
        path: req.path,
        requestId: req.requestId,
      },
    );

    return sendForbidden(res, {
      error: "Age restriction",
      message: "This feature requires an older account.",
      requestId: req.requestId,
      extra: { code: "AGE_RESTRICTION" },
    });
  }

  return next();
}

/**
 * Middleware to require student or admin role (blocks guardians)
 * Returns 403 if user is a guardian, if the role is not one the application knows (G2-02), and —
 * through `requireGuardianLinkForUnder13`, which it ends in — if the caller is an under-13
 * student with no active guardian link (G2-04).
 */
export function requireStudentOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return sendNoUser(req, res);
  }

  if (req.user.isGuardian && !req.user.isAdmin) {
    logger.warn(
      "AUTH",
      "guardian_blocked",
      "Guardian attempted to access student-only route",
      {
        userId: req.user.id,
        role: req.user.role,
        path: req.path,
      },
    );

    return sendForbidden(res, {
      error: "Student access required",
      message: "Guardians cannot access student practice features",
      requestId: req.requestId,
    });
  }

  // G2-02: an allow-list, not a deny-list. Only 'student' (and admin, above) reaches a student
  // route; anything else a user object might carry is refused rather than treated as a student.
  if (!req.user.isAdmin && req.user.role !== "student") {
    return sendRoleUnrecognized(res, req.requestId);
  }

  // G2-04: the under-13 link gate, read live on this request. Every mount behind this gate
  // inherits it; it replaces the stored-consent check that stood here.
  return requireGuardianLinkForUnder13(req, res, next);
}

/**
 * @spec [Brief 8 ruling 1 (owner, 2026-10-01): the background endpoints are "student-only, no
 *       entitlement check"; SCL-187 rule 1 (APPLIED); Coding Standards §6.1, §11.3]
 * | @implemented [2026-10-01]
 *
 * plain English: the gate for a surface that holds the STUDENT's own data and nobody else's —
 * Settings → Profile background. Only `role === 'student'` passes: a guardian gets 403
 * `ROLE_NOT_PERMITTED` (guardians never see or touch these fields), and so does an admin, because
 * an admin has no student background to edit and no admin surface reads one. Then the live
 * under-13 link gate, as on every student surface the calendar's dream-school picker shares.
 *
 * Why not `requireStudentOrAdmin`: it admits admins. Why not `requireStudentOnly`: that is LISA's
 * gate and refuses every under-13 account outright (Doc 03 §12.5), which is right for the tutor
 * and wrong here — a linked under-13 student may use the calendar, and so its picker.
 */
export function requireStudentAccount(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!req.user) {
    return sendNoUser(req, res);
  }
  if (req.user.isAdmin || req.user.role !== "student") {
    logger.warn(
      "AUTH",
      "role_not_permitted",
      "Non-student role attempted to access a student-account surface",
      { userId: req.user.id, role: req.user.role, path: req.path },
      { requestId: req.requestId },
    );
    return sendForbidden(res, {
      error: "Role not permitted",
      message: "Only students can access this feature.",
      requestId: req.requestId,
      extra: { code: "ROLE_NOT_PERMITTED" },
    });
  }
  return requireGuardianLinkForUnder13(req, res, next);
}

/**
 * Get Supabase admin client (bypasses RLS - use carefully!)
 */
export function getSupabaseAdmin() {
  return supabaseAdmin;
}
