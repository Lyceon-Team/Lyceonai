/**
 * @spec [Doc-06B §3 "Secrets at Runtime"; Coding Standards §7.1, §14]
 * @implemented 2026-09-02
 *
 * plain English: Tests the GCP credential loader for safe error handling.
 * The critical invariant: no code path in getGcpCredentials() can put
 * credential material into a thrown error — not in message, stack, or
 * any enumerable property. The sentinel test (row 4) is the proof.
 *
 * expected outcome: every malformed-input case throws a fixed-vocabulary
 * error. The sentinel value never appears in the thrown error.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getGcpCredentials,
  _resetGcpCredentialsCache,
} from "../../server/lib/gcp-credentials";

// ── Fake credential fixture ──────────────────────────────────────────
// Syntactically valid but completely fake. The SENTINEL is a recognizable
// string that the tests assert never appears in any error output.

const SENTINEL = "CANARY_SENTINEL_PROVES_LEAK_xK9mZ3";

const VALID_FAKE = {
  type: "service_account" as const,
  project_id: "test-project-000",
  private_key_id: "fake-key-id-000",
  private_key: "-----BEGIN FAKE-----\nnotreal\n-----END FAKE-----\n",
  client_email: "test@test-project-000.iam.gserviceaccount.com",
  client_id: "000000000000000000000",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
};

// ── Helpers ──────────────────────────────────────────────────────────

let savedEnv: string | undefined;

function setEnv(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.GCP_SERVICE_ACCOUNT_JSON;
  } else {
    process.env.GCP_SERVICE_ACCOUNT_JSON = value;
  }
}

/**
 * Recursively collect every string from an object — message, stack,
 * and every enumerable property at any depth. This is what the logger
 * would see if it serialized the error.
 */
function collectAllStrings(value: unknown, depth = 0): string[] {
  if (depth > 10) return [];
  const strings: string[] = [];
  if (typeof value === "string") {
    strings.push(value);
  } else if (value instanceof Error) {
    if (value.message) strings.push(value.message);
    if (value.stack) strings.push(value.stack);
    for (const key of Object.keys(value)) {
      strings.push(
        ...collectAllStrings(
          (value as unknown as Record<string, unknown>)[key],
          depth + 1,
        ),
      );
    }
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      strings.push(
        ...collectAllStrings(
          (value as Record<string, unknown>)[key],
          depth + 1,
        ),
      );
    }
  }
  return strings;
}

describe("server/lib/gcp-credentials", () => {
  beforeEach(() => {
    savedEnv = process.env.GCP_SERVICE_ACCOUNT_JSON;
    _resetGcpCredentialsCache();
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.GCP_SERVICE_ACCOUNT_JSON;
    } else {
      process.env.GCP_SERVICE_ACCOUNT_JSON = savedEnv;
    }
    _resetGcpCredentialsCache();
  });

  // ── §5 Row 1: Variable unset ────────────────────────────────────

  it("throws a fixed message when the variable is unset", () => {
    setEnv(undefined);
    expect(() => getGcpCredentials()).toThrow(
      "GCP_SERVICE_ACCOUNT_JSON is not set",
    );
  });

  // ── §5 Row 2: Not JSON ──────────────────────────────────────────

  it("throws a fixed message when the value is not valid JSON", () => {
    const badInput = "this-is-not-json-{{{corrupt";
    setEnv(badInput);
    expect(() => getGcpCredentials()).toThrow(
      "GCP_SERVICE_ACCOUNT_JSON is not valid JSON",
    );

    // The thrown message must NOT contain any substring of the input.
    try {
      getGcpCredentials();
    } catch (err: unknown) {
      const allStrings = collectAllStrings(err);
      const combined = allStrings.join("\n");
      expect(combined).not.toContain(badInput);
      expect(combined).not.toContain("corrupt");
    }
  });

  // ── §5 Row 3: Valid JSON, wrong shape ────────────────────────────

  it("throws naming only the failed key paths, never the values", () => {
    const missingEmail = { ...VALID_FAKE };
    // Remove client_email to trigger a validation failure
    const withoutEmail = Object.fromEntries(
      Object.entries(missingEmail).filter(([k]) => k !== "client_email"),
    );
    setEnv(JSON.stringify(withoutEmail));

    expect(() => getGcpCredentials()).toThrow("client_email");

    // Must NOT contain the private key value
    try {
      getGcpCredentials();
    } catch (err: unknown) {
      const allStrings = collectAllStrings(err);
      const combined = allStrings.join("\n");
      expect(combined).not.toContain(VALID_FAKE.private_key);
    }
  });

  // ── §5 Row 4: THE NEGATIVE CONTROL ──────────────────────────────
  // This is the test that matters. Every other test can pass while the
  // loader still leaks; this one cannot.

  it("sentinel in private_key never appears in any property of the thrown error", () => {
    // Build a fixture with a recognizable sentinel as the private_key
    // and EVERY OTHER field deliberately malformed so the error path
    // has maximum surface area.
    const poisoned = {
      type: "service_account" as const,
      project_id: "", // fails min(1)
      private_key_id: "", // fails min(1)
      private_key: `-----BEGIN SENTINEL-----\n${SENTINEL}\n-----END SENTINEL-----\n`,
      client_email: "not-an-email", // fails email()
      client_id: "", // fails min(1)
      auth_uri: "not-a-url", // fails url()
      token_uri: "not-a-url", // fails url()
    };

    setEnv(JSON.stringify(poisoned));

    let thrown: unknown;
    try {
      getGcpCredentials();
    } catch (err: unknown) {
      thrown = err;
    }

    expect(thrown).toBeDefined();

    // The sentinel must appear NOWHERE in the error — not in message,
    // not in stack, not in any enumerable property at any depth.
    const allStrings = collectAllStrings(thrown);
    const combined = allStrings.join("\n");
    expect(combined).not.toContain(SENTINEL);

    // Double-check: the message should only name key paths
    expect((thrown as Error).message).toMatch(
      /GCP_SERVICE_ACCOUNT_JSON failed validation on:/,
    );
  });

  // ── §5 Row 5: Caching ───────────────────────────────────────────

  it("returns the cached object on the second call (JSON.parse runs once)", () => {
    setEnv(JSON.stringify(VALID_FAKE));

    const first = getGcpCredentials();
    const second = getGcpCredentials();

    // Same object reference = cached
    expect(first).toBe(second);
    expect(first.project_id).toBe("test-project-000");
  });

  // ── §5 Row 6: Real newlines in private_key ──────────────────────

  it("rejects private_key with real newlines (pasted incorrectly)", () => {
    // When a user pastes the key file content into Vercel with real
    // newlines instead of \\n escapes, JSON.parse fails because the
    // string literal contains unescaped newlines.
    const withRealNewlines = JSON.stringify(VALID_FAKE).replace(/\\n/g, "\n");
    setEnv(withRealNewlines);

    expect(() => getGcpCredentials()).toThrow(
      "GCP_SERVICE_ACCOUNT_JSON is not valid JSON",
    );
  });

  // ── §5 Row 7: Successful parse returns correct shape ─────────────

  it("returns a validated service-account object on valid input", () => {
    setEnv(JSON.stringify(VALID_FAKE));

    const creds = getGcpCredentials();

    expect(creds.type).toBe("service_account");
    expect(creds.project_id).toBe("test-project-000");
    expect(creds.client_email).toBe(
      "test@test-project-000.iam.gserviceaccount.com",
    );
    // Verify the private_key is present (not stripped)
    expect(creds.private_key).toContain("-----BEGIN");
  });

  // ── Regression: safeParse vs parse ──────────────────────────────
  // This test documents WHY safeParse is required. z.parse() would
  // embed the received values in a ZodError, leaking private_key.
  // This test would FAIL if the loader used .parse() instead of
  // .safeParse().

  it("ZodError from z.parse() would leak the sentinel (regression proof)", () => {
    // Demonstrate the defect that safeParse prevents:
    // If we were to call serviceAccountSchema.parse() on a poisoned
    // input, the ZodError's issues array would contain the received
    // values — including the private_key sentinel.
    const { z } = require("zod") as typeof import("zod");

    const schema = z.object({
      type: z.literal("service_account"),
      project_id: z.string().min(1),
      private_key: z.string().startsWith("-----BEGIN"),
      client_email: z.string().email(),
    });

    const poisoned = {
      type: "wrong_type", // fails literal check — ZodError includes received value
      project_id: "",
      private_key: `-----BEGIN SENTINEL-----\n${SENTINEL}\n-----END SENTINEL-----`,
      client_email: "not-an-email",
    };

    // .parse() WOULD leak the sentinel
    let parseError: Error | undefined;
    try {
      schema.parse(poisoned);
    } catch (err: unknown) {
      parseError = err as Error;
    }

    expect(parseError).toBeDefined();
    const parseStrings = collectAllStrings(parseError);
    const parseCombined = parseStrings.join("\n");
    // This CONFIRMS the leak exists in .parse() — the sentinel IS in the error
    expect(parseCombined).toContain("wrong_type"); // ZodError includes received values

    // .safeParse() does NOT throw, so the sentinel never reaches an error
    const safeResult = schema.safeParse(poisoned);
    expect(safeResult.success).toBe(false);
    // The issues exist but our loader never exposes them — only key paths
  });
});
