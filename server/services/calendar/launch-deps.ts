/**
 * The live `LaunchDeps` — every database read `CalendarLaunchService` needs.
 *
 * @spec [Doc-05F_V1.0 §7.6 `calendar_current_plan`, §7.7 `calendar_block_launches`,
 *        §8.2 (the date's own timezone), §15.1 (launch sequence, INV-08-18);
 *        lyceon-coding-standards §2 (DB access centralised)]
 * | @implemented [2026-09-21]
 *
 * plain English: `launch-service.ts` declares four questions it needs answered and one
 * registry lookup. This answers them against the real schema. The split is deliberate:
 * the sequencing in the service is the part that is easy to get wrong and hard to test
 * against a live database, and these queries are the reverse.
 *
 * WHY `loadBlockContext` READS THE WHOLE DAY. §13 allocates across every block on a date,
 * not one block at a time: two practice blocks on the same day compete for the same
 * answered items, so "what is still outstanding on THIS block" is only answerable with
 * the day in hand. Reading one block would make `remaining` too large whenever a day has
 * more than one block, and the student would be handed a session for work they had
 * already done.
 *
 * expected outcome: pressing Start twice in two tabs produces one practice session,
 * because both callers read the same `latestLaunch`, compute the same sequence, and hand
 * the engine the same key.
 *
 * trade-offs: `localToday` is resolved from the PLAN DATE's timezone, not the profile's
 * (§8.2). A student who moved from Tokyo to Chicago still has their Tokyo-planned dates
 * meaning Tokyo days, and "is this block today" has to be asked in the zone the date was
 * planned in or a launch would be refused across the move.
 *
 * edge cases: a block with no membership on the current plan is `not_found` even though
 * the row exists — a block dropped by a later version is not on the plan, and launching
 * it would resurrect work the student removed.
 */
import {
  engineOfBlock,
  err,
  ok,
  planBlockSchema,
  type ActivityUnit,
  type CalendarEngine,
  type PlanBlock,
  type Result,
} from "@lyceon/shared";
import { supabaseServer } from "../../../apps/api/src/lib/supabase-server";
import { logger } from "../../logger";
import { classifyError } from "../../lib/redact";
import { adapterFor } from "./adapters";
import { localTodayIn } from "./adapters/local-day";
import type {
  BlockLaunchContext,
  ExistingLaunch,
  LaunchDeps,
} from "./launch-service";

type PlanRow = {
  scheduled_date: string;
  timezone: string;
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
 * The date the block sits on, then every block on that date. Two round trips rather than
 * one join, because the first answer decides the second query and PostgREST cannot
 * express "the sibling rows of the row I just found" in one call.
 */
async function loadBlockContext(
  studentId: string,
  blockId: string,
): Promise<BlockLaunchContext | null> {
  const { data: located, error: locateError } = await supabaseServer
    .from("calendar_current_plan")
    .select("scheduled_date, timezone")
    .eq("student_id", studentId)
    .eq("block_id", blockId)
    .maybeSingle();

  if (locateError) {
    logger.error(
      "CALENDAR_LAUNCH",
      "block_locate_failed",
      "the block's plan date could not be read",
      { blockId, ...classifyError(locateError) },
    );
    throw new Error(`calendar_block_locate_failed: ${locateError.message}`);
  }
  if (located === null) return null;

  const scheduledDate = located.scheduled_date;
  const timezone = located.timezone;
  if (typeof scheduledDate !== "string" || typeof timezone !== "string") return null;

  const { data: planRows, error: planError } = await supabaseServer
    .from("calendar_current_plan")
    .select("scheduled_date, timezone, block_id, display_ordinal, membership_type")
    .eq("student_id", studentId)
    .eq("scheduled_date", scheduledDate);

  if (planError) {
    logger.error(
      "CALENDAR_LAUNCH",
      "day_read_failed",
      "the block's day could not be read",
      { blockId, ...classifyError(planError) },
    );
    throw new Error(`calendar_launch_day_read_failed: ${planError.message}`);
  }

  const rows = (planRows ?? []) as PlanRow[];
  const blockIds = rows
    .map((row) => row.block_id)
    .filter((id): id is string => typeof id === "string");
  if (!blockIds.includes(blockId)) return null;

  const { data: blockRows, error: blockError } = await supabaseServer
    .from("calendar_blocks")
    .select("block_id, scheduled_date, block_type, section, scope, target_count, source, derived_from_block_id, explanation_key")
    .eq("student_id", studentId)
    .in("block_id", blockIds);

  if (blockError) {
    logger.error(
      "CALENDAR_LAUNCH",
      "blocks_read_failed",
      "the day's blocks could not be read",
      { blockId, ...classifyError(blockError) },
    );
    throw new Error(`calendar_launch_blocks_read_failed: ${blockError.message}`);
  }

  const byId = new Map<string, BlockRow>();
  for (const row of (blockRows ?? []) as BlockRow[]) byId.set(row.block_id, row);

  const dayBlocks: PlanBlock[] = [];
  for (const row of rows) {
    if (row.block_id === null || row.display_ordinal === null || row.membership_type === null) {
      continue;
    }
    const stored = byId.get(row.block_id);
    if (stored === undefined) continue;
    const parsed = planBlockSchema.safeParse({
      block_id: stored.block_id,
      scheduled_date: stored.scheduled_date,
      block_type: stored.block_type,
      section: stored.section,
      scope: stored.scope,
      target_count: stored.target_count,
      source: stored.source,
      derived_from_block_id: stored.derived_from_block_id,
      explanation_key: stored.explanation_key,
      display_ordinal: row.display_ordinal,
      membership_type: row.membership_type,
    });
    if (!parsed.success) {
      logger.error(
        "CALENDAR_LAUNCH",
        "block_shape_unexpected",
        "a stored block on the launch day does not match the shared schema",
        { blockId: stored.block_id, blockType: stored.block_type },
      );
      continue;
    }
    dayBlocks.push(parsed.data);
  }
  dayBlocks.sort((a, b) => a.display_ordinal - b.display_ordinal);

  const block = dayBlocks.find((candidate) => candidate.block_id === blockId);
  // The block is on the plan but its own row would not parse. Refusing is the only safe
  // answer: the service would otherwise launch against a shape nothing validated.
  if (block === undefined) return null;

  return {
    block,
    dayBlocks,
    timezone,
    // §8.2: the PLAN DATE's zone decides what "today" means for this block.
    localToday: localTodayIn(timezone),
  };
}

/** §13 across every engine that owns a block on the day, each in the day's own zone. */
async function activityUnits(
  studentId: string,
  localDate: string,
  timezone: string,
  engines: readonly CalendarEngine[],
): Promise<ActivityUnit[]> {
  const settled = await Promise.allSettled(
    engines.map((engine) => adapterFor(engine).activityUnits(studentId, localDate, timezone)),
  );
  const units: ActivityUnit[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      units.push(...result.value);
      continue;
    }
    // Fail OPEN, matching the adapters. Unread activity means the block looks less
    // complete than it is, so the student gets a session — never a 500 on Start.
    logger.error(
      "CALENDAR_LAUNCH",
      "activity_read_failed",
      "an engine could not report activity for the launch day",
      { localDate },
    );
  }
  return units;
}

/**
 * §15.1 step 3. The HIGHEST `launch_sequence`, which is what the next sequence is derived
 * from — and deriving it from the stored rows rather than a counter is precisely what
 * makes a crashed launch heal: the retry reads the same maximum and rebuilds the same key.
 */
async function latestLaunch(blockId: string): Promise<ExistingLaunch | null> {
  const { data, error } = await supabaseServer
    .from("calendar_block_launches")
    .select("launch_sequence, engine, engine_session_id")
    .eq("block_id", blockId)
    .order("launch_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error(
      "CALENDAR_LAUNCH",
      "latest_launch_read_failed",
      "the block's latest launch could not be read",
      { blockId, ...classifyError(error) },
    );
    // NOT fail-open. An unread maximum would make the next sequence 1, which is either a
    // primary-key collision or — worse — a second engine session under a key the first
    // launch already used. A refused launch is recoverable; a duplicated one is not.
    throw new Error(`calendar_latest_launch_read_failed: ${error.message}`);
  }
  if (data === null) return null;
  if (typeof data.launch_sequence !== "number") return null;
  if (typeof data.engine_session_id !== "string") return null;

  return {
    launch_sequence: data.launch_sequence,
    engine: data.engine as CalendarEngine,
    engine_session_id: data.engine_session_id,
  };
}

/**
 * `calendar_link_launch`. The RPC allocates the sequence under a `FOR UPDATE` on the
 * block row (20260917140000) and replays on `(engine, engine_session_id)`, so a repeated
 * call for the same engine session returns the stored row rather than colliding.
 */
async function linkLaunch(
  studentId: string,
  blockId: string,
  engine: CalendarEngine,
  engineSessionId: string,
): Promise<Result<{ launch_sequence: number; replayed: boolean }, string>> {
  const { data, error } = await supabaseServer.rpc("calendar_link_launch", {
    p_student_id: studentId,
    p_block_id: blockId,
    p_engine: engine,
    p_engine_session_id: engineSessionId,
  });

  if (error) {
    logger.error(
      "CALENDAR_LAUNCH",
      "link_failed",
      "the engine session was created but could not be linked to the block",
      { blockId, engine, ...classifyError(error) },
    );
    return err(error.message);
  }

  if (typeof data !== "object" || data === null) return err("link_envelope_unexpected");
  const envelope = data as { launch_sequence?: unknown; replayed?: unknown };
  if (typeof envelope.launch_sequence !== "number") return err("link_envelope_unexpected");

  // §18 `calendar.block_launched {engine, resumed}`. The session id is not logged: it is
  // the handle to a student's work, and the block id is enough to correlate.
  logger.info(
    "CALENDAR_LAUNCH",
    "block_launched",
    "a calendar block was linked to an engine session",
    { blockId, engine, replayed: envelope.replayed === true },
  );

  return ok({
    launch_sequence: envelope.launch_sequence,
    replayed: envelope.replayed === true,
  });
}

/**
 * The live wiring. One object, exported once, so the launch route has nothing to assemble
 * and a test has one seam to replace.
 */
export const liveLaunchDeps: LaunchDeps = {
  loadBlockContext,
  activityUnits,
  latestLaunch,
  linkLaunch,
  adapterFor,
};

export { engineOfBlock };
