/**
 * @spec [Doc_05F_Study_Calendar, §17.4 plan-updated banner (INV-08-13), §12.1 triggers]
 *
 * plain English: the banner names what happened, and it only ever appears for a change the
 * student did NOT make. The trigger sweep below is the guard that matters: a new literal
 * added to `PLAN_TRIGGERS` must be either one of §17.4's three sentences or null — it can
 * never silently inherit the wrong one.
 */
import { describe, expect, it } from "vitest";
import { PLAN_TRIGGERS, type PlanTrigger } from "@lyceon/shared";
import { BANNER_COPY_TABLE, bannerCopy } from "./banner";

/** §12.1's student-initiated triggers — §12.7 never surfaces a version for any of these. */
const STUDENT_TRIGGERS: readonly PlanTrigger[] = [
  "setup",
  "profile_change",
  "student_refresh",
  "day_edit",
  "day_regenerate",
  "day_reset",
  "do_it_now",
];

/** The three §17.4 sentences, keyed by the only trigger mapping that fits. */
const NON_STUDENT_COPY: Readonly<Record<string, string>> = {
  weekly: "Your plan was refreshed for the week.",
  post_exam: "Your plan was updated after your practice test.",
  rollback: "Your plan was restored by support.",
};

describe("bannerCopy (§17.4)", () => {
  it("gives the week-refresh sentence for `weekly`", () => {
    expect(bannerCopy("weekly")).toBe("Your plan was refreshed for the week.");
  });

  it("gives the after-the-exam sentence for `post_exam`", () => {
    expect(bannerCopy("post_exam")).toBe(
      "Your plan was updated after your practice test.",
    );
  });

  it("gives the support-restore sentence for `rollback`", () => {
    expect(bannerCopy("rollback")).toBe("Your plan was restored by support.");
  });

  it("carries exactly the three §17.4 sentences and nothing else", () => {
    expect(BANNER_COPY_TABLE).toEqual(NON_STUDENT_COPY);
  });
});

describe("student-initiated triggers say nothing (§12.7)", () => {
  it.each([...STUDENT_TRIGGERS])(
    "returns null for the student-initiated trigger %s — no default sentence",
    (trigger) => {
      const copy = bannerCopy(trigger);
      expect(copy).toBeNull();
      // Never an empty bar, and never a borrowed sentence: telling a student their plan was
      // "refreshed for the week" because they moved a block would be a lie.
      expect(copy).not.toBe("");
    },
  );

  it("accounts for every trigger in PLAN_TRIGGERS", () => {
    // The sweep: a trigger added to the shared enum is either one of the three §17.4
    // sentences or null. There is no third outcome, and no way to acquire a wrong one.
    for (const trigger of PLAN_TRIGGERS) {
      const copy = bannerCopy(trigger);
      const expected = NON_STUDENT_COPY[trigger] ?? null;
      expect(copy).toBe(expected);
    }
  });

  it("splits PLAN_TRIGGERS into exactly the three that speak and the rest that do not", () => {
    const speaking = PLAN_TRIGGERS.filter(
      (trigger) => bannerCopy(trigger) !== null,
    );
    const silent = PLAN_TRIGGERS.filter(
      (trigger) => bannerCopy(trigger) === null,
    );
    expect([...speaking].sort()).toEqual(["post_exam", "rollback", "weekly"]);
    expect([...silent].sort()).toEqual([...STUDENT_TRIGGERS].sort());
    expect(speaking.length + silent.length).toBe(PLAN_TRIGGERS.length);
  });
});
