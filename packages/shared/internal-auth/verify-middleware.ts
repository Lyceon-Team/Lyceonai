/**
 * @spec [Doc-01A_V1 Part VII §63, §66, §67, §70]
 * @implemented 2026-08-14
 *
 * plain English: Express middleware for HMAC-SHA256 verification of internal
 * service-to-service requests. Checks the three required headers, validates
 * the timestamp tolerance, loads active secrets for the caller→callee pair,
 * and verifies the signature with timing-safe comparison.
 *
 * expected outcome: Correctly-signed requests pass through to the next
 * handler. All failure modes return 401 with the §67-mandated minimal body
 * — no diagnostic info leaks. Failure reasons are logged at WARN.
 *
 * trade-offs:
 *  - Requires `express.raw()` or `express.json()` middleware to run first
 *    so `req.body` is available. For JSON endpoints, the raw body must be
 *    captured separately for HMAC (body hash is over raw bytes, not parsed
 *    JSON). The middleware accepts a `getRawBody` function to handle this.
 *  - Tries ALL active secrets for the pair (rotation overlap per §65.2).
 *    With ≤2 secrets per pair, this is ≤2 HMAC computations — negligible.
 *  - The §67 response shape is hardcoded (not configurable). All failures
 *    return the identical body per spec: "do not leak diagnostic info."
 *
 * edge cases:
 *  - Missing any header → 401 (§63: "Missing internal auth headers")
 *  - Invalid timestamp format → 401 (§63: "Invalid timestamp")
 *  - Timestamp outside tolerance → 401 (§66: replay prevention)
 *  - Unknown service pair (zero secrets) → 401 (§63: "Unknown service pair")
 *  - Wrong signature → 401 (§63: "Invalid signature")
 *  - All paths return identical body — attacker learns nothing.
 */
import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { loadServiceSecrets } from "./load-secrets";
import { logger } from "../../../server/logger";

// ── Constants ────────────────────────────────────────────────────────

/** §66: 5 minutes = 300_000 ms default timestamp tolerance */
const DEFAULT_TIMESTAMP_TOLERANCE_MS = 300_000;

/** §67: Minimal failure response — identical for all failure modes */
const AUTH_FAILURE_RESPONSE = {
  error: {
    code: "internal_auth_failed",
    message: "Internal authentication failed",
  },
} as const;

// ── Types ────────────────────────────────────────────────────────────

export type InternalAuthMiddlewareOptions = {
  /**
   * Override the default timestamp tolerance (ms).
   * §66 default: 300_000 (5 minutes). Range: 60_000–600_000.
   */
  timestampToleranceMs?: number;

  /**
   * Function to extract the raw request body as a string for HMAC hashing.
   * If not provided, defaults to JSON.stringify(req.body) for JSON routes.
   * For routes using express.raw(), pass `(req) => req.body.toString()`.
   */
  getRawBody?: (req: Request) => string;
};

// ── Middleware factory ───────────────────────────────────────────────

/**
 * Express middleware that verifies HMAC-SHA256 internal service auth.
 *
 * @spec [Doc-01A Part VII §63, §67, §70]
 *
 * Usage:
 *   router.post('/memory/compact-writeback',
 *     internalAuthMiddleware('main-api'),
 *     handler
 *   );
 *
 * @param calleeService  The service name of this receiver (e.g. "main-api")
 * @param opts           Optional configuration overrides
 * @returns Express middleware function
 */
export function internalAuthMiddleware(
  calleeService: string,
  opts?: InternalAuthMiddlewareOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const toleranceMs =
    opts?.timestampToleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
  const getRawBody =
    opts?.getRawBody ?? ((req: Request) => JSON.stringify(req.body ?? ""));

  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      await verifyInternalRequest(req, calleeService, toleranceMs, getRawBody);
      next();
    } catch (err: unknown) {
      const reason =
        err instanceof Error ? err.message : "unknown verification error";
      const callerHeader = req.headers["x-lyceon-service-id"];

      logger.warn(
        "INTERNAL_AUTH",
        "internal_auth_rejected",
        "Internal service auth verification failed",
        {
          reason,
          caller:
            typeof callerHeader === "string" ? callerHeader : "not-provided",
          path: req.path,
          method: req.method,
        },
      );

      res.status(401).json(AUTH_FAILURE_RESPONSE);
    }
  };
}

// ── Core verification function ──────────────────────────────────────

/**
 * Verify an internal HMAC-signed request.
 *
 * @spec [Doc-01A Part VII §63]
 *
 * Steps (per §63):
 *   1. Check presence of all three headers
 *   2. Parse and validate timestamp
 *   3. Check timestamp tolerance (replay prevention)
 *   4. Load active secrets for the caller→callee pair
 *   5. Compute expected signature and compare (timing-safe)
 *
 * @throws Error with descriptive message (logged server-side only; not in response)
 */
async function verifyInternalRequest(
  req: Request,
  calleeService: string,
  toleranceMs: number,
  getRawBody: (req: Request) => string,
): Promise<void> {
  // ── Step 1: Extract and check headers ──────────────────────────
  const serviceId = extractHeader(req, "x-lyceon-service-id");
  const timestamp = extractHeader(req, "x-lyceon-timestamp");
  const signature = extractHeader(req, "x-lyceon-signature-v1");

  if (!serviceId || !timestamp || !signature) {
    throw new Error("Missing internal auth headers");
  }

  // ── Step 2: Parse timestamp ────────────────────────────────────
  const timestampDate = new Date(timestamp);
  if (isNaN(timestampDate.getTime())) {
    throw new Error("Invalid timestamp");
  }

  // ── Step 3: Check timestamp tolerance (§66) ────────────────────
  const skewMs = Math.abs(Date.now() - timestampDate.getTime());
  if (skewMs > toleranceMs) {
    throw new Error("Timestamp outside tolerance window");
  }

  // ── Step 4: Load active secrets for this service pair ──────────
  const secrets = await loadServiceSecrets(serviceId, calleeService);
  if (secrets.length === 0) {
    throw new Error("Unknown service pair");
  }

  // ── Step 5: Compute expected signature and compare ─────────────
  const rawBody = getRawBody(req);
  const bodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");
  const signingString = `${req.method}\n${req.path}\n${timestamp}\n${bodyHash}`;

  // Try each active secret (§65.2 rotation overlap)
  const signatureBuffer = Buffer.from(signature, "hex");
  const valid = secrets.some((secretMaterial) => {
    const secretBytes = Buffer.from(secretMaterial, "base64");
    const expected = crypto
      .createHmac("sha256", secretBytes)
      .update(signingString)
      .digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");

    // §63: timing-safe comparison prevents timing attacks
    return (
      signatureBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    );
  });

  if (!valid) {
    throw new Error("Invalid signature");
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Extract a single-valued header from the request.
 * Headers can be string or string[] — normalize to string | undefined.
 */
function extractHeader(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}
