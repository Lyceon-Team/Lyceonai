/**
 * The guardian accountability loop — payload rule, wording, and the job's window and hour guard.
 *
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Content": "the student's
 *        first name and plain-language lines … No other student data"; "Delivery" (18:00 Chicago);
 *        contracts/notifications.contract.md §8.1 (amended)] | @implemented [2026-10-13]
 *
 * plain English: pure checks that need no database. The payloads are `.strict()` (a block id,
 * a scope or an address cannot ride along); every line a guardian reads is built by one function
 * per fact, so the bell and the digest say the same thing; a name that is not a name is never
 * shown; the job's evaluation window starts at yesterday on a first run and never re-reads a day
 * it has evaluated; and the job does nothing at all outside the 18:00 Chicago hour.
 */
import { describe, expect, it, vi } from "vitest";

import {
  backOnTrackPayloadSchema,
  guardianDailyDigestPayloadSchema,
  missedPlanAlertPayloadSchema,
  studyPlanChangedPayloadSchema,
  type GuardianDailyDigestPayload,
} from "../../packages/shared/src/notifications-schema";
import {
  accountabilityFirstName,
  completionLine,
  digestLines,
  planChangeLine,
} from "../../server/lib/notifications/templates/accountability";
import {
  renderEmail,
  renderInApp,
} from "../../server/lib/notifications/templates";
import {
  evaluationWindow,
  LOOKBACK_DAYS,
  runGuardianAccountabilityJob,
} from "../../server/services/calendar/accountability-job";

const ctxGuardian = {
  recipientIsSubject: false,
  siteUrl: "https://lyceon.test",
};
const ctxStudent = { recipientIsSubject: true, siteUrl: "https://lyceon.test" };

describe("C8.1: the payloads carry rendering parameters only", () => {
  const reduced = {
    kind: "day_reduced",
    student_first_name: "Amingwa",
    plan_date: "2026-10-14",
    before_minutes: 45,
    after_minutes: 15,
    digest_date: "2026-10-13",
  };
  it("study_plan_changed refuses a block id, a scope or an email", () => {
    expect(studyPlanChangedPayloadSchema.safeParse(reduced).success).toBe(true);
    for (const extra of [
      { block_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
      { scope: { level: "section" } },
      { email: "a@b.test" },
    ]) {
      expect(
        studyPlanChangedPayloadSchema.safeParse({ ...reduced, ...extra })
          .success,
      ).toBe(false);
    }
  });
  it("missed_plan_alert, back_on_track and the digest refuse extra keys", () => {
    const missed = {
      student_first_name: "Amingwa",
      missed_days: 2,
      last_missed_date: "2026-10-12",
      digest_date: "2026-10-13",
    };
    expect(missedPlanAlertPayloadSchema.safeParse(missed).success).toBe(true);
    expect(
      missedPlanAlertPayloadSchema.safeParse({ ...missed, mastery: 0.4 })
        .success,
    ).toBe(false);
    const back = {
      student_first_name: "Amingwa",
      back_on_date: "2026-10-13",
      digest_date: "2026-10-13",
    };
    expect(backOnTrackPayloadSchema.safeParse(back).success).toBe(true);
    expect(
      backOnTrackPayloadSchema.safeParse({ ...back, answers: [] }).success,
    ).toBe(false);
    const digest = {
      digest_date: "2026-10-13",
      students: [
        {
          student_first_name: "Amingwa",
          completion: { planned: 2, completed: 1 },
          plan_changes: [],
          missed_plan_alert: null,
          back_on_track: false,
        },
      ],
    };
    expect(guardianDailyDigestPayloadSchema.safeParse(digest).success).toBe(
      true,
    );
    expect(
      guardianDailyDigestPayloadSchema.safeParse({
        ...digest,
        students: [{ ...digest.students[0], target_score: 1400 }],
      }).success,
    ).toBe(false);
    // An empty digest is not a digest: "No empty emails".
    expect(
      guardianDailyDigestPayloadSchema.safeParse({ ...digest, students: [] })
        .success,
    ).toBe(false);
  });
});

describe("SCL-230 (approved by Karl 2026-10-13): the schedule changes", () => {
  it("study days travel as a count, never the mask; the payload refuses the mask", () => {
    const days = {
      kind: "study_days",
      student_first_name: "Amingwa",
      before_days: 5,
      after_days: 4,
      digest_date: "2026-10-13",
    };
    expect(studyPlanChangedPayloadSchema.safeParse(days).success).toBe(true);
    expect(
      studyPlanChangedPayloadSchema.safeParse({ ...days, study_days_mask: 62 })
        .success,
    ).toBe(false);
  });

  it("the brief's line, and the minutes and frequency lines", () => {
    expect(
      planChangeLine("Amingwa", {
        kind: "study_days",
        before_days: 5,
        after_days: 4,
      }),
    ).toBe("Amingwa reduced study days from 5 to 4 a week");
    expect(
      planChangeLine("Amingwa", {
        kind: "study_days",
        before_days: 4,
        after_days: 4,
      }),
    ).toBe("Amingwa changed which days they study (4 a week)");
    expect(
      planChangeLine("Amingwa", {
        kind: "daily_minutes",
        before_minutes: 60,
        after_minutes: 45,
      }),
    ).toBe("Amingwa reduced daily study time from 60 to 45 minutes");
    expect(
      planChangeLine("Amingwa", {
        kind: "full_length_frequency",
        before_weekday: 6,
        before_interval_weeks: 2,
        after_weekday: null,
        after_interval_weeks: null,
      }),
    ).toBe(
      "Amingwa changed practice tests from every 2 weeks on Saturdays to none",
    );
    expect(
      planChangeLine("Amingwa", {
        kind: "full_length_frequency",
        before_weekday: 6,
        before_interval_weeks: 1,
        after_weekday: 0,
        after_interval_weeks: 4,
      }),
    ).toBe(
      "Amingwa changed practice tests from every week on Saturdays to every 4 weeks on Sundays",
    );
  });
});

describe("Karl's ruling 5 (2026-10-13): the digest's one-click unsubscribe", () => {
  const payload = {
    digest_date: "2026-10-13",
    students: [
      {
        student_first_name: "Amingwa",
        completion: { planned: 2, completed: 1 },
        plan_changes: [],
        missed_plan_alert: null,
        back_on_track: false,
      },
    ],
  };
  it("carries List-Unsubscribe + List-Unsubscribe-Post and the link in the body when the dispatcher gives one", () => {
    const link =
      "https://lyceon.test/api/public/guardian-digest-email/unsubscribe?t=x.y";
    const email = renderEmail("guardian_daily_digest", payload, {
      ...ctxGuardian,
      guardianDigestEmail: { unsubscribeUrl: link },
    });
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    expect(email.value.headers).toEqual({
      "List-Unsubscribe": `<${link}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(email.value.text).toContain(link);
    expect(email.value.html).toContain(link);
  });
});

describe("the lines a guardian reads", () => {
  it("plain-language sentences, the brief's examples", () => {
    expect(
      planChangeLine("Amingwa", {
        kind: "day_reduced",
        plan_date: "2026-10-14",
        before_minutes: 45,
        after_minutes: 0,
      }),
    ).toBe("Amingwa cleared the plan for Wednesday 14 October (45 min)");
    expect(
      planChangeLine("Amingwa", {
        kind: "day_reduced",
        plan_date: "2026-10-14",
        before_minutes: 45,
        after_minutes: 15,
      }),
    ).toBe(
      "Amingwa reduced the plan for Wednesday 14 October from 45 min to 15 min",
    );
    expect(
      planChangeLine("Amingwa", {
        kind: "full_length_moved",
        plan_date: "2026-10-17",
        to_date: "2026-10-24",
      }),
    ).toBe(
      "Amingwa moved the practice test from Saturday 17 October to Saturday 24 October",
    );
    expect(
      planChangeLine("Amingwa", {
        kind: "full_length_removed",
        plan_date: "2026-10-17",
      }),
    ).toBe("Amingwa removed the practice test on Saturday 17 October");
    expect(completionLine("Amingwa", { planned: 2, completed: 1 })).toBe(
      "Amingwa completed 1 of 2 planned sessions today so far",
    );
    expect(completionLine("Amingwa", { planned: 1, completed: 1 })).toBe(
      "Amingwa completed 1 of 1 planned session today so far",
    );
  });

  it("a display name that is not a usable first name is never shown", () => {
    expect(accountabilityFirstName("Amingwa")).toBe("Amingwa");
    expect(accountabilityFirstName("Anne-Marie")).toBe("Anne-Marie");
    expect(accountabilityFirstName("amingwa08")).toBe("Your student");
    expect(accountabilityFirstName("J")).toBe("Your student");
    expect(accountabilityFirstName("")).toBe("Your student");
    expect(accountabilityFirstName("<script>")).toBe("Your student");
  });

  it("the bell speaks to the guardian by name and to the student as 'you'", () => {
    const missed = {
      student_first_name: "Amingwa",
      missed_days: 2,
      last_missed_date: "2026-10-12",
      digest_date: "2026-10-13",
    };
    const g = renderInApp("missed_plan_alert", missed, ctxGuardian);
    const s = renderInApp("missed_plan_alert", missed, ctxStudent);
    expect(g.ok && g.value.title).toBe(
      "Amingwa hasn't studied for 2 planned days",
    );
    expect(s.ok && s.value.title).toBe(
      "You haven't studied for 2 planned days",
    );
    const back = renderInApp(
      "back_on_track",
      {
        student_first_name: "Amingwa",
        back_on_date: "2026-10-13",
        digest_date: "2026-10-13",
      },
      ctxGuardian,
    );
    expect(back.ok && back.value.title).toBe("Amingwa is back on track");
    const change = renderInApp(
      "study_plan_changed",
      {
        kind: "day_reduced",
        student_first_name: "Amingwa",
        plan_date: "2026-10-14",
        before_minutes: 45,
        after_minutes: 0,
        digest_date: "2026-10-13",
      },
      ctxGuardian,
    );
    expect(change.ok && change.value.body).toBe(
      "Amingwa cleared the plan for Wednesday 14 October (45 min).",
    );
  });

  it("the digest email lists each student's lines and nothing else, escaped", () => {
    const payload: GuardianDailyDigestPayload = {
      digest_date: "2026-10-13",
      students: [
        {
          student_first_name: "Amingwa",
          completion: { planned: 2, completed: 1 },
          plan_changes: [
            {
              kind: "day_reduced",
              plan_date: "2026-10-14",
              before_minutes: 45,
              after_minutes: 15,
            },
          ],
          missed_plan_alert: { missed_days: 2 },
          back_on_track: false,
        },
        {
          student_first_name: "O'Neil",
          completion: null,
          plan_changes: [],
          missed_plan_alert: null,
          back_on_track: true,
        },
      ],
    };
    expect(digestLines(payload.students[0]!)).toEqual([
      "Amingwa hasn't studied for 2 planned days",
      "Amingwa completed 1 of 2 planned sessions today so far",
      "Amingwa reduced the plan for Wednesday 14 October from 45 min to 15 min",
    ]);
    const email = renderEmail("guardian_daily_digest", payload, ctxGuardian);
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    expect(email.value.subject).toBe("Your students' day on Lyceon");
    expect(email.value.text).toContain("O'Neil is back on track");
    expect(email.value.html).toContain("O&#39;Neil is back on track");
    expect(email.value.text).toContain("turn off the daily summary email");
    expect(email.value.headers).toBeUndefined();
  });
});

describe("the job's evaluation window", () => {
  it("a first run starts at yesterday, so history before the feature is never alerted on", () => {
    expect(
      evaluationWindow({
        today: "2026-10-13",
        lastEvaluated: null,
        digestDate: "2026-10-13",
      }),
    ).toEqual({
      from: "2026-10-12",
      readFrom: "2026-10-12",
      readTo: "2026-10-13",
      through: "2026-10-12",
    });
  });
  it("later runs resume after the last evaluated day, never before it, and never further back than the lookback", () => {
    expect(
      evaluationWindow({
        today: "2026-10-13",
        lastEvaluated: "2026-10-10",
        digestDate: "2026-10-13",
      }).from,
    ).toBe("2026-10-11");
    expect(
      evaluationWindow({
        today: "2026-10-13",
        lastEvaluated: "2026-01-01",
        digestDate: "2026-10-13",
      }).from,
    ).toBe("2026-09-29");
    expect(LOOKBACK_DAYS).toBe(14);
  });
  it("a student ahead of Chicago (tomorrow already) still reads the digest day", () => {
    const w = evaluationWindow({
      today: "2026-10-14",
      lastEvaluated: "2026-10-13",
      digestDate: "2026-10-13",
    });
    expect(w.readFrom).toBe("2026-10-13");
    expect(w.readTo).toBe("2026-10-14");
  });
});

describe("the hour guard", () => {
  it("does nothing — no read, no write, no send — outside the 18:00 Chicago hour, in either season", async () => {
    for (const at of [
      "2026-07-14T22:59:00Z", // 17:59 CDT
      "2026-07-15T00:00:00Z", // 19:00 CDT
      "2026-01-14T23:59:00Z", // 17:59 CST
      "2026-01-15T01:00:00Z", // 19:00 CST
    ]) {
      const rpc = vi.fn();
      const dispatch = vi.fn();
      const readDays = vi.fn();
      const summary = await runGuardianAccountabilityJob({
        db: { rpc },
        dispatch,
        readDays,
        now: new Date(at),
      });
      expect(summary.skipped).toBe("not_send_hour");
      expect(rpc).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      expect(readDays).not.toHaveBeenCalled();
    }
  });
});
