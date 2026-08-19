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
