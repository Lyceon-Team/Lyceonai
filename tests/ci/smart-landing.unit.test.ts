/**
 * Smart landing: the pure rules.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26) Acceptance: "the arm is deterministic per
 *        (student, window) and changes across windows; only eligible arms are ever chosen (a free
 *        student never gets calendar_today or session_today; Pro without a plan only gets
 *        plan_builder among the Pro arms); first-two-items difficulty; device_class is coarse
 *        only"; Karl's rulings C (dashboard 1/3; calendar_today held) and D (math first 5+5,
 *        superseded); Karl's change the same day: `set_math_5` (5 Math, first 2 easy or medium)
 *        replaces `set_mixed` and `set_math_first`] | @implemented [2026-10-26]
 *
 * plain English:
 *   U1 the same (student, window) always draws the same arm; across windows a student's arm changes
 *   U2 a free student never draws a Pro arm; Pro without a plan gets plan_builder and never
 *      session_today; Pro with a plan gets session_today and never plan_builder; calendar_today
 *      (weight 0) is never drawn and never even eligible
 *   U3 dashboard takes 1/3 of the draws whatever the eligible set is
 *   U4 the set draws: the first 2 are easy/medium, and every draw uses the session's own sections
 *   U4c a landing set is one section (Math), 5 questions; the retired arms are never weighted
 *   U5 device_class: three coarse classes from the client breakpoints; anything else is refused
 *   U6 the 48-hour windows count from the fixed epoch in UTC
 *   U7 the default entry: only Home with nothing else in the address, or the post-auth default
 *      with no return path; a `next` or a hash is a deep link and wins
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LANDING_ARMS,
  LANDING_ARMS_RETIRED,
  LANDING_MORE_SIZE,
  LANDING_SET_SECTIONS,
  LANDING_SET_SIZE,
  LANDING_WINDOW_EPOCH_MS,
  LANDING_WINDOW_MS,
  deviceClassForWidth,
  eligibleLandingArms,
  landingConfigSchema,
  landingOpenRequestSchema,
  landingWindowIndex,
  type LandingArm,
  type LandingConfig,
} from "../../packages/shared/src/smart-landing-schema";
import {
  easyMediumLead,
  landingArmFor,
  planLandingDraws,
} from "../../server/services/landing/assignment";
import {
  captureBootEntry,
  consumeDefaultEntry,
  isLandingRunnerSearch,
  notePostAuthDestination,
  resetLandingEntryForTests,
} from "../../client/src/lib/landing-entry";

/**
 * The weights as production holds them: read from the migration that sets them
 * (20261114000000_smart_landing_math5.sql), not retyped here, so this fixture cannot drift from it.
 */
const WEIGHTS_MIGRATION = readFileSync(
  "supabase/migrations/20261114000000_smart_landing_math5.sql",
  "utf8",
);
const SEEDED_WEIGHTS = landingConfigSchema.shape.weights.parse(
  JSON.parse(
    /^UPDATE public\.practice_runtime_config\s+SET value = '([^']+)'::jsonb/m.exec(
      WEIGHTS_MIGRATION,
    )?.[1] ?? "null",
  ),
);
const CONFIG: Pick<LandingConfig, "dashboardShare" | "weights" | "salt"> = {
  dashboardShare: 0.3333333333,
  weights: SEEDED_WEIGHTS,
  salt: "smart-landing-r1",
};

const student = (n: number): string =>
  `5a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const FREE = { isPro: false, hasPlan: false };
const PRO_NO_PLAN = { isPro: true, hasPlan: false };
const PRO_PLAN = { isPro: true, hasPlan: true };

function draws(
  facts: { isPro: boolean; hasPlan: boolean },
  n = 3000,
): LandingArm[] {
  const out: LandingArm[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push(landingArmFor(student(i), i % 40, facts, CONFIG).arm);
  }
  return out;
}

describe("smart landing: assignment", () => {
  it("U1 the same (student, window) always draws the same arm; across windows it changes", () => {
    for (let s = 0; s < 50; s += 1) {
      for (let w = 0; w < 10; w += 1) {
        expect(landingArmFor(student(s), w, FREE, CONFIG).arm).toBe(
          landingArmFor(student(s), w, FREE, CONFIG).arm,
        );
      }
    }
    // Every one of 50 students sees more than one arm over 20 windows.
    for (let s = 0; s < 50; s += 1) {
      const seen = new Set(
        Array.from(
          { length: 20 },
          (_, w) => landingArmFor(student(s), w, FREE, CONFIG).arm,
        ),
      );
      expect(seen.size, student(s)).toBeGreaterThan(1);
    }
  });

  it("U2 only eligible arms: free never a Pro arm; Pro arms by plan; calendar_today never", () => {
    const free = new Set(draws(FREE));
    expect([...free].sort()).toEqual([
      "dashboard",
      "qotd_then_more",
      "set_math_5",
    ]);
    const noPlan = new Set(draws(PRO_NO_PLAN));
    expect(noPlan.has("plan_builder")).toBe(true);
    expect(noPlan.has("session_today")).toBe(false);
    expect(noPlan.has("calendar_today")).toBe(false);
    const withPlan = new Set(draws(PRO_PLAN));
    expect(withPlan.has("session_today")).toBe(true);
    expect(withPlan.has("plan_builder")).toBe(false);
    expect(withPlan.has("calendar_today")).toBe(false);
    // Eligibility itself: calendar_today (weight 0) is not even eligible.
    expect(eligibleLandingArms(PRO_PLAN, CONFIG.weights)).toEqual([
      "dashboard",
      "qotd_then_more",
      "set_math_5",
      "session_today",
    ]);
    expect(eligibleLandingArms(FREE, CONFIG.weights)).not.toContain(
      "plan_builder",
    );
  });

  it("U3 dashboard takes 1/3 of draws for every eligible set", () => {
    for (const facts of [FREE, PRO_NO_PLAN, PRO_PLAN]) {
      const all = draws(facts, 9000);
      const share = all.filter((a) => a === "dashboard").length / all.length;
      expect(share, JSON.stringify(facts)).toBeGreaterThan(0.31);
      expect(share, JSON.stringify(facts)).toBeLessThan(0.356);
    }
  });
});

describe("smart landing: set composition", () => {
  it("U4 the first 2 draws are easy/medium, in the session's own sections", () => {
    expect(planLandingDraws(LANDING_SET_SIZE, LANDING_SET_SECTIONS)).toEqual([
      { sections: ["M"], easyMediumOnly: true, limit: 2 },
      { sections: ["M"], easyMediumOnly: false, limit: 3 },
    ]);
    // `session_today`: a calendar block's own sections pass straight through.
    expect(planLandingDraws(15, ["RW"])).toEqual([
      { sections: ["RW"], easyMediumOnly: true, limit: 2 },
      { sections: ["RW"], easyMediumOnly: false, limit: 13 },
    ]);
    // A quota-clamped set shrinks the later draw first; the lead never exceeds the size.
    expect(planLandingDraws(1, ["M"])).toEqual([
      { sections: ["M"], easyMediumOnly: true, limit: 1 },
    ]);
    expect(planLandingDraws(0, ["M"])).toEqual([]);
  });

  it("U4b the lead narrows the session's own difficulties to easy/medium, never widens them", () => {
    expect(easyMediumLead([])).toEqual([1, 2]);
    expect(easyMediumLead([1, 2, 3])).toEqual([1, 2]);
    expect(easyMediumLead([2, 3])).toEqual([2]);
    // Hard only: no easy or medium to give, so the session's filter stands. An empty list would
    // reach the RPC as null ("every difficulty") and widen the session.
    expect(easyMediumLead([3])).toEqual([3]);
  });

  it("U4c a landing set is 5 Math questions; the retired arms are never weighted again", () => {
    // One section: the session page runs a practice session in one section (Karl, 2026-10-26).
    expect(LANDING_SET_SECTIONS).toEqual(["M"]);
    expect(LANDING_SET_SIZE).toBe(5);
    expect(LANDING_MORE_SIZE).toBe(5);
    // Presence first: the seeded weights carry the new arm.
    expect(SEEDED_WEIGHTS.set_math_5).toBe(1);
    expect(SEEDED_WEIGHTS.qotd_then_more).toBe(1);
    for (const retired of LANDING_ARMS_RETIRED) {
      expect(LANDING_ARMS as readonly string[]).not.toContain(retired);
      expect(Object.keys(SEEDED_WEIGHTS)).not.toContain(retired);
      // A config that still weights one is unreadable (the rotation is off), never served.
      expect(
        landingConfigSchema.safeParse({
          enabled: true,
          dashboardShare: 0.3,
          weights: { ...SEEDED_WEIGHTS, [retired]: 1 },
          salt: "s",
        }).success,
      ).toBe(false);
    }
  });
});

describe("smart landing: device class and windows", () => {
  it("U5 device_class is coarse only: three classes from the breakpoints; nothing else", () => {
    expect(deviceClassForWidth(390)).toBe("phone");
    expect(deviceClassForWidth(767)).toBe("phone");
    expect(deviceClassForWidth(768)).toBe("tablet");
    expect(deviceClassForWidth(1023)).toBe("tablet");
    expect(deviceClassForWidth(1024)).toBe("desktop");
    const ok = { device_class: "phone", client_instance_id: "c1" };
    expect(landingOpenRequestSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, device_class: "iPhone 15 Pro" },
      {
        ...ok,
        device_class: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      },
      { ...ok, device_class: "mobile" },
      { ...ok, screen_width: 390 },
      { ...ok, user_agent: "Mozilla/5.0" },
    ]) {
      expect(
        landingOpenRequestSchema.safeParse(bad).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it("U6 48-hour windows from the fixed epoch, in UTC", () => {
    expect(landingWindowIndex(new Date(LANDING_WINDOW_EPOCH_MS))).toBe(0);
    expect(
      landingWindowIndex(
        new Date(LANDING_WINDOW_EPOCH_MS + LANDING_WINDOW_MS - 1),
      ),
    ).toBe(0);
    expect(
      landingWindowIndex(new Date(LANDING_WINDOW_EPOCH_MS + LANDING_WINDOW_MS)),
    ).toBe(1);
    expect(landingWindowIndex(new Date(LANDING_WINDOW_EPOCH_MS - 1))).toBe(-1);
    expect(new Date(LANDING_WINDOW_EPOCH_MS).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z",
    );
  });
});

describe("smart landing: the default entry (precedence: deep links win)", () => {
  beforeEach(() => resetLandingEntryForTests());

  it("U7 only Home with nothing else, or the post-auth default with no return path", () => {
    captureBootEntry({ pathname: "/dashboard", search: "", hash: "" });
    expect(consumeDefaultEntry()).toBe(true);
    expect(consumeDefaultEntry()).toBe(false); // once per entry

    for (const deep of [
      { pathname: "/dashboard", search: "", hash: "#qotd" },
      { pathname: "/dashboard", search: "?utm_source=resend", hash: "" },
      { pathname: "/practice", search: "", hash: "" },
      { pathname: "/calendar", search: "", hash: "" },
    ]) {
      captureBootEntry(deep);
      expect(consumeDefaultEntry(), JSON.stringify(deep)).toBe(false);
    }

    notePostAuthDestination("/dashboard", null);
    expect(consumeDefaultEntry()).toBe(true);
    notePostAuthDestination("/dashboard", "/dashboard"); // an explicit next is a deep link
    expect(consumeDefaultEntry()).toBe(false);
    notePostAuthDestination("/practice", "/practice");
    expect(consumeDefaultEntry()).toBe(false);
    notePostAuthDestination("/guardian-required", null);
    expect(consumeDefaultEntry()).toBe(false);

    expect(isLandingRunnerSearch("?from=landing")).toBe(true);
    expect(isLandingRunnerSearch("?from=landing-x")).toBe(false);
    expect(isLandingRunnerSearch("")).toBe(false);
  });
});
