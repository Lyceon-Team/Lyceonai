/**
 * Smart landing: the pure rules.
 *
 * @spec [owner brief "Smart landing" (Karl, 2026-10-26) Acceptance: "the arm is deterministic per
 *        (student, window) and changes across windows; only eligible arms are ever chosen (a free
 *        student never gets calendar_today or session_today; Pro without a plan only gets
 *        plan_builder among the Pro arms); first-two-items difficulty; device_class is coarse
 *        only"; Karl's rulings C (dashboard 1/3; calendar_today held) and D (math first 5+5)]
 *       | @implemented [2026-10-26]
 *
 * plain English:
 *   U1 the same (student, window) always draws the same arm; across windows a student's arm changes
 *   U2 a free student never draws a Pro arm; Pro without a plan gets plan_builder and never
 *      session_today; Pro with a plan gets session_today and never plan_builder; calendar_today
 *      (weight 0) is never drawn and never even eligible
 *   U3 dashboard takes 1/3 of the draws whatever the eligible set is
 *   U4 the set draws: the first 2 are easy/medium; math first is 5 Math then 5 RW
 *   U5 device_class: three coarse classes from the client breakpoints; anything else is refused
 *   U6 the 48-hour windows count from the fixed epoch in UTC
 *   U7 the default entry: only Home with nothing else in the address, or the post-auth default
 *      with no return path; a `next` or a hash is a deep link and wins
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  LANDING_WINDOW_EPOCH_MS,
  LANDING_WINDOW_MS,
  deviceClassForWidth,
  eligibleLandingArms,
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

/** The seeded round-1 config (migration 20261113000000_smart_landing.sql). */
const CONFIG: Pick<LandingConfig, "dashboardShare" | "weights" | "salt"> = {
  dashboardShare: 0.3333333333,
  weights: {
    qotd_then_more: 1,
    set_mixed: 1,
    set_math_first: 1,
    session_today: 1,
    plan_builder: 1,
    calendar_today: 0,
  },
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
      "set_math_first",
      "set_mixed",
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
      "set_mixed",
      "set_math_first",
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
  it("U4 the first 2 draws are easy/medium; math first is 5 Math then 5 RW", () => {
    expect(planLandingDraws("mixed", 10)).toEqual([
      { sections: ["M", "RW"], easyMediumOnly: true, limit: 2 },
      { sections: ["M", "RW"], easyMediumOnly: false, limit: 8 },
    ]);
    expect(planLandingDraws("math_first", 10)).toEqual([
      { sections: ["M"], easyMediumOnly: true, limit: 2 },
      { sections: ["M"], easyMediumOnly: false, limit: 3 },
      { sections: ["RW"], easyMediumOnly: false, limit: 5 },
    ]);
    expect(planLandingDraws("scoped", 15, ["RW"])).toEqual([
      { sections: ["RW"], easyMediumOnly: true, limit: 2 },
      { sections: ["RW"], easyMediumOnly: false, limit: 13 },
    ]);
    // A quota-clamped set shrinks the later draws first; the lead never exceeds the size.
    expect(planLandingDraws("math_first", 3)).toEqual([
      { sections: ["M"], easyMediumOnly: true, limit: 2 },
      { sections: ["M"], easyMediumOnly: false, limit: 1 },
    ]);
    expect(planLandingDraws("mixed", 1)).toEqual([
      { sections: ["M", "RW"], easyMediumOnly: true, limit: 1 },
    ]);
    expect(planLandingDraws("mixed", 0)).toEqual([]);
  });

  it("U4b the lead narrows the session's own difficulties to easy/medium, never widens them", () => {
    expect(easyMediumLead([])).toEqual([1, 2]);
    expect(easyMediumLead([1, 2, 3])).toEqual([1, 2]);
    expect(easyMediumLead([2, 3])).toEqual([2]);
    // Hard only: no easy or medium to give, so the session's filter stands. An empty list would
    // reach the RPC as null ("every difficulty") and widen the session.
    expect(easyMediumLead([3])).toEqual([3]);
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
