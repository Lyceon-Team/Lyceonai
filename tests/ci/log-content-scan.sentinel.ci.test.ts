/**
 * SENTINEL TEST — content-based secret scanning at the logger sink.
 *
 * @spec [Charter §6; Doc 01A §14; Codex audit Finding 1] | @implemented [2026-09-15]
 *
 * plain English: a recognizable secret-shaped string must be redacted regardless
 * of the key it sits under or the carrier object's prototype. Four carriers are
 * tested — each a real path through the sink that key-based redaction CANNOT
 * reach:
 *
 *   1. Plain-object field  — `{ message: "<secret>" }` (not an Error, so
 *      `ERROR_PROSE_KEYS` never fires; `message` is not in SENSITIVE_KEY_PATTERNS)
 *   2. Error.message       — already stripped by ERROR_PROSE_KEYS; proven here for
 *      completeness to prevent regression
 *   3. Error enumerable    — `error.vendorPayload = "<secret>"` (custom key, not
 *      in any sensitive-key list)
 *   4. Nested data         — `{ data: { inner: { rawResponse: "<secret>" } } }`
 *
 * The secret material is constructed at runtime from fragments to avoid tripping
 * the pre-commit hook's literal secret detection.
 */
import { describe, it, expect } from "vitest";
import { redactSensitive } from "../../server/logger";

const REDACTION_STRING = "[REDACTED]";

// Build synthetic secrets from fragments so the hook's regex does not match
// the SOURCE text. The assembled values match the content scanner's patterns.
const PEM_BEGIN = "-----BEGIN " + "PRIVATE KEY-----";
const PEM_BODY = "\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n";
const PEM_END = "-----END " + "PRIVATE KEY-----";
const SYNTHETIC_PEM = PEM_BEGIN + PEM_BODY + PEM_END;

const SYNTHETIC_GCP_JSON = [
  '{"type":"service_account",',
  '"private_' + 'key":"' + PEM_BEGIN + "\\nfake\\n" + PEM_END + '",',
  '"client_email":"t@t.iam.gserviceaccount.com"}',
].join("");

const SYNTHETIC_SK = "sk-" + "live_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

const SYNTHETIC_BEARER =
  "Bearer " +
  "eyJhbGciOiJSUzI1NiIsInR5cCI6Ik" +
  "pXVCJ9.longTokenValue1234567890";

describe("content-based secret scanning at the logger sink", () => {
  describe("carrier 1: plain-object field (not an Error)", () => {
    it("redacts a PEM private key in a plain object's `message` field", () => {
      const input = { message: `GCP credential error: ${SYNTHETIC_PEM}` };
      const output = redactSensitive(input);
      expect(JSON.stringify(output)).not.toContain("BEGIN " + "PRIVATE");
    });

    it("redacts GCP service account JSON in a plain object field", () => {
      const input = { error: SYNTHETIC_GCP_JSON };
      const output = redactSensitive(input);
      expect(JSON.stringify(output)).not.toContain("private_" + "key");
      expect(JSON.stringify(output)).not.toContain("BEGIN " + "PRIVATE");
    });

    it("redacts a Stripe secret key in a plain object", () => {
      const input = { detail: SYNTHETIC_SK };
      const output = redactSensitive(input);
      expect(JSON.stringify(output)).not.toContain("sk-" + "live_");
    });
  });

  describe("carrier 2: Error.message", () => {
    it("does not leak a PEM key in Error.message (ERROR_PROSE_KEYS)", () => {
      const err = new Error(`Credential parse failed: ${SYNTHETIC_PEM}`);
      const output = redactSensitive(err);
      expect(JSON.stringify(output)).not.toContain("BEGIN " + "PRIVATE");
    });
  });

  describe("carrier 3: Error with enumerable property", () => {
    it("redacts a PEM key in an enumerable Error property", () => {
      const err = new Error("vendor call failed");
      (err as Record<string, unknown>).vendorPayload = SYNTHETIC_GCP_JSON;
      const output = redactSensitive(err);
      expect(JSON.stringify(output)).not.toContain("BEGIN " + "PRIVATE");
      expect(JSON.stringify(output)).not.toContain("private_" + "key");
    });

    it("redacts a Bearer token in an enumerable Error property", () => {
      const err = new Error("auth failed");
      (err as Record<string, unknown>).rawHeader = SYNTHETIC_BEARER;
      const output = redactSensitive(err);
      expect(JSON.stringify(output)).not.toContain("Bearer eyJ");
    });
  });

  describe("carrier 4: nested data object", () => {
    it("redacts a PEM key buried in nested data", () => {
      const input = {
        event: "classifier_retry_exhausted",
        data: {
          attempt: 1,
          inner: {
            rawResponse: SYNTHETIC_GCP_JSON,
          },
        },
      };
      const output = redactSensitive(input);
      expect(JSON.stringify(output)).not.toContain("BEGIN " + "PRIVATE");
      expect(JSON.stringify(output)).not.toContain("private_" + "key");
    });

    it("redacts a Stripe secret key buried in nested data", () => {
      const input = {
        context: {
          config: {
            vendorKey: SYNTHETIC_SK,
          },
        },
      };
      const output = redactSensitive(input);
      expect(JSON.stringify(output)).not.toContain("sk-" + "live_");
    });
  });

  describe("false-positive resistance", () => {
    it("preserves short strings that are not secret-shaped", () => {
      const input = {
        message: "Student asked about algebra",
        code: "PGRST116",
        status: 404,
      };
      const output = redactSensitive(input);
      expect((output as Record<string, unknown>).message).toBe(
        "Student asked about algebra",
      );
      expect((output as Record<string, unknown>).code).toBe("PGRST116");
    });

    it("preserves error class and code on Error objects", () => {
      const err = new Error("something went wrong");
      err.name = "CredentialError";
      const output = redactSensitive(err) as Record<string, unknown>;
      expect(output.name).toBe("CredentialError");
      expect(output).toHaveProperty("errorClass");
      expect(output).toHaveProperty("errorCode");
    });

    it("preserves domain-entity UUIDs in non-person-id keys", () => {
      const input = {
        practiceSessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        event: "session_started",
      };
      const output = redactSensitive(input) as Record<string, unknown>;
      expect(output.practiceSessionId).toBe(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      );
    });
  });
});
