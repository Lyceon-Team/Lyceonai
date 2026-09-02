/**
 * The logging boundary cannot emit a raw person-linked identifier.
 *
 * @spec [Charter §6 "no raw payer PII in logs"; Doc 01A §14] | @implemented [2026-08-28]
 *
 * plain English: Codex HIGH-6 found raw `profileId` / `userId` /
 * `guardianUserId` / `studentUserId` / account ids in logs on the entitlement
 * and guardian-billing paths. The PREVIOUS fix digested fields one at a time at
 * the call site, which is why the defect returned — a new call site had to
 * remember. Expected outcome: the property is enforced at the boundary, so a
 * call site that logs a raw identifier under ANY key still cannot emit it.
 *
 * Trade-off: the boundary cannot read intent, so it distinguishes person ids
 * from domain-entity ids by a named allow-list. That list is the reviewable
 * surface; forgetting to add a key to it is harmless (the key gets digested),
 * while adding a person-scoped key to it is the mistake a reviewer must catch.
 *
 * THE TEST THAT MATTERS is `an identifier under a key nobody listed`. Every
 * other case here could be satisfied by a per-field fix; that one can only pass
 * if the boundary itself enforces the property.
 */
import { describe, expect, it } from "vitest";
import { redactSensitive } from "../../server/logger";
import { digestId } from "../../server/lib/redact";

const PROFILE = "3f18cbe2-a999-41d4-852b-2af27e19d04e";
const CUSTOMER = "cus_QabcDEFghiJKL123";

describe("logging boundary — structural identifier redaction (Codex HIGH-6)", () => {
  it("digests the person-linked keys Codex found emitted raw", () => {
    const out = redactSensitive({
      profileId: PROFILE,
      userId: PROFILE,
      guardianUserId: PROFILE,
      studentUserId: PROFILE,
      guardianAccountId: PROFILE,
      studentAccountId: PROFILE,
    }) as Record<string, string>;

    for (const [key, value] of Object.entries(out)) {
      expect(value, `${key} must not be raw`).not.toBe(PROFILE);
      expect(value, `${key} must be a digest`).toBe(digestId(PROFILE));
    }
  });

  it("digests an identifier under a key nobody listed — the structural claim", () => {
    // This is the case a per-field fix cannot satisfy. If someone adds a new
    // log call tomorrow with a key that did not exist today, the identifier
    // must still not reach the log.
    const out = redactSensitive({
      aKeyInventedTomorrow: PROFILE,
      nested: { deeper: { alsoInvented: CUSTOMER } },
      inAnArray: [PROFILE],
    }) as {
      aKeyInventedTomorrow: string;
      nested: { deeper: { alsoInvented: string } };
      inAnArray: string[];
    };

    expect(out.aKeyInventedTomorrow).toBe(digestId(PROFILE));
    expect(out.nested.deeper.alsoInvented).toBe(digestId(CUSTOMER));
    expect(out.inAnArray[0]).toBe(digestId(PROFILE));
  });

  it("digests QUALIFIED person-key variants, not just the exact names", () => {
    // Found in the suite's own log output: `attemptedUserId` and
    // `existingProfileId` escaped exact matching. Their values are uuids in
    // production, but a person identifier that is not uuid-shaped would have
    // passed, and the claim is that it CANNOT.
    const out = redactSensitive({
      attemptedUserId: "user-2",
      existingProfileId: "user-1",
      conflictingGuardianId: "legacy-guardian-7",
    }) as Record<string, string>;

    expect(out.attemptedUserId).toBe(digestId("user-2"));
    expect(out.existingProfileId).toBe(digestId("user-1"));
    expect(out.conflictingGuardianId).toBe(digestId("legacy-guardian-7"));
  });

  it("keeps domain-entity correlation ids readable — the seven-week-outage lesson", () => {
    // Digesting these would repeat the incident recorded in server/logger.ts:
    // losing the only correlation field on mastery emission failures. They are
    // things, not people.
    const input = {
      practiceSessionId: PROFILE,
      sessionItemId: PROFILE,
      questionId: PROFILE,
      requestId: "req-123-abc",
      eventId: "evt_guardian_sub",
    };
    const out = redactSensitive(input) as typeof input;

    expect(out.practiceSessionId).toBe(PROFILE);
    expect(out.sessionItemId).toBe(PROFILE);
    expect(out.questionId).toBe(PROFILE);
    expect(out.requestId).toBe("req-123-abc");
    expect(out.eventId).toBe("evt_guardian_sub");
  });

  it("blanks a secret even when it holds an identifier — secret beats digest", () => {
    // A digest of a secret still confirms the secret to anyone holding a
    // candidate, so the ordering of the two rules is load-bearing.
    const out = redactSensitive({
      session_token: PROFILE,
      apiKey: CUSTOMER,
    }) as Record<string, string>;

    expect(out.session_token).toBe("[REDACTED]");
    expect(out.apiKey).toBe("[REDACTED]");
  });

  it("leaves non-identifier values untouched", () => {
    const out = redactSensitive({
      amount: 4900,
      tier: "premium",
      priceId: "price_1SnWvoDPtjyWEVqEohJvlvvq",
    }) as { amount: number; tier: string; priceId: string };

    expect(out.amount).toBe(4900);
    expect(out.tier).toBe("premium");
    expect(out.priceId).toBe("price_1SnWvoDPtjyWEVqEohJvlvvq");
  });
});
