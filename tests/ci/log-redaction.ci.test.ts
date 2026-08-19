import { describe, it, expect } from "vitest";
import { redactSensitive } from "../../server/logger";

describe("redactSensitive", () => {
  it("redacts authorization headers (any casing)", () => {
    const input = {
      headers: {
        Authorization: "Bearer secret",
        authorization: "Bearer secret2",
      },
    };
    const result = redactSensitive(input);

    expect(result.headers.Authorization).toBe("[REDACTED]");
    expect(result.headers.authorization).toBe("[REDACTED]");
  });

  it("redacts cookie headers (any casing)", () => {
    const input = { headers: { Cookie: "a=b", cookie: "x=y" } };
    const result = redactSensitive(input);

    expect(result.headers.Cookie).toBe("[REDACTED]");
    expect(result.headers.cookie).toBe("[REDACTED]");
  });

  it("redacts nested token fields", () => {
    const input = {
      auth: {
        access_token: "access",
        nested: {
          refresh_token: "refresh",
          deeper: { id_token: "id", token: "plain" },
        },
      },
    };
    const result = redactSensitive(input);

    expect(result.auth.access_token).toBe("[REDACTED]");
    expect(result.auth.nested.refresh_token).toBe("[REDACTED]");
    expect(result.auth.nested.deeper.id_token).toBe("[REDACTED]");
    expect(result.auth.nested.deeper.token).toBe("[REDACTED]");
  });

  it("redacts body, email, and password fields", () => {
    const input = {
      body: { answer: "B", explanation: "private" },
      user: {
        email: "student@example.com",
        password: "super-secret",
      },
    };

    const result = redactSensitive(input);

    expect(result.body).toBe("[REDACTED]");
    expect(result.user.email).toBe("[REDACTED]");
    expect(result.user.password).toBe("[REDACTED]");
  });

  it("handles arrays containing sensitive keys", () => {
    const input = [
      { token: "abc", meta: { Authorization: "Bearer 123" } },
      { headers: { authorization: "secret" } },
    ];
    const result = redactSensitive(input);

    expect(result[0].token).toBe("[REDACTED]");
    expect(result[0].meta.Authorization).toBe("[REDACTED]");
    expect(result[1].headers.authorization).toBe("[REDACTED]");
  });

  it("preserves non-sensitive primitives", () => {
    const input = { status: 200, message: "ok", count: 3, success: true };
    const result = redactSensitive(input);

    expect(result).toEqual(input);
  });

  /**
   * @spec [01A_V1.0, §14] | @implemented [2026-08-16]
   * plain English: 'session' used to be a SUBSTRING pattern, so `sessionId` — an
   * opaque UUID — was redacted on every log line. That removed the only correlation
   * field from every mastery emission failure and is a large part of why a
   * 100%-failure outage ran for seven weeks unnoticed.
   *
   * BOTH assertions below must hold. The fix is only correct if correlation
   * identifiers survive AND real session credentials are still redacted; asserting
   * either half alone would pass for a broken implementation. Deleting 'session'
   * outright fails the credential half; restoring substring matching fails the
   * correlation half.
   */
  describe("session key narrowing — correlation survives, credentials do not", () => {
    it("preserves session correlation identifiers AND redacts session credentials", () => {
      const input = {
        // domain-entity correlation ids — opaque UUIDs, must SURVIVE
        practiceSessionId: "a1b2c3d4-0000-0000-0000-000000000000",
        sessionItemId: "b2c3d4e5-0000-0000-0000-000000000000",
        reviewSessionId: "c3d4e5f6-0000-0000-0000-000000000000",
        // auth session identifier — deliberately still REDACTED (exact match),
        // preserving the assertion in structured-log-redaction.ci.test.ts
        session_id: "sess_abc123xyz",
        sessionId: "sess_abc123xyz",
        // credentials — still REDACTED via token/secret/cookie patterns
        session_token: "eyJhbGciOiJIUzI1NiJ9.session-jwt",
        sessionToken: "eyJhbGciOiJIUzI1NiJ9.session-jwt",
        session_secret: "shhh",
        sessionCookie: "sb-access-token=abc",
        // the bare session object itself is sensitive — exact-key match
        session: { access_token: "abc", refresh_token: "def" },
      };

      const result = redactSensitive(input);

      // correlation half — domain-entity ids survive
      expect(result.practiceSessionId).toBe(input.practiceSessionId);
      expect(result.sessionItemId).toBe(input.sessionItemId);
      expect(result.reviewSessionId).toBe(input.reviewSessionId);

      // credential half — auth session ids, tokens and the bare object stay redacted
      expect(result.session_id).toBe("[REDACTED]");
      expect(result.sessionId).toBe("[REDACTED]");
      expect(result.session_token).toBe("[REDACTED]");
      expect(result.sessionToken).toBe("[REDACTED]");
      expect(result.session_secret).toBe("[REDACTED]");
      expect(result.sessionCookie).toBe("[REDACTED]");
      expect(result.session).toBe("[REDACTED]");
    });
  });
});
