import { describe, it, expect, vi, afterEach } from "vitest";
import { logger } from "../../server/logger";

/**
 * Structured JSON log output — redaction proof
 * @spec [01A, §10 §14] | @implemented [2026-08-12]
 * Proves that redactSensitive() runs on every structured JSON log entry.
 * A token, a password, and a raw student answer (via `body`) must never
 * appear in the JSON output.
 *
 * NODE_ENV=test triggers the structured JSON path (non-development),
 * so this test exercises the production output format.
 */
describe("structured JSON log output — redaction proof", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    if (writeSpy) writeSpy.mockRestore();
  });

  it("redacts token, password, and raw student answer from JSON output", () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const sensitivePayload = {
      auth_token: "eyJhbGciOiJIUzI1NiJ9.secret-jwt-payload",
      password: "P@ssw0rd-never-log-this",
      body: {
        student_answer: "B",
        raw_work: "I chose B because the passage says...",
      },
      normalField: 42,
    };

    logger.info(
      "TEST",
      "redaction_proof",
      "Sensitive data test",
      sensitivePayload,
    );

    // Find the structured JSON line written to stdout
    const jsonCalls = writeSpy.mock.calls.filter((call) => {
      const str = String(call[0]);
      try {
        const parsed = JSON.parse(str);
        return parsed.event === "redaction_proof";
      } catch {
        return false;
      }
    });

    expect(jsonCalls.length).toBe(1);
    const rawJson = String(jsonCalls[0][0]);
    const parsed = JSON.parse(rawJson);

    // 1. Sensitive VALUES must not appear anywhere in the raw JSON string
    expect(rawJson).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(rawJson).not.toContain("secret-jwt-payload");
    expect(rawJson).not.toContain("P@ssw0rd-never-log-this");
    expect(rawJson).not.toContain("I chose B because");
    expect(rawJson).not.toContain("student_answer");

    // 2. Sensitive keys are replaced with [REDACTED]
    expect(parsed.data.auth_token).toBe("[REDACTED]");
    expect(parsed.data.password).toBe("[REDACTED]");
    expect(parsed.data.body).toBe("[REDACTED]");

    // 3. Non-sensitive data survives
    expect(parsed.data.normalField).toBe(42);

    // 4. Cloud Logging fields are present and correct
    expect(parsed.severity).toBe("INFO");
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.event).toBe("redaction_proof");
    expect(parsed.component).toBe("TEST");
    expect(parsed.service).toBeDefined();
    expect(parsed.environment).toBeDefined();
  });

  it("redacts sensitive fields in error log entries", () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const errorObj = new Error("DB connection failed");
    const sensitiveContext = {
      credential: "super-secret-db-cred",
      session_id: "sess_abc123xyz",
      query: "SELECT * FROM users",
    };

    logger.error(
      "DB",
      "connection_failed",
      "Database error",
      errorObj,
      sensitiveContext,
    );

    // Find the structured JSON line for this specific event
    const jsonCalls = writeSpy.mock.calls.filter((call) => {
      const str = String(call[0]);
      try {
        const parsed = JSON.parse(str);
        return parsed.event === "connection_failed";
      } catch {
        return false;
      }
    });

    expect(jsonCalls.length).toBe(1);
    const rawJson = String(jsonCalls[0][0]);
    const parsed = JSON.parse(rawJson);

    // Sensitive values absent from raw output
    expect(rawJson).not.toContain("super-secret-db-cred");
    expect(rawJson).not.toContain("sess_abc123xyz");

    // Sensitive keys redacted
    expect(parsed.data.credential).toBe("[REDACTED]");
    expect(parsed.data.session_id).toBe("[REDACTED]");

    // Non-sensitive field survives
    expect(parsed.data.query).toBe("SELECT * FROM users");

    // Severity is ERROR
    expect(parsed.severity).toBe("ERROR");

    /**
     * INVERTED 2026-08-28 (Codex HIGH-6). This previously asserted
     * `parsed.error.message === 'DB connection failed'` — it REQUIRED the
     * prohibited behaviour. It therefore stayed green while raw vendor and
     * database messages leaked, and would have failed the moment the required
     * suppression was implemented. A test that fails when the defect is fixed
     * is worse than no test.
     *
     * Both halves asserted: the prose is ABSENT, and a usable classification is
     * PRESENT. Asserting only absence would pass for a logger that dropped the
     * error entirely and left an operator with nothing.
     */
    expect(parsed.error).toBeDefined();
    expect(parsed.error.message).toBeUndefined();
    expect(parsed.error.stack).toBeUndefined();
    expect(rawJson).not.toContain("DB connection failed");
    // What replaces it: the error's TYPE plus an allow-listed classification.
    expect(parsed.error.name).toBe("Error");
    expect(parsed.error.errorClass).toBe("unknown");
  });

  /**
   * The two leaks that were actually printed from a run, not imagined.
   * @spec [Charter §6; Doc 01A §14] | @implemented [2026-08-28 — Codex HIGH-4]
   */
  it("suppresses vendor prose and database prose, including a uuid embedded INSIDE the message", () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const PROFILE = "3f18cbe2-a999-41d4-852b-2af27e19d04e";
    class AuthSessionMissingError extends Error {
      constructor() {
        super("Auth session missing!");
        this.name = "AuthSessionMissingError";
      }
    }
    const dbError = Object.assign(
      new Error(
        `duplicate key value violates unique constraint "entitlements_profile_id_unique" DETAIL: Key (profile_id)=(${PROFILE}) already exists.`,
      ),
      { code: "23505", details: `Key (profile_id)=(${PROFILE})`, hint: null },
    );

    logger.error(
      "DB",
      "vendor_prose",
      "Vendor failure",
      new AuthSessionMissingError(),
      {
        dbError,
      },
    );

    const line = writeSpy.mock.calls
      .map((c) => String(c[0]))
      .find((str) => {
        try {
          return JSON.parse(str).event === "vendor_prose";
        } catch {
          return false;
        }
      });
    expect(line).toBeDefined();
    const raw = String(line);

    // Vendor prose, database prose, the constraint body, the stack, and — the
    // one no key or value rule could ever reach — the uuid EMBEDDED in the
    // message are all absent.
    expect(raw).not.toContain("Auth session missing");
    expect(raw).not.toContain("duplicate key value");
    expect(raw).not.toContain("entitlements_profile_id_unique");
    expect(raw).not.toContain("node_modules");
    expect(raw).not.toContain(PROFILE);

    // And an operator still learns which error, of what kind.
    const parsed = JSON.parse(raw);
    expect(parsed.error.name).toBe("AuthSessionMissingError");
    expect(parsed.data.dbError.errorClass).toBe("unique_violation");
    expect(parsed.data.dbError.errorCode).toBe("23505");
  });

  it("emits valid single-line JSON parseable by Cloud Logging", () => {
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    logger.info(
      "API",
      "health_check",
      "System healthy",
      { uptime: 3600 },
      {
        requestId: "req-123-abc",
        userId: "user-456",
      },
    );

    const jsonCalls = writeSpy.mock.calls.filter((call) => {
      const str = String(call[0]);
      try {
        JSON.parse(str);
        return true;
      } catch {
        return false;
      }
    });

    expect(jsonCalls.length).toBeGreaterThanOrEqual(1);
    const line = String(jsonCalls[jsonCalls.length - 1][0]);

    // Must be a single line (no embedded newlines before the trailing \n)
    const trimmed = line.trimEnd();
    expect(trimmed).not.toMatch(/\n/);

    // Must parse as valid JSON
    const parsed = JSON.parse(trimmed);

    // All 01A §10 required fields present
    expect(parsed.severity).toBe("INFO");
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.message).toBe("System healthy");
    expect(parsed.event).toBe("health_check");
    expect(parsed.service).toBeDefined();
    expect(parsed.environment).toBeDefined();

    // Correlation ID threaded through, un-digested: `request_id` is a
    // domain-entity correlation key, not a person.
    expect(parsed.request_id).toBe("req-123-abc");

    // CHANGED 2026-08-28 (Codex HIGH-6). This previously asserted the RAW
    // 'user-456'. A user id is a person-linked identifier and the logger
    // boundary now digests it structurally, so asserting the raw value would
    // be asserting the defect. Correlation is preserved — the digest is stable,
    // so two lines about the same user still join — while the log no longer
    // discloses WHO. Asserting a non-empty digest that differs from the input
    // is the pair of claims that matters; asserting only "not raw" would pass
    // for a logger that blanked the field and destroyed correlation.
    expect(parsed.user_id).not.toBe("user-456");
    expect(parsed.user_id).toMatch(/^[0-9a-f]{8}$/);
  });
});
