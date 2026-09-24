/**
 * CalendarReadService — GET `/api/calendar` and the guardian projection of it.
 *
 * @spec [Doc-05F_V1.0 §7.6 `calendar_current_plan`, §8.2 (local dates), §12.7
 *        (acknowledgement), §13 (allocator), §14 (derived state), §15 (API),
 *        §16 (guardian read), §17.3 (timezone mismatch), R-08-04 (first open);
 *        Doc_05F_formula_sheet.md §8 items 14, 18, 19;
 *        lyceon-coding-standards §8.1, §11.2]
 * | @implemented [2026-09-21]
 *
 * plain English: reads the student's current plan for a range of dates, asks each engine
 * what the student actually did on those dates, runs the shared allocator over both, and
 * returns the screen. Nothing here decides what SHOULD be planned — that is the
 * generator's job in PL/pgSQL — and nothing here decides what COUNTS — that is
 * `allocateDay` in `@lyceon/shared`, which the client imports too.
 *
 * R-08-04, THE FIRST-OPEN RULE. "The first plan is generated on the student's first
 * entitled calendar open after setup completes." This is that open: a student whose setup
 * is complete and who owns no accepted version gets one generated, once, with trigger
 * `setup`, before the range is read. It is idempotent by construction — the second open
 * finds a version and generates nothing — and the generation happens BEFORE the plan read
 * rather than after, so the first open returns the plan rather than an empty fortnight.
 *
 * WHY `is_study_day` COMES FROM THE VERSION SNAPSHOT. §13's read model takes the
 * study-days mask "in force on this date". A date planned in March under a Mon/Wed/Fri
 * schedule is still a Monday-Wednesday-Friday date after the student switches to weekends
 * in April, and re-deriving it from today's profile would relabel history. The mask is
 * read out of the owning version's `input_snapshot`; a date no version owns falls back to
 * the current profile, which is the only answer available for a date that was never
 * planned.
 *
 * trade-offs: five reads plus one per engine. They are issued in dependency order (plan →
 * blocks → launches) because the block ids are not known until the plan is read, and in
 * parallel where they are independent (streak, diagnostic, projection). A single RPC
 * returning the whole payload would be one round trip, and would also put the read model
 * in SQL where the client could not run the same code — §13's allocator is shared
 * deliberately.
 *
 * edge cases: a student with no profile row at all is PRE-SETUP (R-08-04), not an error —
 * the response schema requires a profile, so this returns `setup_required` and the route
 * renders §17.5's setup sheet. The guardian projection goes through
 * `toGuardianCalendarDay`, the one named-field mapping, so a field added to `CalendarDay`
 * cannot ride a spread into a guardian payload.
 */
import {
  buildCalendarRange,
  addDaysToLocalDate,
  blockLaunchStateSchema,
  calendarQuerySchema,
  engineOfBlock,
  err,
  guardianCalendarResponseSchema,
  isStudyDay,
  ok,
  planBlockSchema,
  postgresDowOfLocalDate,
  toGuardianCalendarDay,
  type ActivityUnit,
  type BlockLaunchState,
  type CalendarDayInput,
  type CalendarEngine,
  type CalendarReadyResponse,
  type CalendarResponse,
  type CalendarSetupDefaults,
  type GuardianCalendarResponse,
  type Result,
  type StudyProfile,
  type UnacknowledgedChange,
} from "@lyceon/shared";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { readDiagnosticState } from "../canonical-runtime-views";
import { readSectionProjections } from "../../../apps/api/src/services/projection-read";
import { getStudentActivityStreak } from "../activity-streak";
import { adapterFor } from "./adapters";
import { localTodayIn } from "./adapters/local-day";
import { loadCalendarConfig, type CalendarConfig } from "./config";
import { regeneratePlan } from "./plan-service";
import {
  FALLBACK_TIMEZONE,
  readStudyProfile,
  resolveStoredTimezone,
} from "./profile-service";

export type ReadFailure =
  | { kind: "invalid_query"; details: unknown }
  | { kind: "read_failed"; detail: string };

export type CalendarReadResult = Result<CalendarResponse, ReadFailure>;
export type GuardianReadResult = Result<GuardianCalendarResponse, ReadFailure>;

// ── The plan read ───────────────────────────────────────────────────────────

type CurrentPlanRow = {
  scheduled_date: string;
  timezone: string;
  is_user_override: boolean;
  version_no: number;
  block_id: string | null;
  display_ordinal: number | null;
  membership_type: string | null;
};

type BlockRow = {
  block_id: string;
  scheduled_date: string;
  block_type: string;
  section: string | null;
  scope: unknown;
  target_count: number;
  source: string;
  derived_from_block_id: string | null;
  explanation_key: string | null;
};

/**
 * The dates in `[from, to]`, in order. Every date in the window appears, whether or not a
 * version owns it — a date with no plan is a real day on the screen (§17.1 item 4 renders
 * fourteen chips, not "however many were planned").
 */
function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  // Bounded by the query schema's own `from <= to` refinement plus the route's clamp to
  // the horizon, so this cannot run away; the guard is belt and braces against a caller
  // that reaches the service directly.
  for (let step = 0; step < 400 && cursor <= to; step += 1) {
    dates.push(cursor);
    cursor = addDaysToLocalDate(cursor, 1);
  }
  return dates;
}

async function readCurrentPlan(
  studentId: string,
  from: string,
  to: string,
  requestId?: string,
): Promise<CurrentPlanRow[]> {
  const { data, error } = await supabaseServer
    .from("calendar_current_plan")
    .select(
      "scheduled_date, timezone, is_user_override, version_no, block_id, display_ordinal, membership_type",
    )
    .eq("student_id", studentId)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);

  if (error) {
    logger.error(
      "CALENDAR_READ",
      "current_plan_read_failed",
      "calendar_current_plan could not be read",
      { ...classifyError(error), requestId },
    );
    throw new Error(`calendar_current_plan_read_failed: ${error.message}`);
  }
  return (data ?? []) as CurrentPlanRow[];
}

async function readBlocks(
  studentId: string,
  blockIds: readonly string[],
  requestId?: string,
): Promise<Map<string, BlockRow>> {
  const blocks = new Map<string, BlockRow>();
  if (blockIds.length === 0) return blocks;

  const { data, error } = await supabaseServer
    .from("calendar_blocks")
    .select(
      "block_id, scheduled_date, block_type, section, scope, target_count, source, derived_from_block_id, explanation_key",
    )
    // student_id as well as the id list: the ids came from a view already scoped to this
    // student, and a second scope costs nothing and removes the possibility that a future
    // caller passes ids from somewhere else.
    .eq("student_id", studentId)
    .in("block_id", [...blockIds]);

  if (error) {
    logger.error(
      "CALENDAR_READ",
      "blocks_read_failed",
      "calendar_blocks could not be read",
      { ...classifyError(error), requestId },
    );
    throw new Error(`calendar_blocks_read_failed: ${error.message}`);
  }
  for (const row of (data ?? []) as BlockRow[]) blocks.set(row.block_id, row);
  return blocks;
}

/**
 * The §13 `in_progress` input: for each block, whether its most recent engine session is
 * still live. Read as one query per engine over the launch rows, then one lifecycle
 * lookup per distinct session — the adapters own "is this session live", and asking them
 * is what keeps the calendar from re-deriving a practice session's status.
 */
async function readLaunchStates(
  studentId: string,
  blockIds: readonly string[],
  requestId?: string,
): Promise<BlockLaunchState[]> {
  if (blockIds.length === 0) return [];

  const { data, error } = await supabaseServer
    .from("calendar_block_launches")
    .select("block_id, launch_sequence, engine, engine_session_id")
    .eq("student_id", studentId)
    .in("block_id", [...blockIds])
    .order("launch_sequence", { ascending: false });

  if (error) {
    // Fail OPEN. A launch row missing means a block shows as `scheduled` rather than
    // `in_progress` — a cosmetic loss — where a throw would take the whole calendar down.
    logger.error(
      "CALENDAR_READ",
      "launches_read_failed",
      "calendar_block_launches could not be read; blocks will not show as in progress",
      { ...classifyError(error), requestId },
    );
    return [];
  }

  // Highest sequence first, so the first row seen for a block is its latest launch.
  const latest = new Map<string, { engine: string; sessionId: string }>();
  for (const row of data ?? []) {
    if (
      typeof row.block_id !== "string" ||
      typeof row.engine_session_id !== "string"
    )
      continue;
    if (latest.has(row.block_id)) continue;
    latest.set(row.block_id, {
      engine: String(row.engine),
      sessionId: row.engine_session_id,
    });
  }

  const states: BlockLaunchState[] = [];
  for (const [blockId, launch] of latest) {
    const engine = launch.engine as CalendarEngine;
    const lifecycle = await adapterFor(engine).progress(launch.sessionId);
    if (lifecycle === null) continue;
    const parsed = blockLaunchStateSchema.safeParse({
      block_id: blockId,
      lifecycle,
    });
    if (parsed.success) states.push(parsed.data);
  }
  return states;
}

/**
 * The study-days mask each version had in force, keyed by `version_no`. Read from
 * `input_snapshot`, which is the frozen profile the generator planned against (§10.1).
 */
async function readMasksByVersion(
  studentId: string,
  versionNos: readonly number[],
  requestId?: string,
): Promise<Map<number, number>> {
  const masks = new Map<number, number>();
  if (versionNos.length === 0) return masks;

  const { data, error } = await supabaseServer
    .from("calendar_plan_versions")
    .select("version_no, input_snapshot")
    .eq("student_id", studentId)
    .in("version_no", [...versionNos]);

  if (error) {
    // Fail OPEN to the current profile mask, which the caller already holds. A wrong
    // rest-day label on a historical date is a smaller harm than no calendar.
    logger.warn(
      "CALENDAR_READ",
      "snapshot_mask_read_failed",
      "plan input snapshots could not be read; study days fall back to the current profile",
      { ...classifyError(error), requestId },
    );
    return masks;
  }

  for (const row of data ?? []) {
    if (typeof row.version_no !== "number") continue;
    const snapshot: unknown = row.input_snapshot;
    if (typeof snapshot !== "object" || snapshot === null) continue;
    const profile: unknown = (snapshot as { profile?: unknown }).profile;
    if (typeof profile !== "object" || profile === null) continue;
    const mask: unknown = (profile as { study_days_mask?: unknown })
      .study_days_mask;
    if (typeof mask === "number") masks.set(row.version_no, mask);
  }
  return masks;
}

/** §12.7, verbatim: highest ACCEPTED, non-student version above the watermark. */
async function readUnacknowledgedChange(
  studentId: string,
  requestId?: string,
): Promise<UnacknowledgedChange | null> {
  const { data: profileRow, error: profileError } = await supabaseServer
    .from("student_study_profile")
    .select("last_acknowledged_nonstudent_version_no")
    .eq("student_id", studentId)
    .maybeSingle();

  if (profileError || profileRow === null) return null;
  const watermark = profileRow.last_acknowledged_nonstudent_version_no;
  if (typeof watermark !== "number") return null;

  const { data, error } = await supabaseServer
    .from("calendar_plan_versions")
    .select("version_no, trigger, created_at")
    .eq("student_id", studentId)
    .eq("validator_result", "accepted")
    .neq("initiated_by", "student")
    .gt("version_no", watermark)
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.warn(
      "CALENDAR_READ",
      "unacknowledged_read_failed",
      "the plan-updated banner state could not be read; no banner is shown",
      { ...classifyError(error), requestId },
    );
    return null;
  }
  if (data === null) return null;
  if (typeof data.version_no !== "number" || typeof data.trigger !== "string")
    return null;
  if (typeof data.created_at !== "string") return null;

  return {
    version_no: data.version_no,
    // The CHECK on the column and `PLAN_TRIGGERS` are the same ten strings; a value
    // outside them is a schema divergence and shows no banner rather than a wrong one.
    trigger: data.trigger as UnacknowledgedChange["trigger"],
    created_at: data.created_at,
  };
}

// ── Assembly ────────────────────────────────────────────────────────────────

type AssembledRange = {
  profile: StudyProfile;
  today: string;
  days: CalendarDayInput[];
  units: ActivityUnit[];
  launches: BlockLaunchState[];
};

async function assembleRange(
  studentId: string,
  profile: StudyProfile,
  from: string,
  to: string,
  now: Date | undefined,
  requestId: string | undefined,
): Promise<AssembledRange> {
  const today = localTodayIn(profile.timezone, now);
  const planRows = await readCurrentPlan(studentId, from, to, requestId);

  const blockIds = planRows
    .map((row) => row.block_id)
    .filter((id): id is string => typeof id === "string");
  const versionNos = [...new Set(planRows.map((row) => row.version_no))];

  const [blocks, launches, masks] = await Promise.all([
    readBlocks(studentId, blockIds, requestId),
    readLaunchStates(studentId, blockIds, requestId),
    readMasksByVersion(studentId, versionNos, requestId),
  ]);

  // One entry per date in the window, then the plan rows fill the ones a version owns.
  const byDate = new Map<string, CalendarDayInput>();
  for (const date of datesInRange(from, to)) {
    byDate.set(date, {
      local_date: date,
      // §8.2: a date no version owns has no planned zone, so it takes the profile's.
      timezone: profile.timezone,
      is_user_override: false,
      is_study_day: isStudyDay(
        profile.study_days_mask,
        postgresDowOfLocalDate(date),
      ),
      version_no: null,
      blocks: [],
    });
  }

  for (const row of planRows) {
    const day = byDate.get(row.scheduled_date);
    if (day === undefined) continue;
    const mask = masks.get(row.version_no) ?? profile.study_days_mask;
    day.timezone = row.timezone;
    day.is_user_override = row.is_user_override;
    day.version_no = row.version_no;
    day.is_study_day = isStudyDay(
      mask,
      postgresDowOfLocalDate(row.scheduled_date),
    );

    if (row.block_id === null) continue;
    const block = blocks.get(row.block_id);
    if (
      block === undefined ||
      row.display_ordinal === null ||
      row.membership_type === null
    ) {
      continue;
    }
    const parsed = planBlockSchema.safeParse({
      block_id: block.block_id,
      scheduled_date: block.scheduled_date,
      block_type: block.block_type,
      section: block.section,
      scope: block.scope,
      target_count: block.target_count,
      source: block.source,
      derived_from_block_id: block.derived_from_block_id,
      explanation_key: block.explanation_key,
      display_ordinal: row.display_ordinal,
      membership_type: row.membership_type,
    });
    if (!parsed.success) {
      // A stored block the shared schema will not accept is a schema divergence, and
      // dropping it is better than serving a shape the client cannot parse. Loud, not
      // silent, and it names the block rather than its scope (§18 "never logged").
      logger.error(
        "CALENDAR_READ",
        "block_shape_unexpected",
        "a stored calendar block does not match the shared schema and was omitted",
        { blockId: block.block_id, blockType: block.block_type, requestId },
      );
      continue;
    }
    day.blocks.push(parsed.data);
  }

  // §13 allocates in display order. The plan rows arrive unordered from PostgREST, so the
  // order is imposed here rather than assumed — the allocator's only tiebreak is this.
  const days = [...byDate.values()];
  for (const day of days)
    day.blocks.sort((a, b) => a.display_ordinal - b.display_ordinal);

  const units = await readActivityUnits(studentId, days, requestId);
  return { profile, today, days, units, launches };
}

/**
 * Engine activity for every date in the window, asked of each engine that owns a block
 * somewhere in it. The date's OWN timezone is passed (§8.2), so a date planned in Tokyo
 * is counted in Tokyo even after the student moves.
 */
async function readActivityUnits(
  studentId: string,
  days: readonly CalendarDayInput[],
  requestId?: string,
): Promise<ActivityUnit[]> {
  const engines = new Set<CalendarEngine>();
  for (const day of days) {
    for (const block of day.blocks)
      engines.add(engineOfBlock(block.block_type));
  }
  // A window with no blocks at all still has activity to show as extra work (§14, and
  // owner ruling B4's rest day with activity), and practice is the engine that has it.
  if (engines.size === 0) engines.add("practice");

  const calls: Promise<ActivityUnit[]>[] = [];
  for (const engine of engines) {
    const adapter = adapterFor(engine);
    for (const day of days) {
      calls.push(
        adapter.activityUnits(studentId, day.local_date, day.timezone),
      );
    }
  }

  const settled = await Promise.allSettled(calls);
  const units: ActivityUnit[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      units.push(...result.value);
      continue;
    }
    // Fail OPEN, per §5A and the adapters' own posture: a day whose activity could not be
    // read shows no progress rather than taking the calendar down.
    logger.error(
      "CALENDAR_READ",
      "activity_read_failed",
      "an engine could not report activity for a date; that date shows no progress",
      { requestId },
    );
  }
  return units;
}

// ── The student read ────────────────────────────────────────────────────────

export type CalendarReadRequest = {
  student_id: string;
  query: unknown;
  request_id?: string;
  /** A parameter so a test can cross midnight without faking the process clock (§8.2). */
  now?: Date;
};

export async function readCalendar(
  request: CalendarReadRequest,
): Promise<CalendarReadResult> {
  const parsedQuery = calendarQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    return err({ kind: "invalid_query", details: parsedQuery.error.flatten() });
  }
  const query = parsedQuery.data;

  const config = await loadCalendarConfig();
  const profile = await readStudyProfile(
    request.student_id,
    request.request_id,
  );
  // R-08-04 / §17.5's pre-setup state. An empty calendar, not a missing one — so a 200
  // carrying the state, never a 404 (owner ruling on addendum item 26).
  if (profile === null) {
    return ok({
      status: "setup_required",
      defaults: await setupDefaults(
        config,
        query.device_timezone,
        request.request_id,
      ),
    });
  }

  const today = localTodayIn(profile.timezone, request.now);
  const from = query.from ?? today;
  // §15: "default today…+13" — the horizon, less the day the horizon starts on.
  const to = query.to ?? addDaysToLocalDate(from, config.horizonDays - 1);

  await generateOnFirstOpen(
    request.student_id,
    profile,
    config.generatorVersion,
    request.request_id,
  );

  const range = await assembleRange(
    request.student_id,
    profile,
    from,
    to,
    request.now,
    request.request_id,
  );
  const built = buildCalendarRange({
    today: range.today,
    days: range.days,
    units: range.units,
    launches: range.launches,
  });

  const [streak, diagnostic, change, projection] = await Promise.all([
    getStudentActivityStreak(request.student_id, request.request_id),
    readDiagnosticState(request.student_id),
    readUnacknowledgedChange(request.student_id, request.request_id),
    readProjection(request.student_id, request.request_id),
  ]);

  return ok({
    status: "ready",
    profile,
    // §8.1's bounds, for §17.3's settings sheet. The SAME object the upsert schema
    // validates against (`makeStudyProfileUpsertSchema` takes `config.bounds`), so the
    // chips a student is offered and the rule their save is judged by are one value read
    // once. Free: `config` is already loaded above, and unlike the pre-setup `defaults`
    // this needs no timezone resolution, so the hot read path gains no query.
    bounds: config.bounds,
    // §17.1's "~N min". From the config accessor, never a literal — the same two constants
    // `calendar_build_plan_input` snapshots into `engine_planning`, so the estimate the
    // student reads is the budget the plan was built against.
    estimates: config.estimates,
    // §17.2. From the config accessor, never a literal — the picker must offer exactly what
    // V-03 accepts. The guardian payload below deliberately omits it (§16: no write path).
    enabled_block_types: [...config.enabledBlockTypes],
    days: built.days,
    facts: built.facts,
    streak,
    latest_unacknowledged_nonstudent_change: change,
    // `readDiagnosticState` returns null when the lifecycle cannot be established, and
    // §15's response shape has no null for it. §17.1 item 2 renders the recommendation
    // card for EVERY state except `baseline_ready`, so within this surface the three
    // non-ready values are indistinguishable and the substitution is invisible to the
    // student. `baseline_pending` rather than `not_taken` because `not_taken` is the one
    // claim known to be harmful — telling a student who finished their diagnostic to take
    // one is the defect `readDiagnosticState` exists to remove.
    diagnostic_state: diagnostic ?? "baseline_pending",
    ...(projection === null ? {} : { projection }),
    ...(mismatchOf(profile.timezone, query.device_timezone) ?? {}),
  });
}

/**
 * §17.3 / sheet item 18: the server cannot know the device's zone unless the client sends
 * it, and it never changes the profile silently. Both zones travel so the prompt can name
 * them.
 */
function mismatchOf(
  profileTimezone: string,
  deviceTimezone: string | undefined,
): {
  device_timezone_mismatch: {
    profile_timezone: string;
    device_timezone: string;
  };
} | null {
  if (deviceTimezone === undefined) return null;
  if (deviceTimezone === profileTimezone) return null;
  return {
    device_timezone_mismatch: {
      profile_timezone: profileTimezone,
      device_timezone: deviceTimezone,
    },
  };
}

/**
 * R-08-04. Generates once, on the first entitled open after setup completes.
 *
 * A failure is logged and swallowed: the read continues and returns an empty fortnight,
 * which is what the student would have seen anyway. Turning a generation failure into a
 * 500 would take the whole screen down over the one thing the next open retries for free.
 */
async function generateOnFirstOpen(
  studentId: string,
  profile: StudyProfile,
  generatorVersion: string,
  requestId?: string,
): Promise<void> {
  if (profile.setup_completed_at === null) return;

  const { count, error } = await supabaseServer
    .from("calendar_plan_versions")
    .select("version_no", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("validator_result", "accepted");

  if (error) {
    logger.warn(
      "CALENDAR_READ",
      "first_open_probe_failed",
      "could not establish whether a plan exists; no plan is generated on this open",
      { ...classifyError(error), requestId },
    );
    return;
  }
  if ((count ?? 0) > 0) return;

  const result = await regeneratePlan(
    {
      student_id: studentId,
      trigger: "setup",
      initiated_by: "student",
      generator_version: generatorVersion,
    },
    requestId,
  );
  if (!result.ok) {
    logger.error(
      "CALENDAR_READ",
      "first_open_generate_failed",
      "the first plan could not be generated on this open; the calendar renders empty",
      { requestId, reason: result.error.kind },
    );
    return;
  }
  logger.info(
    "CALENDAR_READ",
    "setup_completed",
    "the first plan was generated on the first entitled calendar open",
    { version_no: result.value.version_no, requestId },
  );
}

/**
 * §8.1's bounds plus a suggested timezone, for a student who has not set up.
 *
 * Every value comes from `calendar_runtime_config` via `loadCalendarConfig` — there is no
 * literal here, which is the point: the setup sheet's chips and the server's validation
 * read the same rows, so they cannot disagree.
 *
 * The zone is a SUGGESTION and nothing is written. The device zone is offered when
 * `calendar_is_known_timezone` recognises it; otherwise `America/Chicago`, which is sheet
 * §8 item 19's fall-open applied to the one case that has no profile to fall back on.
 */
async function setupDefaults(
  config: CalendarConfig,
  deviceTimezone: string | undefined,
  requestId: string | undefined,
): Promise<CalendarSetupDefaults> {
  const timezone =
    deviceTimezone === undefined
      ? FALLBACK_TIMEZONE
      : (await resolveStoredTimezone(deviceTimezone, requestId)).timezone;
  return {
    timezone,
    daily_minutes_presets: config.bounds.daily_minutes_presets,
    daily_minutes_min: config.bounds.daily_minutes_min,
    daily_minutes_max: config.bounds.daily_minutes_max,
    target_exam_date_max_days: config.bounds.target_exam_date_max_days,
  };
}

/** Doc 05C's band. Optional in the response, so a failure omits it rather than failing. */
async function readProjection(
  studentId: string,
  requestId?: string,
): Promise<CalendarReadyResponse["projection"] | null> {
  try {
    const sections = await readSectionProjections({ studentId });
    return sections.length === 0 ? null : sections;
  } catch (error) {
    logger.warn(
      "CALENDAR_READ",
      "projection_read_failed",
      "Doc 05C projections could not be read; the header renders without a band",
      { requestId, error: error instanceof Error ? error.message : "unknown" },
    );
    return null;
  }
}

// ── The guardian read (§16, sheet item 14) ──────────────────────────────────

/**
 * The SAME assembly, projected. The guardian path does not read different rows or run a
 * different allocator — it runs this one and then drops everything §16 withholds through
 * `toGuardianCalendarDay`, the single named-field mapping.
 *
 * It also generates nothing. `generateOnFirstOpen` is deliberately absent: R-08-04 says
 * the FIRST ENTITLED CALENDAR OPEN generates, and a guardian opening a view is not the
 * student opening their calendar. A guardian write of any kind — including one that only
 * creates a plan — is exactly what the guardian model forbids.
 */
export async function readGuardianCalendar(
  request: CalendarReadRequest,
): Promise<GuardianReadResult> {
  const parsedQuery = calendarQuerySchema.safeParse(request.query);
  if (!parsedQuery.success) {
    return err({ kind: "invalid_query", details: parsedQuery.error.flatten() });
  }
  const query = parsedQuery.data;

  const config = await loadCalendarConfig();
  const profile = await readStudyProfile(
    request.student_id,
    request.request_id,
  );
  // §16 gives a guardian no write path, so no `defaults`: the chips exist to prefill a
  // setup form, and a guardian cannot run setup for their student.
  if (profile === null) return ok({ status: "setup_required" });

  const today = localTodayIn(profile.timezone, request.now);
  const from = query.from ?? today;
  const to = query.to ?? addDaysToLocalDate(from, config.horizonDays - 1);

  const range = await assembleRange(
    request.student_id,
    profile,
    from,
    to,
    request.now,
    request.request_id,
  );
  const built = buildCalendarRange({
    today: range.today,
    days: range.days,
    units: range.units,
    launches: range.launches,
  });

  const streak = await getStudentActivityStreak(
    request.student_id,
    request.request_id,
  );

  // Parsed on the way out, not just typed. The guardian boundary is the one place a leak
  // is a privacy incident rather than a bug, and `.strict()` rejects an extra key that a
  // future edit to `toGuardianCalendarDay` might let through.
  const response = guardianCalendarResponseSchema.safeParse({
    status: "ready",
    // The SAME estimates the student's payload carries — owner ruling 2026-09-22: the
    // parent view is identical to the student's, and minutes are not among §16's exclusions.
    estimates: config.estimates,
    days: built.days.map(toGuardianCalendarDay),
    facts: built.facts,
    streak,
  });
  if (!response.success) {
    logger.error(
      "CALENDAR_READ",
      "guardian_projection_invalid",
      "the guardian projection did not satisfy its own schema and was not served",
      {
        requestId: request.request_id,
        issues: response.error.issues.map((issue) => issue.path.join(".")),
      },
    );
    return err({ kind: "read_failed", detail: "guardian_projection_invalid" });
  }
  return ok(response.data);
}

export { FALLBACK_TIMEZONE };
