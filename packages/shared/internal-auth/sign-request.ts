/**
 * @spec [Doc-01A_V1 Part VII §62, §70]
 * @implemented 2026-08-14
 *
 * plain English: HMAC-SHA256 request signing for internal service-to-service
 * calls. Constructs the signing string per §62.1, computes the signature per
 * §62.2, and returns the three required headers per §62.
 *
 * expected outcome: Given a request (method, URL, body) and a caller→callee
 * service pair, returns `{ headers }` containing the three HMAC headers that
 * the receiver will verify per §63.
 *
 * trade-offs:
 *  - Loads the active secret from the DB on every call (no caching). Acceptable
 *    for the current call volume (compaction, deletion cron, etc.). See
 *    load-secrets.ts header for caching path.
 *  - Uses `new URL(url).pathname` to extract the path — the URL must be
 *    absolute. Cloud Tasks targets use full URLs (https://...).
 *  - Body hash is always computed even when body is null (hashes empty string).
 *    This matches the spec exactly: "empty string hash if no body."
 *
 * edge cases:
 *  - Null/empty body: hashes the empty string. SHA-256 of "" is the well-known
 *    e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855.
 *  - No active secret: `loadActiveSecret` throws → caller must handle (the
 *    request should not be sent unsigned).
 */
import crypto from "node:crypto";
import { loadActiveSecret } from "./load-secrets";

// ── Types ─────────────────────────────────────────────────────────────

export type SignedHeaders = {
  "X-Lyceon-Service-Id": string;
  "X-Lyceon-Timestamp": string;
  "X-Lyceon-Signature-V1": string;
};

export type SignResult = {
  headers: SignedHeaders;
};

// ── Core signing function ─────────────────────────────────────────────

/**
 * Sign an internal service request with HMAC-SHA256.
 *
 * @spec [Doc-01A Part VII §62, §70]
 *
 * Constructs the signing string:
 *   METHOD\nPATH\nTIMESTAMP\nSHA256_OF_BODY
 *
 * Returns the three headers the receiver verifies.
 *
 * @param method         HTTP method (e.g. "POST")
 * @param url            Full URL of the target (pathname extracted for signing)
 * @param body           Request body string, or null if no body
 * @param callerService  Calling service identifier (e.g. "compaction-worker")
 * @param calleeService  Receiving service identifier (e.g. "main-api")
 * @returns SignResult with the three HMAC headers
 * @throws If no active secret exists for this service pair
 */
export async function signInternalRequest(
  method: string,
  url: string,
  body: string | null,
  callerService: string,
  calleeService: string,
): Promise<SignResult> {
  const timestamp = new Date().toISOString();
  const bodyHash = crypto
    .createHash("sha256")
    .update(body ?? "")
    .digest("hex");
  const path = new URL(url).pathname;

  const signingString = `${method}\n${path}\n${timestamp}\n${bodyHash}`;

  const secretMaterial = await loadActiveSecret(callerService, calleeService);
  // Secret is stored base64-encoded (§64); decode to raw bytes for HMAC
  const secretBytes = Buffer.from(secretMaterial, "base64");
  const signature = crypto
    .createHmac("sha256", secretBytes)
    .update(signingString)
    .digest("hex");

  return {
    headers: {
      "X-Lyceon-Service-Id": callerService,
      "X-Lyceon-Timestamp": timestamp,
      "X-Lyceon-Signature-V1": signature,
    },
  };
}

// ── Test helper: sign with an explicit secret (no DB lookup) ────────

/**
 * Sign a request with an explicitly provided secret.
 * Used in tests where the DB is unavailable or the secret is known.
 * NOT for production use — production must load secrets from the DB.
 */
export function signWithExplicitSecret(
  method: string,
  path: string,
  timestamp: string,
  body: string | null,
  secretBase64: string,
  callerService: string,
): SignResult {
  const bodyHash = crypto
    .createHash("sha256")
    .update(body ?? "")
    .digest("hex");

  const signingString = `${method}\n${path}\n${timestamp}\n${bodyHash}`;

  const secretBytes = Buffer.from(secretBase64, "base64");
  const signature = crypto
    .createHmac("sha256", secretBytes)
    .update(signingString)
    .digest("hex");

  return {
    headers: {
      "X-Lyceon-Service-Id": callerService,
      "X-Lyceon-Timestamp": timestamp,
      "X-Lyceon-Signature-V1": signature,
    },
  };
}
