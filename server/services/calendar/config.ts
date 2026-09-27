/**
 * The one reader of `calendar_runtime_config` for the server layer.
 *
 * @spec [Doc-05F_V1.0 §8.1 (setup bounds), §12.5 (weekly job interval), §15
 *        (default range), §18 "Missing config | Loud failure at accessor";
 *        lyceon-coding-standards §7.1, §7.3, §13]
 * | @implemented [2026-09-21]
 *
 * plain English: the calendar's routes and its weekly job need seven numbers, and every
 * one of them lives in the database so an operator can change it without a deploy. This
 * reads them, parses them, and refuses to invent one.
 *
 * WHY THERE IS NO FALLBACK. §18 is explicit: a missing config is a LOUD failure at the
 * accessor. A default here would be a second source of truth for a value the database
 * owns, and the failure it hides — an unseeded environment — is exactly the failure an
 * operator needs to see. A missing or malformed key therefore throws
 * `CalendarConfigError` after an ERROR log, which the route turns into a 500 with a
 * correlation id. That is deliberately NOT the 402/403 path: an unseeded config is an
 * operational fault, not a decision about this student.
 *
 * expected outcome: changing `daily_minutes_presets` in the database changes what a
 * profile upsert accepts on the next request, with no deploy and no cache to wait out.
 *
 * trade-offs: no cache, following `entitlement-runtime-config.ts`. GET `/api/calendar`
 * pays one extra round trip per request. Inventing a TTL would be an unreviewed constant,
 * and the alternative — a process-lifetime cache — would make an operator's change take
 * effect at a time nobody can predict. When this shows up in a latency budget it should
 * become a config-owned TTL, not a hard-coded one.
 *
 * edge cases: `daily_minutes_presets` is an array of integers; the rest are integers. A
 * row whose `value` is a JSON string rather than a number is malformed and throws — it is
 * not coerced, because a silently coerced bound is a bound nobody reviewed.
 */
import { z } from "zod";
import {
  calendarBlockTypeSchema,
  studyProfileBoundsSchema,
  type CalendarBlockType,
  type StudyProfileBounds,
} from "@lyceon/shared";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";

/**
 * The keys this layer reads. Every one is asserted present by
 * `scripts/ci/calendar-schema-gates.sql` C-01, so an unseeded key is a red gate before it
 * is a 500.
 */
export const CALENDAR_CONFIG_KEYS = [
  "daily_minutes_min",
  "daily_minutes_max",
  "daily_minutes_presets",
  "target_exam_date_max_days",
  "weekly_job_interval_minutes",
  "horizon_days",
  "generator_version",
  /**
   * §9.3 / §21, SCL-08-F. Seconds to budget per review item — CALENDAR-OWNED, which is why
   * it is in this table and its practice counterpart is not. Read here so §17.1's "~N min"
   * readout comes from the same row `calendar_build_plan_input` snapshots into
   * `engine_planning.review_seconds_per_unit`, rather than from a literal in the client.
   */
  "review_estimated_seconds_per_item",
  /**
   * §17.2's engine picker. Which block types the planner may PLAN — not which engines are
   * built (`isLaunchableBlockType` answers that, and the two are deliberately separate).
   * Read here so "+ Add block" offers exactly what the validator's V-03 will accept:
   * offering full-length before it ships would be a choice the server refuses.
   */
  "enabled_block_types",
] as const;
export type CalendarConfigKey = (typeof CALENDAR_CONFIG_KEYS)[number];

/**
 * Thrown, not returned. §13: an expected failure gets a `Result`; a configuration that
 * was never made is an unexpected failure and must reach the error handler intact.
 */
export class CalendarConfigError extends Error {
  readonly key: string;
  /**
   * `table` defaults to `calendar_runtime_config` because almost every key lives there. It
   * is a parameter because `target_seconds_per_question` does NOT (Doc 02B §41 owns it), and
   * an error that named the wrong table would send an operator to the wrong row.
   */
  constructor(key: string, detail: string, table = "calendar_runtime_config") {
    super(`${table}: ${key} ${detail}`);
    this.name = "CalendarConfigError";
    this.key = key;
  }
}

const integerValueSchema = z.number().int();
const integerArrayValueSchema = z.array(z.number().int());
const stringValueSchema = z.string().min(1);

/** The two constants §17.1's time readout needs. Both are seconds, both are server-owned. */
export type PlanningEstimates = {
  practice_seconds_per_unit: number;
  review_seconds_per_unit: number;
};

export type CalendarConfig = {
  /** §8.1 bounds, in the exact shape `makeStudyProfileUpsertSchema` takes. */
  bounds: StudyProfileBounds;
  /** §15: GET `/api/calendar` defaults to today … today + `horizon_days` − 1. */
  horizonDays: number;
  /** §12.5: how often the weekly job wakes. The job's own cadence, not its rule. */
  weeklyJobIntervalMinutes: number;
  /**
   * §10.2 `PlanOutput.generator_version`, passed to every persist RPC. It names the
   * migration whose function bodies produce the plan, so a stored version row can be
   * traced to the exact SQL that made it. Seeded BY that migration — a migration that
   * changes a generator body updates this row in the same file.
   */
  generatorVersion: string;
  /**
   * §17.1 renders "Algebra · 20 questions · ~30 min". The client cannot compute those
   * minutes: the two seconds-per-unit values live server-side, one in this table and one in
   * `practice_runtime_config` (Doc 02B §41 owns practice timing and the calendar references
   * it, never restates it — §20's audit rule). They are served so the estimate the student
   * reads and the budget the generator planned against are the SAME numbers.
   */
  estimates: PlanningEstimates;
  /** §17.2 / V-03. The block types the planner may plan, straight from the table. */
  enabledBlockTypes: readonly CalendarBlockType[];
};

function requireValue(
  rows: Map<string, unknown>,
  key: CalendarConfigKey,
): unknown {
  if (!rows.has(key)) {
    logger.error(
      "CALENDAR_CONFIG",
      "key_missing",
      "a calendar_runtime_config key this build requires is not seeded",
      { key },
    );
    throw new CalendarConfigError(key, "is not seeded");
  }
  return rows.get(key);
}

function requireInteger(
  rows: Map<string, unknown>,
  key: CalendarConfigKey,
): number {
  const parsed = integerValueSchema.safeParse(requireValue(rows, key));
  if (!parsed.success) {
    logger.error(
      "CALENDAR_CONFIG",
      "key_malformed",
      "a calendar_runtime_config key is not the integer this build expects",
      { key },
    );
    throw new CalendarConfigError(key, "is not an integer");
  }
  return parsed.data;
}

/**
 * Every key in one read. The set is fixed and small, so one `IN` beats seven round trips,
 * and a partial result is caught by `requireValue` key by key rather than by counting rows
 * — the count would say "something is missing" and this says which.
 */
export async function loadCalendarConfig(): Promise<CalendarConfig> {
  const { data, error } = await supabaseServer
    .from("calendar_runtime_config")
    .select("key, value")
    .in("key", [...CALENDAR_CONFIG_KEYS]);

  if (error) {
    logger.error(
      "CALENDAR_CONFIG",
      "read_failed",
      "calendar_runtime_config could not be read; the calendar cannot answer without it",
      classifyError(error),
    );
    throw new CalendarConfigError("*", `read failed: ${error.message}`);
  }

  const rows = new Map<string, unknown>();
  for (const row of data ?? []) {
    if (typeof row.key === "string") rows.set(row.key, row.value);
  }

  const presets = integerArrayValueSchema.safeParse(
    requireValue(rows, "daily_minutes_presets"),
  );
  if (!presets.success) {
    logger.error(
      "CALENDAR_CONFIG",
      "key_malformed",
      "daily_minutes_presets is not an array of integers",
      { key: "daily_minutes_presets" },
    );
    throw new CalendarConfigError(
      "daily_minutes_presets",
      "is not an array of integers",
    );
  }

  const generatorVersion = stringValueSchema.safeParse(
    requireValue(rows, "generator_version"),
  );
  if (!generatorVersion.success) {
    logger.error(
      "CALENDAR_CONFIG",
      "key_malformed",
      "generator_version is not a non-empty string",
      { key: "generator_version" },
    );
    throw new CalendarConfigError(
      "generator_version",
      "is not a non-empty string",
    );
  }

  // The bounds go through the SHARED schema, not a local object literal: it is the same
  // parse the upsert factory relies on, so a min above max or a preset outside the range
  // is caught here, at the accessor, rather than becoming a confusing 400 for a student.
  const bounds = studyProfileBoundsSchema.safeParse({
    daily_minutes_min: requireInteger(rows, "daily_minutes_min"),
    daily_minutes_max: requireInteger(rows, "daily_minutes_max"),
    daily_minutes_presets: presets.data,
    target_exam_date_max_days: requireInteger(
      rows,
      "target_exam_date_max_days",
    ),
  });
  if (!bounds.success) {
    logger.error(
      "CALENDAR_CONFIG",
      "bounds_inconsistent",
      "the seeded §8.1 bounds do not form a usable set",
      { issues: bounds.error.issues.map((issue) => issue.path.join(".")) },
    );
    throw new CalendarConfigError(
      "daily_minutes_*",
      "do not form a usable set",
    );
  }

  // §17.2 / V-03. Parsed with the CANONICAL block-type enum rather than a local array, so
  // a type the picker offers is a type `calendar_validate_plan` recognises. Malformed is a
  // throw like every other key here: an empty picker and a picker full of refusals are both
  // worse than a loud failure at the accessor (§18).
  const enabledBlockTypes = z
    .array(calendarBlockTypeSchema)
    .min(1)
    .safeParse(requireValue(rows, "enabled_block_types"));
  if (!enabledBlockTypes.success) {
    logger.error(
      "CALENDAR_CONFIG",
      "key_malformed",
      "enabled_block_types is not a non-empty array of calendar block types",
      { key: "enabled_block_types" },
    );
    throw new CalendarConfigError(
      "enabled_block_types",
      "is not a non-empty array of calendar block types",
    );
  }

  // Doc 02B §41 owns practice timing, so the practice half of the estimate is read from
  // ITS table — the same row `calendar_build_plan_input` reads. Copying the value into
  // `calendar_runtime_config` would be a second copy of someone else's constant, and the
  // two would drift the first time Doc 02B changed it.
  const practiceSeconds = await loadPracticeSecondsPerQuestion();

  return {
    bounds: bounds.data,
    horizonDays: requireInteger(rows, "horizon_days"),
    weeklyJobIntervalMinutes: requireInteger(
      rows,
      "weekly_job_interval_minutes",
    ),
    generatorVersion: generatorVersion.data,
    estimates: {
      practice_seconds_per_unit: practiceSeconds,
      review_seconds_per_unit: requireInteger(
        rows,
        "review_estimated_seconds_per_item",
      ),
    },
    enabledBlockTypes: enabledBlockTypes.data,
  };
}

/**
 * §18 "Missing config | Loud failure at accessor". An unseeded or malformed key throws here
 * rather than defaulting: a silent default would put a plausible but WRONG minute figure in
 * front of every student, and a wrong number nobody can see is worse than a 500 somebody can.
 */
async function loadPracticeSecondsPerQuestion(): Promise<number> {
  // Same `.select(...).in(...)` shape as the calendar config read above, deliberately: one
  // query style for both tables, and no reliance on `.maybeSingle()`, whose absent-row
  // behaviour differs between the real client and the test doubles.
  const { data, error } = await supabaseServer
    .from("practice_runtime_config")
    .select("key, value")
    .in("key", ["target_seconds_per_question"]);

  if (error) {
    logger.error(
      "CALENDAR_CONFIG",
      "read_failed",
      "practice_runtime_config could not be read for the planning estimate",
      classifyError(error),
    );
    throw new CalendarConfigError(
      "target_seconds_per_question",
      `read failed: ${error.message}`,
    );
  }

  // Narrowed rather than trusted: this is a boundary, and `data` is whatever the client
  // handed back. A non-array here is a malformed read, not a crash site.
  const rows = Array.isArray(data) ? data : [];
  const row = rows.find(
    (candidate: { key?: unknown; value?: unknown }) =>
      candidate.key === "target_seconds_per_question",
  );
  const parsed = integerValueSchema.safeParse(row?.value);
  if (!parsed.success || parsed.data <= 0) {
    logger.error(
      "CALENDAR_CONFIG",
      "key_malformed",
      "practice_runtime_config.target_seconds_per_question is missing or not a positive integer",
      { key: "target_seconds_per_question" },
    );
    throw new CalendarConfigError(
      "target_seconds_per_question",
      "is not a positive integer",
    );
  }
  return parsed.data;
}
