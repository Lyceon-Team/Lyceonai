/**
 * Derived read model — days, day status, and the facts strip.
 *
 * @spec [Doc_05F §13, §14 (derived state), §17.1 item 5 (facts strip), §22.3 (counter),
 *        §22.4 (midnight), R-08-28; owner rulings B4 and B5, 2026-09-17]
 * | @implemented [2026-09-17]
 *
 * plain English: takes the plan rows for a range of days and the engines' activity for the
 * same range, runs the §13 allocator once per day, and produces what the calendar screen
 * renders: each day with its blocks, its extra work and its status, plus the facts strip for
 * the range. Everything is derived and nothing is stored (§6).
 *
 * expected outcome: §22.3 reproduced exactly — ALG 20 and CS 10 planned, 12 + 10 Algebra and
 * 15 Expression of Ideas answered, gives `20/20` complete, `0/10` missed, 37 questions and
 * 17 extra.
 *
 * trade-offs: the day payload carries counts, not unit ids. `allocateDay` returns the ids
 * because the conservation property is stated in terms of them; no client surface in §14
 * renders one, so they stop here rather than riding a spread into a response.
 *
 * edge cases: day status is an ORDERED first match, and `partial` sits above `missed` on
 * purpose (owner ruling B5) — a student who answered 12 of 20 yesterday did not miss the
 * day. A rest day with activity stays `rest` (owner ruling B4); the day's extra-work list is
 * what carries that activity, because studying on an off day does not turn it into a planned
 * one.
 */
import { z } from "zod";
import {
  allocateDay,
  blockLaunchStateSchema,
  blockStatusSchema,
  extraWorkGroupSchema,
  activityUnitSchema,
  type ActivityUnit,
} from "./allocate.js";
import {
  guardianPlanBlockSchema,
  planBlockSchema,
  toGuardianPlanBlock,
} from "./plan.js";
import { localDateSchema } from "./time.js";

// ── Inputs ──────────────────────────────────────────────────────────────────

/**
 * One date of the current plan. `timezone` is the plan date's OWN zone (§8.2) — it is
 * carried through to the payload so the UI labels the day in the zone it was planned in, and
 * it is never re-derived from the profile here. `is_study_day` is the study-days mask that
 * was in force on this date, resolved by the caller from the owning version's snapshot.
 */
export const calendarDayInputSchema = z
  .object({
    local_date: localDateSchema,
    timezone: z.string().min(1),
    is_user_override: z.boolean(),
    is_study_day: z.boolean(),
    version_no: z.number().int().positive().nullable(),
    blocks: z.array(planBlockSchema),
  })
  .strict();
export type CalendarDayInput = z.infer<typeof calendarDayInputSchema>;

/**
 * The whole range in one call. Units are bucketed by their own `local_date`, which is how
 * §22.4's midnight split lands: one session's items become activity on two different days
 * because the adapter dated each item by `answered_at` in that day's zone.
 *
 * A unit whose `local_date` is not one of `days` belongs to a date outside the requested
 * range and is ignored — counting it would put activity from outside the window into the
 * window's facts.
 */
export const calendarRangeInputSchema = z
  .object({
    today: localDateSchema,
    days: z.array(calendarDayInputSchema),
    units: z.array(activityUnitSchema),
    launches: z.array(blockLaunchStateSchema),
  })
  .strict();
export type CalendarRangeInput = z.infer<typeof calendarRangeInputSchema>;

// ── Outputs ─────────────────────────────────────────────────────────────────

/**
 * §14, in the precedence owner ruling B4 fixed. The order IS the rule: every later entry is
 * only reached because no earlier one matched.
 */
export const DAY_STATUSES = [
  "rest",
  "complete",
  "partial",
  "missed",
  "today",
  "upcoming",
] as const;
export const dayStatusSchema = z.enum(DAY_STATUSES);
export type DayStatus = z.infer<typeof dayStatusSchema>;

/** A block on a day, with what the student actually did against it. */
export const dayBlockSchema = z
  .object({
    block: planBlockSchema,
    actual: z.number().int().min(0),
    /** §13 `progress(b) = actual / target`. A ratio, never a percentage string. */
    progress: z.number().min(0).max(1),
    status: blockStatusSchema,
  })
  .strict();
export type DayBlock = z.infer<typeof dayBlockSchema>;

/** §14 `day.extra_work[]` — `{engine, section?, domain?, count}`, no ids. */
export const dayExtraWorkSchema = extraWorkGroupSchema.omit({ unit_ids: true });
export type DayExtraWork = z.infer<typeof dayExtraWorkSchema>;

export const calendarDaySchema = z
  .object({
    local_date: localDateSchema,
    timezone: z.string().min(1),
    is_user_override: z.boolean(),
    is_study_day: z.boolean(),
    version_no: z.number().int().positive().nullable(),
    status: dayStatusSchema,
    blocks: z.array(dayBlockSchema),
    extra_work: z.array(dayExtraWorkSchema),
    /** Sum of block targets — what the day asked for. */
    planned_count: z.number().int().min(0),
    /** Sum of block actuals — what the day got, allocated. */
    actual_count: z.number().int().min(0),
    /** Units on this day that no block claimed. */
    extra_count: z.number().int().min(0),
  })
  .strict();
export type CalendarDay = z.infer<typeof calendarDaySchema>;

/**
 * §14 facts, R-08-28: counts only, never a percentage and never a rate. The same facts are
 * served to a guardian, which is the other reason there is no derived judgement in here.
 *
 * `questions_completed` counts EVERY practice and review unit in the range, allocated or
 * not, and `extra_questions` counts the unallocated subset — §22.3 is the worked example:
 * 12 + 10 Algebra and 15 Expression of Ideas against a 20-question block give 37 questions
 * and 17 extra. `full_lengths_completed` counts exam units the same way: an exam the student
 * sat is an exam they sat, planned or not.
 */
export const calendarFactsSchema = z
  .object({
    blocks_total: z.number().int().min(0),
    blocks_completed: z.number().int().min(0),
    blocks_partial: z.number().int().min(0),
    blocks_missed: z.number().int().min(0),
    blocks_in_progress: z.number().int().min(0),
    blocks_scheduled: z.number().int().min(0),
    questions_completed: z.number().int().min(0),
    full_lengths_completed: z.number().int().min(0),
    extra_questions: z.number().int().min(0),
  })
  .strict();
export type CalendarFacts = z.infer<typeof calendarFactsSchema>;

export const calendarRangeSchema = z
  .object({
    days: z.array(calendarDaySchema),
    facts: calendarFactsSchema,
  })
  .strict();
export type CalendarRange = z.infer<typeof calendarRangeSchema>;

// ── Day status (owner rulings B4 and B5) ────────────────────────────────────

export function dayStatusOf(input: {
  local_date: string;
  today: string;
  is_study_day: boolean;
  blocks: readonly { actual: number; target: number }[];
}): DayStatus {
  const hasBlocks = input.blocks.length > 0;

  // 1. rest — not a study day and nothing planned. Activity does not change this: the
  //    extra-work list carries it (B4).
  if (!input.is_study_day && !hasBlocks) return "rest";

  // 2. complete — every block satisfied.
  if (hasBlocks && input.blocks.every((block) => block.actual >= block.target)) {
    return "complete";
  }

  // 3. partial — any progress at all, past or present (B5: never `missed`).
  if (hasBlocks && input.blocks.some((block) => block.actual > 0)) return "partial";

  // 4. missed — a past day that asked for work and got none.
  if (input.local_date < input.today && hasBlocks) return "missed";

  // 5. today — reached only with no progress yet, which is what B4 says.
  if (input.local_date === input.today) return "today";

  // 6. upcoming.
  if (input.local_date > input.today) return "upcoming";

  // Totality. A past study day that owns no blocks — a cleared day — matches none of the
  // six: there was nothing to miss. `rest` is the honest label, and this branch is the only
  // way to reach it with `is_study_day` true.
  return "rest";
}

// ── Building ────────────────────────────────────────────────────────────────

function bucketUnitsByDate(units: readonly ActivityUnit[]): Map<string, ActivityUnit[]> {
  const buckets = new Map<string, ActivityUnit[]>();
  for (const unit of units) {
    const bucket = buckets.get(unit.local_date);
    if (bucket === undefined) {
      buckets.set(unit.local_date, [unit]);
      continue;
    }
    bucket.push(unit);
  }
  return buckets;
}

/**
 * Build the whole range: one `allocateDay` per day, then the facts over all of them.
 *
 * Pure and total. Days come back in the order they were given, which is the order the route
 * read them in (`from` … `to`).
 */
export function buildCalendarRange(input: CalendarRangeInput): CalendarRange {
  const buckets = bucketUnitsByDate(input.units);

  const days: CalendarDay[] = input.days.map((day) => {
    const allocation = allocateDay({
      local_date: day.local_date,
      today: input.today,
      blocks: day.blocks,
      units: buckets.get(day.local_date) ?? [],
      launches: input.launches,
    });

    const blocksById = new Map(day.blocks.map((block) => [block.block_id, block]));
    const blocks: DayBlock[] = [];
    for (const allocated of allocation.blocks) {
      const block = blocksById.get(allocated.block_id);
      if (block === undefined) continue;
      blocks.push({
        block,
        actual: allocated.actual,
        progress: allocated.actual / allocated.target,
        status: allocated.status,
      });
    }

    const plannedCount = blocks.reduce((sum, entry) => sum + entry.block.target_count, 0);
    const actualCount = blocks.reduce((sum, entry) => sum + entry.actual, 0);
    const extraCount = allocation.extra_work.reduce((sum, group) => sum + group.count, 0);

    return {
      local_date: day.local_date,
      timezone: day.timezone,
      is_user_override: day.is_user_override,
      is_study_day: day.is_study_day,
      version_no: day.version_no,
      status: dayStatusOf({
        local_date: day.local_date,
        today: input.today,
        is_study_day: day.is_study_day,
        blocks: blocks.map((entry) => ({
          actual: entry.actual,
          target: entry.block.target_count,
        })),
      }),
      blocks,
      extra_work: allocation.extra_work.map((group) => ({
        engine: group.engine,
        section: group.section,
        domain: group.domain,
        count: group.count,
      })),
      planned_count: plannedCount,
      actual_count: actualCount,
      extra_count: extraCount,
    };
  });

  return { days, facts: factsOf(days) };
}

/**
 * Derived from the DAYS, never from the raw unit list: `allocateDay` has already collapsed
 * duplicate `(engine, unit_id)` identities, so counting through its output is the only way
 * the facts agree with the blocks above them.
 */
function factsOf(days: readonly CalendarDay[]): CalendarFacts {
  const facts = {
    blocks_total: 0,
    blocks_completed: 0,
    blocks_partial: 0,
    blocks_missed: 0,
    blocks_in_progress: 0,
    blocks_scheduled: 0,
    questions_completed: 0,
    full_lengths_completed: 0,
    extra_questions: 0,
  };

  for (const day of days) {
    for (const entry of day.blocks) {
      facts.blocks_total += 1;
      if (entry.status === "completed") facts.blocks_completed += 1;
      else if (entry.status === "partial") facts.blocks_partial += 1;
      else if (entry.status === "missed") facts.blocks_missed += 1;
      else if (entry.status === "in_progress") facts.blocks_in_progress += 1;
      else facts.blocks_scheduled += 1;

      if (entry.block.block_type === "full_length") {
        facts.full_lengths_completed += entry.actual;
      } else {
        facts.questions_completed += entry.actual;
      }
    }

    for (const group of day.extra_work) {
      if (group.engine === "full_length") {
        facts.full_lengths_completed += group.count;
        continue;
      }
      facts.questions_completed += group.count;
      facts.extra_questions += group.count;
    }
  }

  return facts;
}

// ── The guardian projection (§16, R-08-22) ──────────────────────────────────

export const guardianDayBlockSchema = z
  .object({
    block: guardianPlanBlockSchema,
    actual: z.number().int().min(0),
    progress: z.number().min(0).max(1),
    status: blockStatusSchema,
  })
  .strict();
export type GuardianDayBlock = z.infer<typeof guardianDayBlockSchema>;

/**
 * A day as a guardian may see it: the same facts, none of the plan machinery.
 * `version_no` and `is_user_override` are absent — which version owns a date and whether the
 * student overrode it are controls, and §16 gives a guardian none.
 */
export const guardianCalendarDaySchema = z
  .object({
    local_date: localDateSchema,
    timezone: z.string().min(1),
    is_study_day: z.boolean(),
    status: dayStatusSchema,
    blocks: z.array(guardianDayBlockSchema),
    extra_work: z.array(dayExtraWorkSchema),
    planned_count: z.number().int().min(0),
    actual_count: z.number().int().min(0),
    extra_count: z.number().int().min(0),
  })
  .strict();
export type GuardianCalendarDay = z.infer<typeof guardianCalendarDaySchema>;

/**
 * The one place a student day becomes a guardian day. Every field is named, so adding a
 * field to `CalendarDay` does not silently extend the guardian payload — the chokepoint rule
 * from CLAUDE.md, applied to the guardian boundary.
 */
export function toGuardianCalendarDay(day: CalendarDay): GuardianCalendarDay {
  return {
    local_date: day.local_date,
    timezone: day.timezone,
    is_study_day: day.is_study_day,
    status: day.status,
    blocks: day.blocks.map((entry) => ({
      block: toGuardianPlanBlock(entry.block),
      actual: entry.actual,
      progress: entry.progress,
      status: entry.status,
    })),
    extra_work: day.extra_work.map((group) => ({
      engine: group.engine,
      section: group.section,
      domain: group.domain,
      count: group.count,
    })),
    planned_count: day.planned_count,
    actual_count: day.actual_count,
    extra_count: day.extra_count,
  };
}
