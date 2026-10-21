/**
 * "Will this calendar action notify the student's guardian?" — the one predicate.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A: "The 'will this notify?' check
 *        is one shared predicate in packages/shared. A parity test enumerates every calendar
 *        action: each one the SQL recording captures shows the dialog, each one it ignores
 *        doesn't."; SCL-238 (Doc 05F §17.2 / §17.7, the confirmation before a recorded write);
 *        SCL-230 (what a guardian is told about schedule changes); the recording itself:
 *        `calendar_write_version` + `accountability_record_plan_change` and
 *        `accountability_record_profile_change`, supabase/migrations/
 *        20261101000000_guardian_accountability.sql §4, §4a, §5] | @implemented [2026-10-21]
 *
 * plain English: a pure restatement of what the SQL recording captures, so the calendar can ask
 * BEFORE a write whether that write will reach the guardian. Every student calendar action is
 * named in `CALENDAR_ACTIONS`; `calendarActionRecorded` answers true exactly when the database
 * would emit a `study_plan_changed` event for it:
 *   - `save_schedule`: setup was already completed, and the save changes the study days, the
 *     minutes per day, or the full-length weekday / frequency (the AFTER UPDATE trigger on
 *     `student_study_profile`). SAT dates, the target score, the timezone and the planner mode
 *     are never recorded; neither is the first setup.
 *   - `edit_day` (clear a day, remove a block, change a block's count, add a block): the day's
 *     planned practice + review minutes go DOWN (each block counts `max(1, round(target × secs /
 *     60))`, `accountability_day_minutes`), or the day had a full-length test and has none after.
 *     A started block is kept by the server whatever the list says (V-12), so it is kept here.
 *   - `move_block`: the origin day loses the block, so a practice or review block always lowers
 *     that day's minutes (every block is at least one minute) and a full-length is
 *     `full_length_moved`.
 *   - everything else (Regenerate, Regenerate day, Reset day / undo a day off, Do it now,
 *     Start / Resume, acknowledging a plan update): never recorded — they write no student
 *     `day_edit` version, or no version at all.
 *
 * `willNotifyGuardian` adds the recipient half: the server's `guardian_notified` (some guardian
 * passes `guardian_view_decision` right now: active link AND student entitlement) — never a
 * client-held role or link list.
 *
 * trade-offs: the predicate restates SQL rather than asking the database, because the question
 * is asked before the write and must not cost a round trip. The restatement is held to the SQL
 * by `tests/ci/guardian-notify.parity.pg.ci.test.ts`, which performs every action against real
 * Postgres and compares. The minute figures use the estimates the calendar read serves (§15),
 * the same constants the version is planned against.
 *
 * edge cases: a day edit that swaps one block for a shorter one lowers the minutes and is
 * recorded; one that swaps for a longer one is not. Editing a full-length's form or timing keeps
 * a full-length on the day and is not recorded. A save with no profile yet (first setup) is not
 * recorded.
 */
import type { PlanningEstimates } from "./api.js";
import type { PlanBlock, PlanMember } from "./plan.js";
import type { StudyProfile } from "./profile.js";

/** Every student calendar action, by the route it writes through. */
export const CALENDAR_ACTIONS = [
  "save_schedule", // PUT /api/calendar/profile
  "edit_day", // PUT /api/calendar/days/:date (block out, remove, edit a count, add)
  "move_block", // POST /api/calendar/blocks/:id/move (sheet "Move to…" or drag)
  "regenerate_plan", // POST /api/calendar/plan/regenerate
  "regenerate_day", // POST /api/calendar/days/:date/regenerate
  "reset_day", // POST /api/calendar/days/:date/reset (also "undo a day off")
  "do_it_now", // POST /api/calendar/blocks/:id/do-it-now
  "launch_block", // POST /api/calendar/blocks/:id/launch (Start / Resume)
  "acknowledge", // POST /api/calendar/acknowledge
] as const;
export type CalendarActionKind = (typeof CALENDAR_ACTIONS)[number];

/** The four schedule fields the profile trigger compares (SCL-230). */
export type ScheduleFields = Pick<
  StudyProfile,
  | "study_days_mask"
  | "daily_minutes"
  | "full_length_weekday"
  | "full_length_interval_weeks"
>;

/** A block as it stands on the day before the edit. `started` blocks are kept (V-12). */
export type DayBlockBefore = {
  block_id: string;
  block_type: PlanBlock["block_type"];
  target_count: number;
  started: boolean;
};

export type CalendarAction =
  | {
      kind: "save_schedule";
      /** The stored profile, or null before the first save. */
      before:
        | (Pick<StudyProfile, "setup_completed_at"> & ScheduleFields)
        | null;
      /** The fields the save sends; an absent field is left unchanged by the route. */
      after: Partial<ScheduleFields>;
    }
  | {
      kind: "edit_day";
      before: readonly DayBlockBefore[];
      after: readonly PlanMember[];
      estimates: PlanningEstimates;
    }
  | { kind: "move_block" }
  | {
      kind: Exclude<
        CalendarActionKind,
        "save_schedule" | "edit_day" | "move_block"
      >;
    };

type MinuteBlock = {
  block_type: PlanBlock["block_type"];
  target_count: number;
};

/** `accountability_day_minutes`: practice + review blocks, each at least one minute. */
export function plannedDayMinutes(
  blocks: readonly MinuteBlock[],
  estimates: PlanningEstimates,
): number {
  let total = 0;
  for (const b of blocks) {
    if (b.block_type === "full_length") continue;
    const secs =
      b.block_type === "review"
        ? estimates.review_seconds_per_unit
        : estimates.practice_seconds_per_unit;
    total += Math.max(1, Math.round((b.target_count * secs) / 60));
  }
  return total;
}

/** The day after the edit, as the server will hold it (started blocks re-carried, V-12). */
function dayAfter(
  before: readonly DayBlockBefore[],
  after: readonly PlanMember[],
): MinuteBlock[] {
  const byId = new Map(before.map((b) => [b.block_id, b]));
  const carriedIds = new Set<string>();
  const blocks: MinuteBlock[] = [];
  for (const m of after) {
    if (m.kind === "carried") {
      const b = byId.get(m.block_id);
      if (b === undefined) continue;
      carriedIds.add(b.block_id);
      blocks.push(b);
    } else {
      blocks.push({
        block_type: m.block.block_type,
        target_count: m.block.target_count,
      });
    }
  }
  for (const b of before) {
    if (b.started && !carriedIds.has(b.block_id)) blocks.push(b);
  }
  return blocks;
}

function scheduleChanged(
  before: ScheduleFields,
  after: Partial<ScheduleFields>,
): boolean {
  const keys: readonly (keyof ScheduleFields)[] = [
    "study_days_mask",
    "daily_minutes",
    "full_length_weekday",
    "full_length_interval_weeks",
  ];
  return keys.some((k) => after[k] !== undefined && after[k] !== before[k]);
}

/** True exactly when the database records this action as a `study_plan_changed` event. */
export function calendarActionRecorded(action: CalendarAction): boolean {
  switch (action.kind) {
    case "save_schedule":
      return (
        action.before !== null &&
        action.before.setup_completed_at !== null &&
        scheduleChanged(action.before, action.after)
      );
    case "edit_day": {
      const after = dayAfter(action.before, action.after);
      if (
        plannedDayMinutes(after, action.estimates) <
        plannedDayMinutes(action.before, action.estimates)
      )
        return true;
      const hadFullLength = action.before.some(
        (b) => b.block_type === "full_length",
      );
      const hasFullLength = after.some((b) => b.block_type === "full_length");
      return hadFullLength && !hasFullLength;
    }
    case "move_block":
      return true;
    default:
      return false;
  }
}

/**
 * The calendar's question before a write: does the server record it AND is there a guardian
 * it reaches? `guardianNotified` is the server's answer (`guardian_notified` on
 * `GET /api/students/:id/links`), never a client-held role.
 */
export function willNotifyGuardian(
  action: CalendarAction,
  guardianNotified: boolean,
): boolean {
  return guardianNotified && calendarActionRecorded(action);
}
