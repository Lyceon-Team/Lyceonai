/**
 * @spec [Doc 07A V1.0 §9.2 (wrapper steps and refusal reasons), §7.1 (analytics_user_id
 *       derivation), §8 (redaction), §6 (the registered schemas); SCL-201 IS 1 (under-13
 *       excluded); SCL-213 (the launch set); Coding Standards §14] | @implemented [2026-10-05]
 *
 * plain English: drives the REAL wrapper (`emitEventWith`) against the REAL registry module and
 * the real Ajv validators; only the outside world (env, profile read, identity write, the PostHog
 * send) is injected and recorded. Every refusal is asserted twice: the reason returned AND that
 * nothing was sent — and, where the refusal must precede IO, that nothing was read or written.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../apps/api/src/lib/supabase-server", () => ({
  supabaseServer: {},
}));

import {
  EVENT_REGISTRY,
  emitEventWith,
  type EmitDeps,
} from "../../server/lib/analytics/emit-event";
import { deriveAnalyticsUserId } from "../../server/lib/analytics/analytics-user-id";

const PROFILE = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const SALT = "test-analytics-salt-at-least-32-characters-long";
const NOW = new Date("2026-10-05T12:00:00.000Z");

type Sent = Parameters<EmitDeps["send"]>[0];

type Facts = {
  analyticsUserId: string | null;
  isUnder13: boolean | null;
  onboarded?: boolean;
};

function harness(profile: Facts | null) {
  const sent: Sent[] = [];
  const reads: string[] = [];
  const writes: { profileId: string; derived: string }[] = [];
  let stored = profile?.analyticsUserId ?? null;
  const deps: EmitDeps = {
    env: { POSTHOG_API_KEY: "phc_test", ANALYTICS_SALT: SALT },
    loadProfile: async (id) => {
      reads.push(id);
      return profile === null
        ? null
        : {
            analyticsUserId: stored,
            isUnder13: profile.isUnder13,
            onboarded: profile.onboarded ?? true,
          };
    },
    persistAnalyticsUserId: async (profileId, derived) => {
      writes.push({ profileId, derived });
      const wroteNow = stored === null;
      stored ??= derived;
      return { stored, wroteNow };
    },
    send: async (message) => {
      sent.push(message);
    },
    now: () => NOW,
  };
  return { deps, sent, reads, writes };
}

describe("Doc 07A §7.1 analytics_user_id derivation", () => {
  it("is HMAC-SHA256(salt, id) → first 16 bytes → v4 + RFC 4122 variant, lowercase 8-4-4-4-12", () => {
    const id = deriveAnalyticsUserId(PROFILE, SALT);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // Independent recomputation of the spec's five steps.
    const raw = createHmac("sha256", SALT)
      .update(PROFILE, "utf8")
      .digest()
      .subarray(0, 16);
    const b = Buffer.from(raw);
    b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
    b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
    const hex = b.toString("hex");
    expect(id).toBe(
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
  });

  it("is deterministic per salt and unrelated across salts", () => {
    expect(deriveAnalyticsUserId(PROFILE, SALT)).toBe(
      deriveAnalyticsUserId(PROFILE, SALT),
    );
    expect(deriveAnalyticsUserId(PROFILE, `${SALT}-other`)).not.toBe(
      deriveAnalyticsUserId(PROFILE, SALT),
    );
    // Never the raw id.
    expect(deriveAnalyticsUserId(PROFILE, SALT)).not.toBe(PROFILE);
  });
});

describe("Doc 07A §9.2 emitEvent", () => {
  it("emits a registered event with wrapper-injected base fields, to the HMAC distinct id", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    const result = await emitEventWith(
      h.deps,
      PROFILE,
      "tutor_session_started",
      {
        tutor_session_id: "11111111-2222-4333-8444-555555555555",
        tutor_entry_mode: "general",
      },
    );
    expect(result).toEqual({ ok: true });
    expect(h.sent).toHaveLength(1);
    const expectedId = deriveAnalyticsUserId(PROFILE, SALT);
    expect(h.sent[0]).toEqual({
      distinctId: expectedId,
      event: "tutor_session_started",
      timestamp: NOW,
      properties: {
        event_name: "tutor_session_started",
        timestamp: NOW.toISOString(),
        analytics_user_id: expectedId,
        schema_version: "1.0.0",
        tutor_session_id: "11111111-2222-4333-8444-555555555555",
        tutor_entry_mode: "general",
      },
    });
    // The raw profile id never leaves.
    expect(JSON.stringify(h.sent)).not.toContain(PROFILE);
    // First emission writes the set-once identity.
    expect(h.writes).toEqual([{ profileId: PROFILE, derived: expectedId }]);
  });

  it("reuses a stored analytics_user_id and never rewrites it", async () => {
    const stored = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const h = harness({ analyticsUserId: stored, isUnder13: false });
    expect(await emitEventWith(h.deps, PROFILE, "user_signed_in", {})).toEqual({
      ok: true,
    });
    expect(h.sent[0]?.distinctId).toBe(stored);
    expect(h.writes).toEqual([]);
  });

  it.each([
    ["under 13", true],
    ["age not yet known", null],
  ])(
    "refuses an account %s, before any identity is derived or sent",
    async (_label, isUnder13) => {
      const h = harness({ analyticsUserId: null, isUnder13 });
      expect(
        await emitEventWith(h.deps, PROFILE, "user_signed_in", {}),
      ).toEqual({
        ok: false,
        reason: "excluded_under_13_or_age_unknown",
      });
      expect(h.sent).toEqual([]);
      expect(h.writes).toEqual([]);
    },
  );

  it("refuses a profile that does not exist (no anonymous path)", async () => {
    const h = harness(null);
    expect(await emitEventWith(h.deps, PROFILE, "user_signed_in", {})).toEqual({
      ok: false,
      reason: "unauthenticated_emission_attempt",
    });
    expect(h.sent).toEqual([]);
  });

  it.each(["event_name", "timestamp", "analytics_user_id", "schema_version"])(
    "refuses a caller-supplied base field (%s) before any identity write or send",
    async (field) => {
      const h = harness({ analyticsUserId: null, isUnder13: false });
      expect(
        await emitEventWith(h.deps, PROFILE, "user_signed_in", {
          [field]: "spoof",
        }),
      ).toEqual({ ok: false, reason: "caller_supplied_base_field" });
      // §9.2 order: the subject is resolved first (step 2), the base field refused at step 4.
      expect(h.reads).toEqual([PROFILE]);
      expect(h.writes).toEqual([]);
      expect(h.sent).toEqual([]);
    },
  );

  it.each(["practice_question_submitted", "consent_captured", "page_viewed"])(
    "refuses an unregistered event (%s — deferred by SCL-213 or never registered)",
    async (name) => {
      const h = harness({ analyticsUserId: null, isUnder13: false });
      expect(await emitEventWith(h.deps, PROFILE, name, {})).toEqual({
        ok: false,
        reason: "event_not_registered",
      });
      expect(h.writes).toEqual([]);
      expect(h.sent).toEqual([]);
    },
  );

  it.each([
    [
      "an extra property",
      "user_signed_out",
      { signout_trigger: "explicit", email: "x@y.z" },
    ],
    [
      "a value outside the enum",
      "user_signed_out",
      { signout_trigger: "timeout" },
    ],
    ["a missing required property", "user_signed_up", {}],
    [
      "a non-uuid id",
      "exam_started",
      { test_session_id: "abc", test_form_id: "def" },
    ],
    [
      "a negative duration",
      "tutor_session_ended",
      {
        tutor_session_id: "11111111-2222-4333-8444-555555555555",
        session_duration_ms: -1,
        turn_count: 0,
      },
    ],
  ])(
    "refuses %s (strict JSON Schema), with details",
    async (_label, name, payload) => {
      const h = harness({ analyticsUserId: null, isUnder13: false });
      const result = await emitEventWith(h.deps, PROFILE, name, payload);
      expect(result).toMatchObject({
        ok: false,
        reason: "schema_validation_failed",
      });
      // §9.2 step 8 details: paths and keywords only — never a value.
      const details = result.ok ? [] : (result.details ?? []);
      expect(details.length).toBeGreaterThan(0);
      for (const value of Object.values(payload)) {
        expect(JSON.stringify(details)).not.toContain(String(value));
      }
      expect(h.sent).toEqual([]);
    },
  );

  it("refuses any event but user_signed_up before onboarding completes", async () => {
    const h = harness({
      analyticsUserId: null,
      isUnder13: false,
      onboarded: false,
    });
    expect(await emitEventWith(h.deps, PROFILE, "user_signed_in", {})).toEqual({
      ok: false,
      reason: "account_not_onboarded",
    });
    // No identity was written, so the completion that follows still emits user_signed_up.
    expect(h.writes).toEqual([]);
    expect(
      await emitEventWith(
        h.deps,
        PROFILE,
        "user_signed_up",
        { signup_source: "direct" },
        { requireFirstIdentity: true },
      ),
    ).toEqual({ ok: true });
    expect(h.sent.map((m) => m.event)).toEqual(["user_signed_up"]);
  });

  it("returns identity_unavailable (never throws) when the profile read fails", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    h.deps.loadProfile = async () => {
      throw new Error("db down");
    };
    expect(await emitEventWith(h.deps, PROFILE, "user_signed_in", {})).toEqual({
      ok: false,
      reason: "identity_unavailable",
    });
    expect(h.sent).toEqual([]);
  });

  it("is a no-op with no configuration, touching nothing", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    h.deps.env = {};
    expect(await emitEventWith(h.deps, PROFILE, "user_signed_in", {})).toEqual({
      ok: false,
      reason: "analytics_not_configured",
    });
    expect(h.reads).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("returns send_failed (never throws) when PostHog refuses", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    h.deps.send = async () => {
      throw new Error("network");
    };
    expect(await emitEventWith(h.deps, PROFILE, "user_signed_in", {})).toEqual({
      ok: false,
      reason: "send_failed",
    });
  });
});

describe("user_signed_up fires once (requireFirstIdentity)", () => {
  const payload = { signup_source: "organic_search" };

  it("emits from the call that writes the identity", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    expect(
      await emitEventWith(h.deps, PROFILE, "user_signed_up", payload, {
        requireFirstIdentity: true,
      }),
    ).toEqual({ ok: true });
    expect(h.sent.map((m) => m.properties["signup_source"])).toEqual([
      "organic_search",
    ]);
  });

  it("a second completion (identity already written) emits nothing", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    await emitEventWith(h.deps, PROFILE, "user_signed_up", payload, {
      requireFirstIdentity: true,
    });
    expect(
      await emitEventWith(h.deps, PROFILE, "user_signed_up", payload, {
        requireFirstIdentity: true,
      }),
    ).toEqual({ ok: false, reason: "not_first_identity" });
    expect(h.sent).toHaveLength(1);
  });

  it("a concurrent loser (the write found the column already set) emits nothing", async () => {
    const h = harness({ analyticsUserId: null, isUnder13: false });
    h.deps.persistAnalyticsUserId = async (_id, derived) => ({
      stored: derived,
      wroteNow: false,
    });
    expect(
      await emitEventWith(h.deps, PROFILE, "user_signed_up", payload, {
        requireFirstIdentity: true,
      }),
    ).toEqual({ ok: false, reason: "not_first_identity" });
    expect(h.sent).toEqual([]);
  });
});

describe("registry module", () => {
  it("carries exactly the SCL-213 launch set", () => {
    expect(EVENT_REGISTRY.events.map((e) => e.event_name).sort()).toEqual([
      "exam_section_submitted",
      "exam_started",
      "tutor_session_ended",
      "tutor_session_started",
      "user_signed_in",
      "user_signed_out",
      "user_signed_up",
    ]);
  });
});
