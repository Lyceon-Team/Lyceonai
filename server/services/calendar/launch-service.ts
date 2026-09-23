/**
 * CalendarLaunchService — Doc 05F §15.1.
 *
 * @spec [Doc-05F_V1.0 §15.1 launch (INV-08-18), §13 allocator, §12.2 protected
 *        state, §9.1 adapter contract; lyceon-coding-standards §3.5, §3.6]
 * | @implemented [2026-09-21]
 *
 * plain English: turns "the student pressed Start on this block" into a live engine
 * session, exactly once. The handler does auth, entitlement and parse, then delegates
 * here; no workflow lives in the route (§15).
 *
 * THIS SERVICE IS THE SOLE OWNER OF THE IDEMPOTENCY KEY FORMAT. `calendar:block:
 * <block_id>:<seq>` is built here and nowhere else, and adapters forward it unchanged.
 * That ownership is the whole of INV-08-18: two concurrent first launches compute the
 * same sequence, therefore the same key, therefore get ONE engine session back.
 *
 * expected outcome: a crash between creating the engine session and recording the
 * launch heals on retry — the same sequence yields the same key, the engine replays
 * its session rather than making a second, and the link row lands the second time.
 *
 * trade-offs: every database read is a port on `LaunchDeps` rather than a query in
 * here. The sequencing in this file is the part that is easy to get wrong and hard to
 * test against a live schema; the queries are the part that is easy to test against a
 * live schema and hard to get wrong. Splitting them lets each be proved where it is
 * cheap.
 *
 * edge cases: a block whose engine has not shipped fails OPEN — the adapter declines
 * as data and this returns `engine_unavailable`, which the route answers 409 with a
 * CTA rather than 500. Studying ahead is not a launch: a future date is view-only and
 * a past one routes to "Do it now" (§15.1 step 1).
 */
import {
  allocateDay,
  engineOfBlock,
  err,
  ok,
  type ActivityUnit,
  type CalendarEngine,
  type PlanBlock,
  type Result,
} from "@lyceon/shared";
import type { CalendarEngineAdapter, EngineLifecycle } from "./adapters/types";

// ── Ports ───────────────────────────────────────────────────────────────────

/** Everything needed to allocate the block's day and decide what is outstanding. */
export type BlockLaunchContext = {
  block: PlanBlock;
  /** Every block on that date, in display order — §13 allocates across the whole day. */
  dayBlocks: PlanBlock[];
  /** The plan date's OWN timezone (§8.2), not today's profile value. */
  timezone: string;
  /** Today in the student's timezone, resolved by the caller. */
  localToday: string;
};

export type ExistingLaunch = {
  launch_sequence: number;
  engine: CalendarEngine;
  engine_session_id: string;
};

export type LaunchDeps = {
  loadBlockContext(
    studentId: string,
    blockId: string,
  ): Promise<BlockLaunchContext | null>;
  /** The day's units across every engine that owns a block on it. */
  activityUnits(
    studentId: string,
    localDate: string,
    timezone: string,
    engines: readonly CalendarEngine[],
  ): Promise<ActivityUnit[]>;
  /** The highest `launch_sequence` for this block, or null when never launched. */
  latestLaunch(blockId: string): Promise<ExistingLaunch | null>;
  /** `calendar_link_launch`. Append-only, idempotent on (engine, engine_session_id). */
  linkLaunch(
    studentId: string,
    blockId: string,
    engine: CalendarEngine,
    engineSessionId: string,
  ): Promise<Result<{ launch_sequence: number; replayed: boolean }, string>>;
  adapterFor(engine: CalendarEngine): CalendarEngineAdapter;
};

export type LaunchRequest = {
  student_id: string;
  actor_id: string;
  role: string | undefined;
  block_id: string;
  client_instance_id: string;
  platform: "web" | "mobile";
};

export type LaunchSuccess = {
  engine: CalendarEngine;
  session_id: string;
  next: string;
  resumed: boolean;
};

/**
 * Every way a launch can legitimately not happen. A discriminated union rather than
 * a status code, because the service does not own HTTP — the route maps these.
 */
export type LaunchFailure =
  | { kind: "not_found" }
  | {
      kind: "not_today";
      when: "past" | "future";
      scheduled_date: string;
      local_today: string;
    }
  | { kind: "already_complete"; target: number; actual: number }
  | { kind: "engine_unavailable"; engine: CalendarEngine }
  | {
      kind: "engine_error";
      engine: CalendarEngine;
      status?: number;
      detail?: string;
    }
  | { kind: "link_failed"; detail: string };

export type LaunchResult = Result<LaunchSuccess, LaunchFailure>;

// ── The key ─────────────────────────────────────────────────────────────────

/**
 * `calendar:block:<block_id>:<seq>` (§15.1 step 4). Exported for the tests and for
 * nobody else: adapters receive it, they never build it.
 */
export function launchIdempotencyKey(
  blockId: string,
  sequence: number,
): string {
  return `calendar:block:${blockId}:${sequence}`;
}

// ── The service ─────────────────────────────────────────────────────────────

const LIVE: readonly EngineLifecycle[] = ["active"];

export async function launchBlock(
  request: LaunchRequest,
  deps: LaunchDeps,
): Promise<LaunchResult> {
  // 1. Load the block.
  const context = await deps.loadBlockContext(
    request.student_id,
    request.block_id,
  );
  if (context === null) return err({ kind: "not_found" });

  const { block, dayBlocks, timezone, localToday } = context;
  const engine = engineOfBlock(block.block_type);
  const adapter = deps.adapterFor(engine);

  // 2. §15.1 step 1: only today launches. A past date routes to "Do it now"; a future
  //    one is view-only. Studying ahead happens in the engines and shows up as today's
  //    actual or extra work, which is why this is a refusal and not a redirect.
  if (block.scheduled_date !== localToday) {
    return err({
      kind: "not_today",
      when: block.scheduled_date < localToday ? "past" : "future",
      scheduled_date: block.scheduled_date,
      local_today: localToday,
    });
  }

  // 3. §15.1 step 3: the latest launch, and whether its session is still live. A live
  //    session is handed back rather than joined by a second one.
  const latest = await deps.latestLaunch(block.block_id);
  if (latest !== null) {
    // THE LAUNCH ROW'S OWN ADAPTER, not the block's. `engine` above is derived from the
    // block's CURRENT type; `latest.engine` is the engine that actually owns this session
    // id. They differ when a day was edited after a launch — a practice block changed to
    // review still has a practice session on its last launch row — and asking the wrong
    // engine about a session id it has never heard of is how a live session gets reported
    // as dead. Same object then answers `resumeHref`, so the route always belongs to the
    // engine whose session it names.
    const sessionAdapter = deps.adapterFor(latest.engine);
    const lifecycle = await sessionAdapter.progress(latest.engine_session_id);
    if (lifecycle !== null && LIVE.includes(lifecycle)) {
      return ok({
        engine: latest.engine,
        session_id: latest.engine_session_id,
        // THE ROUTE COMES FROM THE ADAPTER, on this branch exactly as on the create
        // branch below. This line used to read `/practice/session/${...}` for every
        // engine, so resuming a live REVIEW block sent the student to practice's page
        // with a review session id — a 404 on `/api/practice/sessions/:id/state`, in
        // production on 2026-09-22. Only resume was affected: `create` already asked the
        // adapter, which is why the FIRST launch of a block worked and every one after
        // it did not.
        next: sessionAdapter.resumeHref(latest.engine_session_id),
        resumed: true,
      });
    }
  }

  // 4. §15.1 step 4: what is still outstanding, from the §13 allocator over the whole
  //    day. Not from the launch rows — a launch is not progress (§7.7).
  const units = await deps.activityUnits(
    request.student_id,
    block.scheduled_date,
    timezone,
    enginesOf(dayBlocks),
  );
  const allocation = allocateDay({
    local_date: block.scheduled_date,
    today: localToday,
    blocks: dayBlocks,
    units,
    launches: [],
  });
  const allocated = allocation.blocks.find(
    (b) => b.block_id === block.block_id,
  );
  const actual = allocated?.actual ?? 0;
  const remaining = block.target_count - actual;
  if (remaining <= 0) {
    return err({
      kind: "already_complete",
      target: block.target_count,
      actual,
    });
  }

  // 5. §15.1 step 4 continued: the engine decides the size, the calendar decides the
  //    key. `seq` is last + 1 whether or not the last session is still live, so a
  //    retry after a crash recomputes the SAME key.
  const size = await adapter.nextLaunchSize(block, remaining);
  const sequence = (latest?.launch_sequence ?? 0) + 1;
  const created = await adapter.create(block, size, {
    student_id: request.student_id,
    actor_id: request.actor_id,
    role: request.role,
    client_instance_id: request.client_instance_id,
    platform: request.platform,
    idempotency_key: launchIdempotencyKey(block.block_id, sequence),
  });

  if (!created.ok) {
    if (created.error.reason === "engine_unavailable") {
      return err({ kind: "engine_unavailable", engine });
    }
    return err({
      kind: "engine_error",
      engine,
      ...(created.error.status === undefined
        ? {}
        : { status: created.error.status }),
      ...(created.error.detail === undefined
        ? {}
        : { detail: created.error.detail }),
    });
  }

  // 6. §15.1 step 5: record the launch. A crash between 5 and 6 heals on retry — the
  //    engine replays its session for the same key and the link row lands this time.
  const linked = await deps.linkLaunch(
    request.student_id,
    block.block_id,
    engine,
    created.value.session_id,
  );
  if (!linked.ok) return err({ kind: "link_failed", detail: linked.error });

  return ok({
    engine,
    session_id: created.value.session_id,
    next: created.value.next,
    resumed: created.value.resumed,
  });
}

/** The engines that own a block on the day, so activity is read once per engine. */
function enginesOf(blocks: readonly PlanBlock[]): CalendarEngine[] {
  const seen = new Set<CalendarEngine>();
  for (const block of blocks) seen.add(engineOfBlock(block.block_type));
  return [...seen];
}
