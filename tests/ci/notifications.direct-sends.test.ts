/**
 * Direct sends — the two transactional emails that are NOT notification events (R7/R8/R9).
 *
 * @spec [contracts/notifications.contract.md §0.4; Doc-01_V8 §37.2, §40.2.1 Phase 4;
 *        Doc-01A_V1.0 §14] | @implemented [2026-09-03]
 *
 * plain English: proves each direct send goes through the one Resend transport with an
 * idempotency key derived from its request row id, from NOTIFICATION_FROM_EMAIL, to the
 * address given, carrying the request id (consent) or the raw token (deletion) in its link,
 * with no tracking fields; that a provider failure is a Result, not a throw; and that the
 * two call sites are wired (a route that stops importing the sender is a route that stops
 * mailing — the exact regression the rebuild's deletion commit had). No database is touched,
 * so no PG harness; the network is a recorded fake.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ACCOUNT_DELETION_SCHEDULED_IDEMPOTENCY_PREFIX,
  GUARDIAN_CONSENT_REQUEST_IDEMPOTENCY_PREFIX,
  sendAccountDeletionScheduledEmail,
  sendGuardianConsentRequestEmail,
} from "../../server/lib/notifications/direct-sends";
import { createResendTransport } from "../../server/lib/notifications/transport";

type Captured = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

function fakeResend(mode: "ok" | "reject") {
  const requests: Captured[] = [];
  const fetchImpl = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests.push({
      url: typeof input === "string" ? input : input.toString(),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>),
      ),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    if (mode === "reject") {
      return new Response(
        JSON.stringify({
          statusCode: 422,
          name: "validation_error",
          message: "nope",
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(JSON.stringify({ id: "re_direct_1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const transport = createResendTransport({
    fetchImpl,
    env: {
      RESEND_API_KEY: "re_test",
      NOTIFICATION_FROM_EMAIL: "notifications@send.example.test",
    },
  });
  return { requests, transport };
}

const SITE = "https://app.example.test";

describe("direct sends (R7/R8/R9)", () => {
  it("consent request: keyed by the guardian_consent_requests row id, from the env sender, link carries the request id", async () => {
    const { requests, transport } = fakeResend("ok");
    const result = await sendGuardianConsentRequestEmail(
      {
        consentRequestId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        guardianEmail: "guardian@example.test",
        studentDisplayName: "Sam <Student>",
      },
      { transport, siteUrl: SITE },
    );
    expect(result).toEqual({
      ok: true,
      value: { providerMessageId: "re_direct_1" },
    });
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.url).toBe("https://api.resend.com/emails");
    expect(req.headers["Idempotency-Key"]).toBe(
      `${GUARDIAN_CONSENT_REQUEST_IDEMPOTENCY_PREFIX}:7c9e6679-7425-40de-944b-e07fc1f90ae7`,
    );
    expect(req.body.from).toBe("notifications@send.example.test");
    expect(req.body.to).toEqual(["guardian@example.test"]);
    expect(Object.keys(req.body).sort()).toEqual([
      "from",
      "html",
      "subject",
      "text",
      "to",
    ]);
    expect(String(req.body.html)).toContain(
      `${SITE}/guardian/verify-consent?requestId=7c9e6679-7425-40de-944b-e07fc1f90ae7`,
    );
    expect(String(req.body.html)).toContain("Sam &lt;Student&gt;"); // escaped
    expect(String(req.body.subject)).toContain("Guardian consent required");
  });

  it("deletion scheduled: keyed by the account_deletion_requests row id, link carries the raw token, nothing else persists it", async () => {
    const { requests, transport } = fakeResend("ok");
    const result = await sendAccountDeletionScheduledEmail(
      {
        deletionRequestId: "11111111-1111-4111-8111-111111111111",
        email: "user@example.test",
        rawToken: "tok_raw+value",
        scheduledHardDeleteAt: "2026-09-10T00:00:00.000Z",
      },
      { transport, siteUrl: SITE },
    );
    expect(result.ok).toBe(true);
    const req = requests[0]!;
    expect(req.headers["Idempotency-Key"]).toBe(
      `${ACCOUNT_DELETION_SCHEDULED_IDEMPOTENCY_PREFIX}:11111111-1111-4111-8111-111111111111`,
    );
    expect(req.body.to).toEqual(["user@example.test"]);
    expect(String(req.body.text)).toContain(
      `${SITE}/account/recover?token=tok_raw%2Bvalue`,
    );
    expect(String(req.body.html)).toContain("Thu, 10 Sep 2026 00:00:00 GMT");
    expect(Object.keys(req.body).sort()).toEqual([
      "from",
      "html",
      "subject",
      "text",
      "to",
    ]);
  });

  it("a provider rejection is a Result, never a throw, and a missing site URL is config_missing with no request", async () => {
    const { requests, transport } = fakeResend("reject");
    const rejected = await sendGuardianConsentRequestEmail(
      {
        consentRequestId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        guardianEmail: "g@example.test",
        studentDisplayName: "S",
      },
      { transport, siteUrl: SITE },
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.kind).toBe("provider_rejected");
    expect(requests).toHaveLength(1);

    const unconfigured = await sendAccountDeletionScheduledEmail(
      {
        deletionRequestId: "11111111-1111-4111-8111-111111111111",
        email: "u@example.test",
        rawToken: "t",
        scheduledHardDeleteAt: "2026-09-10T00:00:00.000Z",
      },
      { transport, siteUrl: "" },
    );
    expect(unconfigured.ok).toBe(false);
    if (!unconfigured.ok)
      expect(unconfigured.error.kind).toBe("config_missing");
    expect(requests).toHaveLength(1); // no second request was attempted
  });

  it("both call sites are wired to the senders (R9)", () => {
    const root = path.resolve(__dirname, "../..");
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const profile = read("server/routes/profile-routes.ts");
    const deletion = read("server/routes/account-deletion-routes.ts");
    expect(profile).toMatch(
      /import \{ sendGuardianConsentRequestEmail \} from "\.\.\/lib\/notifications\/direct-sends"/,
    );
    expect(profile).toMatch(/await sendGuardianConsentRequestEmail\(\{/);
    expect(deletion).toMatch(
      /import \{ sendAccountDeletionScheduledEmail \} from "\.\.\/lib\/notifications\/direct-sends"/,
    );
    expect(deletion).toMatch(/await sendAccountDeletionScheduledEmail\(\{/);
    // The sender address is never a literal outside the environment.
    for (const f of [
      "server/lib/notifications/direct-sends.ts",
      "server/lib/notifications/transport.ts",
    ]) {
      expect(read(f)).not.toMatch(/@lyceon\.ai/);
    }
  });
});
