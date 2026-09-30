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
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ACCOUNT_DELETION_COMPLETED_IDEMPOTENCY_PREFIX,
  ACCOUNT_DELETION_SCHEDULED_IDEMPOTENCY_PREFIX,
  GUARDIAN_LINK_INVITE_IDEMPOTENCY_PREFIX,
  guardianLinkInviteIdempotencyKey,
  sendAccountDeletionCompletedEmail,
  sendAccountDeletionScheduledEmail,
  sendGuardianLinkInviteEmail,
} from "../../server/lib/notifications/direct-sends";
import {
  createResendSuppressionTransport,
  createResendTransport,
} from "../../server/lib/notifications/transport";
import { logger, redactSensitive } from "../../server/logger";

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
  it("deletion scheduled: keyed by the account_deletion_requests row id, link carries the raw token, nothing else persists it", async () => {
    const { requests, transport } = fakeResend("ok");
    const result = await sendAccountDeletionScheduledEmail(
      {
        deletionRequestId: "11111111-1111-4111-8111-111111111111",
        email: "user@example.test",
        recipientProfileId: "44444444-4444-4444-8444-444444444444",
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
      "reply_to",
      "subject",
      "text",
      "to",
    ]);
  });

  /**
   * @spec [SCL-083 PROPOSED; owner brief 2026-09-15 Part A2/A3] the completion notice: keyed by
   * the account_deletion_requests row id, date only, no link of any kind, no tracking keys.
   */
  it("deletion completed: keyed by the account_deletion_requests row id, date only, no links, no tracking", async () => {
    const { requests, transport } = fakeResend("ok");
    const result = await sendAccountDeletionCompletedEmail(
      {
        deletionRequestId: "33333333-3333-4333-8333-333333333333",
        email: "gone@example.test",
        recipientProfileId: "44444444-4444-4444-8444-444444444444",
        completedAt: "2026-09-17T00:00:00.000Z",
      },
      { transport },
    );
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.headers["Idempotency-Key"]).toBe(
      `${ACCOUNT_DELETION_COMPLETED_IDEMPOTENCY_PREFIX}:33333333-3333-4333-8333-333333333333`,
    );
    expect(req.body.to).toEqual(["gone@example.test"]);
    expect(req.body.from).toBe("notifications@send.example.test");
    expect(String(req.body.subject)).toMatch(/has been deleted/i);
    expect(String(req.body.text)).toContain("Thu, 17 Sep 2026 00:00:00 GMT");
    // No link, no recovery offer, no site URL: recovery is impossible after completion.
    expect(String(req.body.text)).not.toMatch(/https?:\/\//);
    expect(String(req.body.html)).not.toMatch(/<a\s|href=|https?:\/\//);
    expect(String(req.body.text)).toMatch(/can no longer be restored/i);
    expect(Object.keys(req.body).sort()).toEqual([
      "from",
      "html",
      "reply_to",
      "subject",
      "text",
      "to",
    ]);
  });

  it("deletion completed: a provider rejection is a Result, never a throw (no retry by design)", async () => {
    const { requests, transport } = fakeResend("reject");
    const result = await sendAccountDeletionCompletedEmail(
      {
        deletionRequestId: "33333333-3333-4333-8333-333333333333",
        email: "gone@example.test",
        recipientProfileId: "44444444-4444-4444-8444-444444444444",
        completedAt: "2026-09-17T00:00:00.000Z",
      },
      { transport },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("provider_rejected");
    expect(requests).toHaveLength(1); // exactly one attempt
  });

  it("a provider rejection is a Result, never a throw, and a missing site URL is config_missing with no request", async () => {
    const { requests, transport } = fakeResend("reject");
    const rejected = await sendAccountDeletionScheduledEmail(
      {
        deletionRequestId: "11111111-1111-4111-8111-111111111111",
        email: "u@example.test",
        rawToken: "t",
        scheduledHardDeleteAt: "2026-09-10T00:00:00.000Z",
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
        recipientProfileId: "44444444-4444-4444-8444-444444444444",
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

  /**
   * @spec [Doc-01_V8 §36.2, §38.1; contract §0.4, §5.3, §12.3; owner brief 2026-09-15 Part B]
   * The guardian INVITE: keyed on student + code issue time + a hash of the address (no
   * `guardian_links` row exists before redemption, so there is no row id to key on), the code
   * and the prefilled redeem link in the body, the ignore instruction, no progress data.
   */
  it("guardian link invite: keyed by student + code issue time + address hash, carries code + prefilled link, no tracking", async () => {
    const { requests, transport } = fakeResend("ok");
    const result = await sendGuardianLinkInviteEmail(
      {
        studentProfileId: "22222222-2222-4222-8222-222222222222",
        studentDisplayName: "Sam <Student>",
        code: "ABC234",
        codeIssuedAt: "2026-09-15T08:00:00.000Z",
        expiresAt: "2026-09-16T08:00:00.000Z",
        guardianEmail: "Parent@Example.test",
      },
      { transport, siteUrl: SITE },
    );
    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    const key = String(req.headers["Idempotency-Key"]);
    expect(key).toBe(
      guardianLinkInviteIdempotencyKey({
        studentProfileId: "22222222-2222-4222-8222-222222222222",
        codeIssuedAt: "2026-09-15T08:00:00.000Z",
        guardianEmail: "parent@example.test", // normalised: same key as the mixed-case input
      }),
    );
    expect(key.startsWith(`${GUARDIAN_LINK_INVITE_IDEMPOTENCY_PREFIX}:`)).toBe(
      true,
    );
    expect(key).not.toMatch(/@|parent/i); // the address never rides in the key
    expect(req.body.to).toEqual(["Parent@Example.test"]);
    expect(Object.keys(req.body).sort()).toEqual([
      "from",
      "html",
      "reply_to",
      "subject",
      "text",
      "to",
    ]);
    expect(String(req.body.text)).toContain("\n    ABC234\n"); // standalone, not only in the URL
    expect(String(req.body.html)).toContain(">ABC234</p>");
    expect(String(req.body.text)).toContain(`${SITE}/guardian?code=ABC234`);
    expect(String(req.body.html)).toContain("Sam &lt;Student&gt;");
    expect(String(req.body.text)).toMatch(/ignore this email/i);
    expect(String(req.body.text)).toMatch(/sign in/i);
    expect(String(req.body.text).toLowerCase()).not.toMatch(/score|%|streak/);
  });

  it("all three call sites are wired to the senders (R9); the consent request is gone (G2-05)", () => {
    const root = path.resolve(__dirname, "../..");
    const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
    const profile = read("server/routes/profile-routes.ts");
    const deletion = read("server/routes/account-deletion-routes.ts");
    const students = read("server/routes/student-resources.ts");
    expect(students).toMatch(
      /import \{ sendGuardianLinkInviteEmail \} from "\.\.\/lib\/notifications\/direct-sends"/,
    );
    expect(students).toMatch(/await sendGuardianLinkInviteEmail\(\{/);
    // G2-05 (R6): the email-consent flow was removed; nothing may send, or export, it.
    expect(profile).not.toContain("sendGuardianConsentRequestEmail");
    expect(read("server/lib/notifications/direct-sends.ts")).not.toContain(
      "sendGuardianConsentRequestEmail",
    );
    expect(deletion).toMatch(
      /import \{ sendAccountDeletionScheduledEmail \} from "\.\.\/lib\/notifications\/direct-sends"/,
    );
    expect(deletion).toMatch(/await sendAccountDeletionScheduledEmail\(\{/);
    // The completion notice is sent by the cron executor, not a route (SCL-083 PROPOSED).
    const executor = read("server/lib/account-deletion-execute.ts");
    expect(executor).toMatch(
      /import \{ sendAccountDeletionCompletedEmail \} from "\.\/notifications\/direct-sends"/,
    );
    expect(executor).toMatch(/await sendAccountDeletionCompletedEmail\(\{/);
    // The sender address is never a literal outside the environment.
    for (const f of [
      "server/lib/notifications/direct-sends.ts",
      "server/lib/notifications/transport.ts",
    ]) {
      expect(read(f)).not.toMatch(/@lyceon\.ai/);
    }
  });
});

/**
 * @spec [owner ruling OQ-17, 2026-09-30; Doc 01A §14; Coding Standards §12.1; register F-29]
 *   | @implemented [2026-09-30] |
 * plain English: no notification log line carries the recipient's address in any form, masked
 * or not. Each send and each suppression change is driven through the REAL transport (a
 * recorded fake network), in the success and the failure branch, with the logger spied. A
 * distinctive address is used so any fragment of it (local part, domain, or the old
 * first-letter mask) would show up. Presence first: the named event must have been emitted.
 */
describe("notification logs carry no recipient address (OQ-17)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ADDRESS = "kiddo.tester@family-domain.example";
  const FRAGMENTS = ["kiddo", "family-domain", "k****@", "@family"];
  const PROFILE_ID = "55555555-5555-4555-8555-555555555555";

  function spyLogs() {
    const spies = [
      vi.spyOn(logger, "info"),
      vi.spyOn(logger, "warn"),
      vi.spyOn(logger, "error"),
    ];
    const calls = () => spies.flatMap((spy) => spy.mock.calls);
    return {
      operations: () => calls().map((call) => call[1]),
      serialized: () => JSON.stringify(calls()),
      dataFor: (operation: string): unknown =>
        calls().find((call) => call[1] === operation)?.[3],
    };
  }

  function expectNoAddress(serialized: string) {
    for (const fragment of FRAGMENTS) {
      expect(serialized).not.toContain(fragment);
    }
  }

  it("the logger digests recipientProfileId (same mechanism as userId)", () => {
    const written = redactSensitive({ recipientProfileId: PROFILE_ID });
    expect(written.recipientProfileId).not.toBe(PROFILE_ID);
    expect(typeof written.recipientProfileId).toBe("string");
  });

  for (const mode of ["ok", "reject"] as const) {
    it(`deletion scheduled (${mode}): no address; the request id and the recipient profile are logged`, async () => {
      const logs = spyLogs();
      const { transport } = fakeResend(mode);
      await sendAccountDeletionScheduledEmail(
        {
          deletionRequestId: "11111111-1111-4111-8111-111111111111",
          email: ADDRESS,
          recipientProfileId: PROFILE_ID,
          rawToken: "tok_" + "a".repeat(40),
          scheduledHardDeleteAt: "2026-10-07T00:00:00.000Z",
        },
        { transport, siteUrl: SITE },
      );
      const event =
        mode === "ok"
          ? "deletion_scheduled_email_sent"
          : "deletion_scheduled_email_failed";
      expect(logs.operations()).toContain(event);
      expect(logs.dataFor(event)).toMatchObject({
        deletionRequestId: "11111111-1111-4111-8111-111111111111",
        recipientProfileId: PROFILE_ID,
      });
      expectNoAddress(logs.serialized());
    });

    it(`guardian link invite (${mode}): no address; a null profile is logged`, async () => {
      const logs = spyLogs();
      const { transport } = fakeResend(mode);
      await sendGuardianLinkInviteEmail(
        {
          studentProfileId: "22222222-2222-4222-8222-222222222222",
          studentDisplayName: "Sam",
          code: "ABC234",
          codeIssuedAt: "2026-09-15T08:00:00.000Z",
          expiresAt: "2026-09-16T08:00:00.000Z",
          guardianEmail: ADDRESS,
        },
        { transport, siteUrl: SITE },
      );
      const event =
        mode === "ok" ? "link_invite_email_sent" : "link_invite_email_failed";
      expect(logs.operations()).toContain(event);
      expect(logs.dataFor(event)).toMatchObject({ recipientProfileId: null });
      expectNoAddress(logs.serialized());
    });

    it(`deletion completed (${mode}): no address; the request id and the recipient profile are logged`, async () => {
      const logs = spyLogs();
      const { transport } = fakeResend(mode);
      await sendAccountDeletionCompletedEmail(
        {
          deletionRequestId: "33333333-3333-4333-8333-333333333333",
          email: ADDRESS,
          recipientProfileId: PROFILE_ID,
          completedAt: "2026-10-07T00:00:00.000Z",
        },
        { transport },
      );
      const event =
        mode === "ok"
          ? "deletion_completed_email_sent"
          : "deletion_completed_email_failed";
      expect(logs.operations()).toContain(event);
      expect(logs.dataFor(event)).toMatchObject({
        deletionRequestId: "33333333-3333-4333-8333-333333333333",
        recipientProfileId: PROFILE_ID,
      });
      expectNoAddress(logs.serialized());
    });
  }

  it("the transport's own lines (sent / rejected) log the message id and profile, not the address", async () => {
    for (const mode of ["ok", "reject"] as const) {
      const logs = spyLogs();
      const { transport } = fakeResend(mode);
      await transport({
        idempotencyKey: "msg-1",
        to: ADDRESS,
        recipientProfileId: PROFILE_ID,
        subject: "s",
        html: "<p>h</p>",
        text: "t",
      });
      const event = mode === "ok" ? "email_sent" : "email_send_rejected";
      expect(logs.operations()).toContain(event);
      expect(logs.dataFor(event)).toMatchObject({
        idempotencyKey: "msg-1",
        recipientProfileId: PROFILE_ID,
      });
      expectNoAddress(logs.serialized());
      vi.restoreAllMocks();
    }
  });

  it("suppression add / remove (success and failure) log the profile, not the address", async () => {
    for (const status of [200, 500] as const) {
      const logs = spyLogs();
      const fetchImpl = (async () =>
        new Response(
          JSON.stringify(
            status === 200 ? { id: "sup_1", deleted: true } : { message: "no" },
          ),
          { status, headers: { "Content-Type": "application/json" } },
        )) as typeof fetch;
      const suppression = createResendSuppressionTransport({
        fetchImpl,
        env: { RESEND_API_KEY: "re_test" },
      });
      await suppression.add(ADDRESS, { recipientProfileId: PROFILE_ID });
      await suppression.remove(ADDRESS, { recipientProfileId: PROFILE_ID });
      const events =
        status === 200
          ? ["suppression_added", "suppression_removed"]
          : ["suppression_add_failed", "suppression_remove_failed"];
      for (const event of events) {
        expect(logs.operations()).toContain(event);
        expect(logs.dataFor(event)).toMatchObject({
          recipientProfileId: PROFILE_ID,
        });
      }
      expectNoAddress(logs.serialized());
      vi.restoreAllMocks();
    }
  });
});
