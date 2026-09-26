/**
 * @spec [Doc_05F_Study_Calendar, §12.2 protected state, §12.4 day edit, §12.6 do-it-now,
 *        §12.7 acknowledgement, §13 progress, §14 derived counts]
 * @implemented [2026-09-22]
 *
 * plain English: `optimistic.ts` is the only place the client PREDICTS what the server is
 * about to write, so every rule it encodes is asserted here against a realistic `ready`
 * payload. Expected outcome: a prediction that drifts from §12/§14 fails a test rather than
 * painting a day whose header contradicts the blocks beneath it.
 *
 * The whole module is pure, so these tests need no DOM, no query client and no network. The
 * fixture is DEEP-FROZEN: purity is not a style preference here — the same `CalendarResponse`
 * object is live in the TanStack cache while these functions run, and a mutation in place
 * would corrupt the snapshot `onError` rolls back to.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  calendarResponseSchema,
  type CalendarResponse,
  type DayBlock,
  type PlanBlock,
} from "@lyceon/shared";
import {
  applyAcknowledge,
  applyBlockEdit,
  applyDoItNow,
  applyMove,
  applyRemoveBlock,
  findBlock,
  isProvisional,
  resetProvisionalIds,
} from "./optimistic";

// ── Fixture ─────────────────────────────────────────────────────────────────

const YESTERDAY = "2026-09-21";
const TODAY = "2026-09-22";
const TOMORROW = "2026-09-23";
/** A date the loaded range does NOT cover — the "dragged off the edge" case. */
const OUT_OF_RANGE = "2026-10-05";

const B_PRACTICE_PAST = "00000000-0000-4000-8000-000000000001";
const B_REVIEW_PAST = "00000000-0000-4000-8000-000000000002";
const B_PRACTICE_TODAY = "00000000-0000-4000-8000-000000000003";
const B_EXAM_TOMORROW = "00000000-0000-4000-8000-000000000004";

const TZ = "America/Los_Angeles";

function practiceBlock(
  blockId: string,
  date: string,
  ordinal: number,
  target: number,
): PlanBlock {
  return {
    block_id: blockId,
    scheduled_date: date,
    block_type: "practice",
    section: "M",
    scope: {
      level: "domain",
      mix: [{ domain: "Algebra", count: target, explanation_key: "weak" }],
    },
    target_count: target,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "weighted",
    display_ordinal: ordinal,
    membership_type: "created",
  };
}

function reviewBlock(
  blockId: string,
  date: string,
  ordinal: number,
  target: number,
): PlanBlock {
  return {
    block_id: blockId,
    scheduled_date: date,
    block_type: "review",
    section: null,
    scope: { mode: "queue" },
    target_count: target,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "review_due",
    display_ordinal: ordinal,
    membership_type: "created",
  };
}

function examBlock(blockId: string, date: string, ordinal: number): PlanBlock {
  return {
    block_id: blockId,
    scheduled_date: date,
    block_type: "full_length",
    section: null,
    scope: { form_id: null, exam_mode: "strict" },
    target_count: 1,
    source: "auto",
    derived_from_block_id: null,
    explanation_key: "exam_cadence",
    display_ordinal: ordinal,
    membership_type: "created",
  };
}

function entry(
  block: PlanBlock,
  actual: number,
  status: DayBlock["status"],
): DayBlock {
  return {
    block,
    actual,
    progress: actual / block.target_count,
    status,
  };
}

const READY: CalendarResponse = {
  status: "ready",
  profile: {
    timezone: TZ,
    target_exam_date: "2026-11-07",
    target_score: 1400,
    study_days_mask: 62,
    daily_minutes: 45,
    full_length_weekday: 6,
    planner_mode: "auto",
    setup_completed_at: "2026-09-01T18:00:00Z",
  },
  bounds: {
    daily_minutes_min: 15,
    daily_minutes_max: 180,
    daily_minutes_presets: [15, 30, 45, 60, 90, 120],
    target_exam_date_max_days: 540,
  },
  estimates: {
    practice_seconds_per_unit: 90,
    review_seconds_per_unit: 120,
  },
  days: [
    {
      local_date: YESTERDAY,
      timezone: TZ,
      is_user_override: false,
      is_study_day: true,
      version_no: 7,
      status: "partial",
      blocks: [
        entry(practiceBlock(B_PRACTICE_PAST, YESTERDAY, 1, 20), 12, "partial"),
        entry(reviewBlock(B_REVIEW_PAST, YESTERDAY, 2, 10), 0, "missed"),
      ],
      extra_work: [
        {
          engine: "practice",
          section: "RW",
          domain: "Expression of Ideas",
          count: 3,
        },
      ],
      planned_count: 30,
      actual_count: 12,
      extra_count: 3,
    },
    {
      local_date: TODAY,
      timezone: TZ,
      is_user_override: false,
      is_study_day: true,
      version_no: 7,
      status: "today",
      blocks: [
        entry(practiceBlock(B_PRACTICE_TODAY, TODAY, 1, 15), 0, "scheduled"),
      ],
      extra_work: [],
      planned_count: 15,
      actual_count: 0,
      extra_count: 0,
    },
    {
      local_date: TOMORROW,
      timezone: TZ,
      is_user_override: false,
      is_study_day: true,
      version_no: 7,
      status: "upcoming",
      blocks: [entry(examBlock(B_EXAM_TOMORROW, TOMORROW, 1), 0, "scheduled")],
      extra_work: [],
      planned_count: 1,
      actual_count: 0,
      extra_count: 0,
    },
  ],
  facts: {
    blocks_total: 4,
    blocks_completed: 0,
    blocks_partial: 1,
    blocks_missed: 1,
    blocks_in_progress: 0,
    blocks_scheduled: 2,
    questions_completed: 15,
    full_lengths_completed: 0,
    extra_questions: 3,
  },
  streak: { current: 4, longest: null, history_complete: false },
  latest_unacknowledged_nonstudent_change: {
    version_no: 7,
    trigger: "weekly",
    created_at: "2026-09-15T09:00:00Z",
  },
  diagnostic_state: "baseline_ready",
  // §17.2. Production's own list on 2026-09-24 — full-length absent until it ships.
  enabled_block_types: ["practice", "review"],
};

const SETUP_REQUIRED: CalendarResponse = {
  status: "setup_required",
  defaults: {
    timezone: "America/Chicago",
    daily_minutes_presets: [15, 30, 45, 60, 90, 120],
    daily_minutes_min: 15,
    daily_minutes_max: 180,
    target_exam_date_max_days: 540,
  },
};

/** The purity harness: anything these functions touch in place throws in strict mode. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}

deepFreeze(READY);
deepFreeze(SETUP_REQUIRED);

function dayOf(response: CalendarResponse, date: string) {
  if (response.status !== "ready") throw new Error("expected a ready response");
  const day = response.days.find((entry) => entry.local_date === date);
  if (day === undefined) throw new Error(`no day ${date} in the range`);
  return day;
}

function blockIdsOn(response: CalendarResponse, date: string): string[] {
  return dayOf(response, date).blocks.map((entry) => entry.block.block_id);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("optimistic calendar transforms", () => {
  beforeEach(() => {
    resetProvisionalIds();
  });

  it("the fixture is a payload the §15 contract actually accepts", () => {
    // A prediction tested against a shape the server cannot send proves nothing.
    expect(calendarResponseSchema.safeParse(READY).success).toBe(true);
    expect(calendarResponseSchema.safeParse(SETUP_REQUIRED).success).toBe(true);
  });

  describe("applyMove (§12.2/§12.4)", () => {
    it("moves the block off the source day and onto the target, and marks BOTH days is_user_override", () => {
      const next = applyMove(READY, B_PRACTICE_PAST, TOMORROW);

      expect(blockIdsOn(next, YESTERDAY)).toEqual([B_REVIEW_PAST]);
      expect(blockIdsOn(next, TOMORROW)).toEqual([
        B_EXAM_TOMORROW,
        B_PRACTICE_PAST,
      ]);
      expect(dayOf(next, YESTERDAY).is_user_override).toBe(true);
      expect(dayOf(next, TOMORROW).is_user_override).toBe(true);
      // The untouched day keeps the server's answer.
      expect(dayOf(next, TODAY).is_user_override).toBe(false);
    });

    it("carries the block's progress with it — a moved block is the same work (§13)", () => {
      const next = applyMove(READY, B_PRACTICE_PAST, TOMORROW);
      const moved = dayOf(next, TOMORROW).blocks.find(
        (entry) => entry.block.block_id === B_PRACTICE_PAST,
      );

      expect(moved?.actual).toBe(12);
      expect(moved?.status).toBe("partial");
      expect(moved?.block.scheduled_date).toBe(TOMORROW);
    });

    it("recomputes planned_count and actual_count on BOTH days, so the header cannot contradict the blocks (§14)", () => {
      const next = applyMove(READY, B_PRACTICE_PAST, TOMORROW);

      // Source loses the 20-question block that had 12 answered.
      expect(dayOf(next, YESTERDAY).planned_count).toBe(10);
      expect(dayOf(next, YESTERDAY).actual_count).toBe(0);
      // Target gains it on top of the 1-question full length.
      expect(dayOf(next, TOMORROW).planned_count).toBe(21);
      expect(dayOf(next, TOMORROW).actual_count).toBe(12);
    });

    it("returns the response UNCHANGED when the target date is outside the loaded range", () => {
      // Inventing the day would render a day the server never sent.
      expect(applyMove(READY, B_PRACTICE_PAST, OUT_OF_RANGE)).toBe(READY);
    });

    it("returns the response UNCHANGED when source and target are the same date", () => {
      // §15's `same_date` refusal, mirrored client-side before the request is ever issued.
      expect(applyMove(READY, B_PRACTICE_PAST, YESTERDAY)).toBe(READY);
    });

    it("returns the response UNCHANGED when the block is not in the loaded range at all", () => {
      expect(applyMove(READY, "no-such-block", TOMORROW)).toBe(READY);
    });
  });

  describe("applyRemoveBlock (§12.4)", () => {
    it("drops the block, marks the day overridden and recomputes both counts", () => {
      const next = applyRemoveBlock(READY, YESTERDAY, B_PRACTICE_PAST);

      expect(blockIdsOn(next, YESTERDAY)).toEqual([B_REVIEW_PAST]);
      expect(dayOf(next, YESTERDAY).is_user_override).toBe(true);
      expect(dayOf(next, YESTERDAY).planned_count).toBe(10);
      expect(dayOf(next, YESTERDAY).actual_count).toBe(0);
    });

    it("leaves every other day exactly as it was", () => {
      const next = applyRemoveBlock(READY, YESTERDAY, B_PRACTICE_PAST);

      expect(dayOf(next, TODAY)).toEqual(dayOf(READY, TODAY));
      expect(dayOf(next, TOMORROW)).toEqual(dayOf(READY, TOMORROW));
    });
  });

  describe("applyBlockEdit (§12.4)", () => {
    it("replaces the block with a PROVISIONAL id, because the server will create a new row", () => {
      const edited = practiceBlock(B_PRACTICE_TODAY, TODAY, 1, 25);
      const next = applyBlockEdit(READY, TODAY, B_PRACTICE_TODAY, edited);

      const [replacement] = dayOf(next, TODAY).blocks;
      expect(replacement).toBeDefined();
      expect(isProvisional(replacement!.block.block_id)).toBe(true);
      // And the old id is gone — launching it would be a 404.
      expect(blockIdsOn(next, TODAY)).not.toContain(B_PRACTICE_TODAY);
    });

    it("recomputes the day counts from the EDITED target, not the old one (§14)", () => {
      const edited = practiceBlock(B_PRACTICE_TODAY, TODAY, 1, 25);
      const next = applyBlockEdit(READY, TODAY, B_PRACTICE_TODAY, edited);

      expect(dayOf(next, TODAY).planned_count).toBe(25);
      expect(dayOf(next, TODAY).actual_count).toBe(0);
      expect(dayOf(next, TODAY).is_user_override).toBe(true);
    });

    it("carries `actual` across the edit — the work already done is not undone by a mix change", () => {
      const edited = practiceBlock(B_PRACTICE_PAST, YESTERDAY, 1, 30);
      const next = applyBlockEdit(READY, YESTERDAY, B_PRACTICE_PAST, edited);

      const replacement = dayOf(next, YESTERDAY).blocks[0];
      expect(replacement?.actual).toBe(12);
      expect(dayOf(next, YESTERDAY).actual_count).toBe(12);
      expect(dayOf(next, YESTERDAY).planned_count).toBe(40);
    });

    it("mints ids monotonically, so two edits in one tick never collide as React keys", () => {
      const edited = practiceBlock(B_PRACTICE_TODAY, TODAY, 1, 25);
      const first = applyBlockEdit(READY, TODAY, B_PRACTICE_TODAY, edited);
      const second = applyBlockEdit(READY, TODAY, B_PRACTICE_TODAY, edited);

      const firstId = dayOf(first, TODAY).blocks[0]?.block.block_id;
      const secondId = dayOf(second, TODAY).blocks[0]?.block.block_id;
      expect(firstId).toBe("provisional:1");
      expect(secondId).toBe("provisional:2");
    });
  });

  describe("applyDoItNow (§12.6)", () => {
    it("appends a FRESH copy to today: no progress, scheduled, and lineage back to the source", () => {
      const next = applyDoItNow(READY, B_PRACTICE_PAST, TODAY);
      const copy = dayOf(next, TODAY).blocks[1];

      expect(copy).toBeDefined();
      expect(copy!.actual).toBe(0);
      expect(copy!.progress).toBe(0);
      expect(copy!.status).toBe("scheduled");
      expect(copy!.block.derived_from_block_id).toBe(B_PRACTICE_PAST);
      expect(copy!.block.scheduled_date).toBe(TODAY);
      expect(copy!.block.source).toBe("student");
      expect(isProvisional(copy!.block.block_id)).toBe(true);
    });

    it("leaves the SOURCE day untouched — the student did not do it, and the plan records that", () => {
      const next = applyDoItNow(READY, B_PRACTICE_PAST, TODAY);

      expect(dayOf(next, YESTERDAY)).toEqual(dayOf(READY, YESTERDAY));
      expect(findBlock(next, B_PRACTICE_PAST)?.date).toBe(YESTERDAY);
    });

    it("recomputes today's counts to include the copy's target (§14)", () => {
      const next = applyDoItNow(READY, B_PRACTICE_PAST, TODAY);

      expect(dayOf(next, TODAY).planned_count).toBe(35);
      expect(dayOf(next, TODAY).actual_count).toBe(0);
      expect(dayOf(next, TODAY).is_user_override).toBe(true);
    });

    it("returns the response UNCHANGED when today is outside the loaded range", () => {
      const pastOnly: CalendarResponse = {
        ...READY,
        status: "ready",
        days: READY.status === "ready" ? [READY.days[0]!] : [],
      };
      expect(applyDoItNow(pastOnly, B_PRACTICE_PAST, TODAY)).toBe(pastOnly);
    });
  });

  describe("applyAcknowledge (§12.7)", () => {
    it("nulls latest_unacknowledged_nonstudent_change so the banner clears on the press", () => {
      const next = applyAcknowledge(READY);

      expect(next.status).toBe("ready");
      if (next.status !== "ready") return;
      expect(next.latest_unacknowledged_nonstudent_change).toBeNull();
      // Nothing else about the payload moves.
      expect(next.days).toEqual(READY.status === "ready" ? READY.days : []);
    });
  });

  describe("the setup_required arm has nothing to be optimistic about", () => {
    it("EVERY transform returns a setup_required response untouched, by identity", () => {
      expect(applyMove(SETUP_REQUIRED, B_PRACTICE_PAST, TODAY)).toBe(
        SETUP_REQUIRED,
      );
      expect(applyRemoveBlock(SETUP_REQUIRED, TODAY, B_PRACTICE_PAST)).toBe(
        SETUP_REQUIRED,
      );
      expect(
        applyBlockEdit(
          SETUP_REQUIRED,
          TODAY,
          B_PRACTICE_PAST,
          practiceBlock(B_PRACTICE_PAST, TODAY, 1, 10),
        ),
      ).toBe(SETUP_REQUIRED);
      expect(applyDoItNow(SETUP_REQUIRED, B_PRACTICE_PAST, TODAY)).toBe(
        SETUP_REQUIRED,
      );
      expect(applyAcknowledge(SETUP_REQUIRED)).toBe(SETUP_REQUIRED);
      expect(findBlock(SETUP_REQUIRED, B_PRACTICE_PAST)).toBeNull();
    });
  });

  describe("purity — the cached object is also the rollback snapshot", () => {
    it("no transform mutates a DEEP-FROZEN input", () => {
      // Every property of the fixture is frozen; in strict mode an in-place write throws.
      expect(Object.isFrozen(READY)).toBe(true);
      expect(() => applyMove(READY, B_PRACTICE_PAST, TOMORROW)).not.toThrow();
      expect(() =>
        applyRemoveBlock(READY, YESTERDAY, B_PRACTICE_PAST),
      ).not.toThrow();
      expect(() =>
        applyBlockEdit(
          READY,
          TODAY,
          B_PRACTICE_TODAY,
          practiceBlock(B_PRACTICE_TODAY, TODAY, 1, 25),
        ),
      ).not.toThrow();
      expect(() => applyDoItNow(READY, B_PRACTICE_PAST, TODAY)).not.toThrow();
      expect(() => applyAcknowledge(READY)).not.toThrow();
    });

    it("the original response still reads exactly as it did after every transform ran", () => {
      applyMove(READY, B_PRACTICE_PAST, TOMORROW);
      applyRemoveBlock(READY, YESTERDAY, B_PRACTICE_PAST);
      applyDoItNow(READY, B_PRACTICE_PAST, TODAY);
      applyAcknowledge(READY);

      expect(blockIdsOn(READY, YESTERDAY)).toEqual([
        B_PRACTICE_PAST,
        B_REVIEW_PAST,
      ]);
      expect(dayOf(READY, YESTERDAY).planned_count).toBe(30);
      expect(dayOf(READY, TODAY).blocks).toHaveLength(1);
    });
  });
});
