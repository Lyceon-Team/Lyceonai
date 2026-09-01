/**
 * @spec [Doc-03C_V3 §9.3]
 * @implemented 2026-08-15
 *
 * plain English: Express middleware for OIDC token verification on Cloud Tasks
 * delivery routes. Cloud Tasks mints an OIDC token at DELIVERY time (not
 * enqueue time — a critical advantage over HMAC, whose timestamp is frozen at
 * enqueue). The middleware validates the Google-signed OIDC token per §9.3:
 *   1. Token signature (standard Google OIDC via google-auth-library)
 *   2. Token audience matches the expected handler URL
 *   3. Token issuer is `https://accounts.google.com`
 *   4. Token's service account matches the expected Cloud Tasks SA
 *
 * expected outcome: Correctly-signed Cloud Tasks requests with valid OIDC
 * tokens pass through. All failure modes return 401 with a minimal body
 * matching the §67 convention (no diagnostic info leaks). Failure reasons
 * are logged at WARN.
 *
 * trade-offs:
 *  - `google-auth-library` (already a root dependency) handles signature
 *    verification, key caching, and key rotation — no hand-rolled JWT
 *    parsing. The `OAuth2Client.verifyIdToken()` call is ~1ms with cached
 *    keys, ~200ms on first call (key fetch from Google).
 *  - Cloud Run IAM (`roles/run.invoker`) provides the first layer of
 *    defense — the token never reaches application code if the SA lacks
 *    the role. This middleware is defense-in-depth per §9.3.
 *  - Audience and service account email are configured per-route. The
 *    middleware factory takes both as parameters so the three Doc 03C §8
 *    async routes can each enforce their own audience.
 *
 * edge cases:
 *  - Missing Authorization header → 401
 *  - Malformed bearer token → 401
 *  - Invalid signature / expired token → 401 (google-auth-library throws)
 *  - Wrong audience → 401
 *  - Wrong service account → 401
 *  - All paths return identical body — attacker learns nothing.
 */
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../../../server/logger";

// ── Constants ────────────────────────────────────────────────────────

/** §67-style minimal failure response — identical for all failure modes */
const OIDC_AUTH_FAILURE_RESPONSE = {
  error: {
    code: "oidc_auth_failed",
    message: "OIDC authentication failed",
  },
} as const;

/**
 * Shared OAuth2Client instance for token verification.
 * Caches Google's public keys internally (auto-refreshes on expiry).
 */
const oauthClient = new OAuth2Client();

// ── Types ────────────────────────────────────────────────────────────

export type OidcMiddlewareOptions = {
  /**
   * Expected OIDC token audience. Typically the full URL of the handler
   * endpoint, or the Cloud Run service URL.
   *
   * @spec [Doc-03C_V3 §9.3: "Token audience matches the handler URL"]
   */
  expectedAudience: string;

  /**
   * Expected service account email of the Cloud Tasks invoker.
   * Format: `lisa-cloud-tasks@PROJECT.iam.gserviceaccount.com`
   *
   * @spec [Doc-03C_V3 §9.3: "Token's service account matches
   * lisa-cloud-tasks@PROJECT.iam (enqueuer identity)"]
   */
  expectedServiceAccount: string;
};

// ── Middleware factory ───────────────────────────────────────────────

/**
 * Express middleware that verifies Google OIDC tokens on Cloud Tasks
 * delivery requests.
 *
 * @spec [Doc-03C_V3 §9.3]
 *
 * Usage:
 *   router.post('/async/compaction',
 *     oidcAuthMiddleware({
 *       expectedAudience: process.env.CLOUD_TASKS_OIDC_AUDIENCE!,
 *       expectedServiceAccount: process.env.CLOUD_TASKS_SERVICE_ACCOUNT!,
 *     }),
 *     handler
 *   );
 *
 * @param opts  OIDC configuration (audience + service account)
 * @returns Express middleware function
 */
export function oidcAuthMiddleware(
  opts: OidcMiddlewareOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const { expectedAudience, expectedServiceAccount } = opts;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await verifyOidcToken(req, expectedAudience, expectedServiceAccount);
      next();
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : "unknown OIDC verification error";

      logger.warn(
        "OIDC_AUTH",
        "oidc_auth_rejected",
        "OIDC token verification failed on Cloud Tasks delivery",
        {
          reason,
          path: req.path,
          method: req.method,
        },
      );

      res.status(401).json(OIDC_AUTH_FAILURE_RESPONSE);
    }
  };
}

// ── Config-guarded factory (request-time validation) ─────────────────

/** §8.2-shaped body for a route whose OIDC config is absent. */
const OIDC_NOT_CONFIGURED_RESPONSE = {
  error: {
    code: "internal_auth_not_configured",
    message: "Internal route is not configured for OIDC authentication",
  },
} as const;

/**
 * Reads the OIDC configuration for a route. Called once per request so a
 * route never captures a config value at import time.
 */
export type OidcConfigReader = () => {
  expectedAudience: string | undefined;
  expectedServiceAccount: string | undefined;
};

/**
 * @spec [Doc-03C_V3 §9.3; Doc-01A §3 (fail-fast, bootstrap order)]
 * @implemented 2026-09-01
 *
 * plain English: `oidcAuthMiddleware` with its configuration validated at
 * REQUEST time instead of import time. If the audience or service account is
 * missing, this route — and only this route — refuses with 500. Every other
 * route in the process keeps serving.
 *
 * expected outcome: configured route behaves exactly as `oidcAuthMiddleware`;
 * unconfigured route returns 500 and never calls `next()`, so a handler can
 * never run behind an unverified token.
 *
 * trade-offs:
 *  - The config check and the auth check are the SAME middleware, not two
 *    chained ones. A caller cannot mount the auth without the check, or
 *    reorder them, because there is one call site for both. Splitting them
 *    would reintroduce the bypass this guard exists to prevent.
 *  - Doc 01A §3's fail-fast intent — never run with auth silently disabled —
 *    is preserved: an empty audience refuses the request rather than reaching
 *    `verifyOidcToken`. §3 places its fail-fast in `loadAllConfig()` at step 1
 *    of a bootstrap order whose step 4 is "start HTTP listener", so the
 *    doctrine is about a startup PHASE, not about module evaluation. A
 *    module-scope throw in a route file is not what §3 asks for: in a shared
 *    bundle it takes down every unrelated route, auth included.
 *  - The inner middleware is built on first configured request and reused, so
 *    the google-auth-library key cache is shared across requests exactly as
 *    before.
 *
 * edge cases:
 *  - Config appears after boot (env injected late): picked up on the next
 *    request, because the reader runs per request.
 *  - Config disappears: the next request refuses; no stale cached middleware
 *    is used, because the cache is only consulted after the check passes.
 *  - Missing variable NAMES are logged; values never are.
 *
 * @param readConfig  Per-request reader for audience + service account
 * @returns Express middleware
 */
export function oidcAuthMiddlewareWithConfigGuard(
  readConfig: OidcConfigReader,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  let configured: {
    audience: string;
    serviceAccount: string;
    middleware: (
      req: Request,
      res: Response,
      next: NextFunction,
    ) => Promise<void>;
  } | null = null;

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const { expectedAudience, expectedServiceAccount } = readConfig();

    const missing: string[] = [];
    if (!expectedAudience) missing.push("CLOUD_TASKS_OIDC_AUDIENCE");
    if (!expectedServiceAccount) missing.push("CLOUD_TASKS_SERVICE_ACCOUNT");

    if (!expectedAudience || !expectedServiceAccount) {
      logger.error(
        "OIDC_AUTH",
        "oidc_config_missing",
        "Internal OIDC route is not configured; refusing the request",
        undefined,
        {
          missing,
          path: req.path,
          method: req.method,
        },
      );

      res.status(500).json(OIDC_NOT_CONFIGURED_RESPONSE);
      return;
    }

    if (
      configured === null ||
      configured.audience !== expectedAudience ||
      configured.serviceAccount !== expectedServiceAccount
    ) {
      configured = {
        audience: expectedAudience,
        serviceAccount: expectedServiceAccount,
        middleware: oidcAuthMiddleware({
          expectedAudience,
          expectedServiceAccount,
        }),
      };
    }

    await configured.middleware(req, res, next);
  };
}

// ── Core verification function ──────────────────────────────────────

/**
 * Verify a Google OIDC token from a Cloud Tasks delivery request.
 *
 * @spec [Doc-03C_V3 §9.3]
 *
 * Steps per §9.3:
 *   1. Extract Bearer token from Authorization header
 *   2. Verify token signature (google-auth-library handles key fetch +
 *      caching + rotation + expiry check)
 *   3. Verify audience matches expected handler URL
 *   4. Verify issuer is `https://accounts.google.com`
 *   5. Verify service account email matches expected SA
 *
 * @throws Error with descriptive message (logged server-side only; not in response)
 */
async function verifyOidcToken(
  req: Request,
  expectedAudience: string,
  expectedServiceAccount: string,
): Promise<TokenPayload> {
  // ── Step 1: Extract Bearer token ──────────────────────────────
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") {
    throw new Error("Missing Authorization header");
  }

  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  if (!match?.[1]) {
    throw new Error("Malformed Authorization header — expected Bearer token");
  }
  const idToken = match[1];

  // ── Step 2+3: Verify signature + audience ─────────────────────
  // google-auth-library's verifyIdToken validates:
  //   - JWT structure and signature (against Google's public keys)
  //   - Token expiry (exp claim)
  //   - Audience claim matches `audience` parameter
  // All of these throw on failure.
  const ticket = await oauthClient.verifyIdToken({
    idToken,
    audience: expectedAudience,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("OIDC token payload is empty after verification");
  }

  // ── Step 4: Verify issuer ─────────────────────────────────────
  // google-auth-library checks issuer as part of verifyIdToken, but
  // we enforce it explicitly per §9.3 for defense-in-depth.
  const issuer = payload.iss;
  if (
    issuer !== "https://accounts.google.com" &&
    issuer !== "accounts.google.com"
  ) {
    throw new Error(`Unexpected issuer: ${issuer}`);
  }

  // ── Step 5: Verify service account email ──────────────────────
  const tokenEmail = payload.email;
  if (tokenEmail !== expectedServiceAccount) {
    throw new Error("Service account mismatch");
  }

  // §9.3: email_verified must be true for service accounts
  if (!payload.email_verified) {
    throw new Error("Service account email not verified");
  }

  return payload;
}
