/**
 * The progress allocator — Doc 05F §13, one pure function, run at read time.
 *
 * @spec [Doc_05F §13 (allocator, R-08-24, R-08-29), §9.1 (adapter contract / ActivityUnit),
 *        §9.2–§9.4 (per-engine `matches`), INV-08-08, INV-08-21;
 *        lyceon-coding-standards §3.4, §3.5, §4.1]
 * | @implemented [2026-09-17]
 *
 * plain English: a day has planned blocks and the engines have facts about what the student
 * actually did. This function hands each activity unit to at most one block, in display
 * order, and calls whatever is left over extra work. Nothing is stored; the answer is a
 * function of immutable plan rows and finalized engine outcomes, so it is the same answer
 * every time it is asked.
 *
 * expected outcome: `sum(allocated) + sum(extra) = units considered`, always, and no unit id
 * appears in two places. That single property is what makes overlapping block scopes safe:
 * a 20-question Algebra block followed by an Algebra+Geometry block cannot both count the
 * same twenty answers.
 *
 * trade-offs: matching is engine equality FIRST and scope second. Checking scope first
 * would let a review item satisfy a practice block whenever the section and domain lined up,
 * which is a different student doing different work.
 *
 * edge cases: duplicate `(engine, unit_id)` identities are one unit (INV-08-21), so the
 * first occurrence in sort order wins and `units_considered` reports the post-deduplication
 * count. A review block scoped to one source session still matches on engine alone — §9.3's
 * `matches` is engine equality, and `ActivityUnit` (§9.1) carries no source session id to
 * compare against, so there is nothing narrower to do without inventing a field.
 */
import { z } from "zod";
import {
  calendarEngineSchema,
  calendarSectionSchema,
  engineOfBlock,
} from "./scope.js";
import { planBlockSchema, type PlanBlock } from "./plan.js";
import { instantSchema, instantSortKey, localDateSchema } from "./time.js";

// ── Inputs ──────────────────────────────────────────────────────────────────

/**
 * One atomic thing the student did, as an engine reports it (§9.1). Identity is
 * `(engine, unit_id)`.
 *
 * `occurred_at` is the moment of RETRIEVAL — the `occurred_at` COLUMN for both the practice
 * and the review engine (owner ruling 2026-09-22, superseding the 2026-09-17 ruling that
 * mapped it to `answered_at`). §22.4's midnight split is defined on it. Both item tables
 * CHECK that a resolved row has an `occurred_at` and guarantee nothing about `answered_at`,
 * so the calendar reads the column the schema enforces. That mapping is a line in the
 * adapter contract so the server cannot map it some other way.
 *
 * `domain` is a plain string, not the canonical enum. A unit whose domain is not one of the
 * canonical eight simply matches no block scope and lands in extra work, which is the right
 * answer — refusing to parse the day because one historical row has an off-catalogue domain
 * would turn a data wrinkle into a 500.
 *
 * `skills` from §9.1 is deliberately absent. Formula sheet §8 item 3 removed `skill_codes`
 * from `calendar_blocks`, so no scope can reference a skill and nothing in this layer could
 * read one. A field with no consumer on a shape that flows toward a client payload is
 * exactly what the anti-leak chokepoint rule warns about.
 *
 * `session_id` IS NEW (R-08-34, Brief 15), and it is the field §9.1 did not have. Linked-session
 * attribution needs to know which engine session a unit came from, and there was no way to ask:
 * this shape carried `unit_id` and nothing about its parent. Both item tables have had the
 * column all along (`practice_session_items.session_id`, `review_session_items.session_id`,
 * `20260610020000:105` and `:170`); the adapters simply never selected it.
 *
 * Nullable, and null is the FAIL-CLOSED value: a unit with no session id can never be linked
 * to a block, so it falls through to the ordinary date-and-scope match. That is the right
 * answer for any engine that cannot name a session rather than a reason to refuse the day.
 *
 * ANTI-LEAK, checked in this change rather than assumed (CLAUDE.md's chokepoint rule). An
 * `ActivityUnit` never reaches a client: the wire shapes in `read-model.ts` are `.strict()`
 * and name their own fields — `dayBlockSchema` carries `{block, actual, progress, status}` and
 * `dayExtraWorkSchema` OMITS `unit_ids` outright — so neither a unit id nor a session id has a
 * path to a payload. Adding one here cannot open one.
 */
export const activityUnitSchema = z
  .object({
    engine: calendarEngineSchema,
    unit_id: z.string().min(1),
    /**
     * The engine session this unit came out of, or null when the engine cannot name one.
     * Paired with `engine` it is what a `calendar_block_launches` row points at, and that
     * pairing is the whole of the linked-session rule (§13 as amended by R-08-34).
     */
    session_id: z.string().min(1).nullable().default(null),
    occurred_at: instantSchema,
    /** The unit's day in the OWNING PLAN DATE's timezone (§8.2), decided by the adapter. */
    local_date: localDateSchema,
    section: calendarSectionSchema.nullable(),
    domain: z.string().nullable(),
    form_id: z.string().nullable(),
  })
  .strict();
export type ActivityUnit = z.infer<typeof activityUnitSchema>;

export const SESSION_LIFECYCLES = ["active", "completed", "abandoned"] as const;
export const sessionLifecycleSchema = z.enum(SESSION_LIFECYCLES);
export type SessionLifecycle = z.infer<typeof sessionLifecycleSchema>;

/**
 * A block's latest launch and the lifecycle its engine reports for that session (§15.1 step
 * 3). Resolved by the caller — `adapter.progress()` is IO and does not belong in here.
 */
export const blockLaunchStateSchema = z
  .object({
    block_id: z.string().uuid(),
    lifecycle: sessionLifecycleSchema,
  })
  .strict();
export type BlockLaunchState = z.infer<typeof blockLaunchStateSchema>;

/**
 * A `calendar_block_launches` row, as the allocator needs it: this engine session belongs to
 * this block (§13 as amended by R-08-34, Brief 15).
 *
 * RANGE-WIDE, not per-day, and that is the point. The block a session belongs to may sit on a
 * different date from the work — that is exactly what "any-day launch" produces — so a day's
 * allocation has to know about links pointing at OTHER days in order to leave those units
 * alone. Passing only this day's links would make a work-ahead unit extra work today AND
 * progress on the future block, which is the double count INV-08-21 forbids.
 *
 * ALL launch rows for a block, not just the latest: a block launched twice owns both sessions
 * (§7.7 — "12/20 then abandoned → Continue starts a second session"), and the work from the
 * abandoned first session is still that block's work.
 */
export const linkedSessionSchema = z
  .object({
    block_id: z.string().uuid(),
    engine: calendarEngineSchema,
    engine_session_id: z.string().min(1),
  })
  .strict();
export type LinkedSession = z.infer<typeof linkedSessionSchema>;

/**
 * Everything the allocator needs, and nothing it could read for itself. `today` is a
 * parameter because `missed` is the one status that depends on the calendar date, and a
 * clock read inside a pure function is a test that passes until midnight.
 */
export const dayAllocationInputSchema = z
  .object({
    local_date: localDateSchema,
    today: localDateSchema,
    blocks: z.array(planBlockSchema),
    /**
     * This day's units, PLUS any unit from another day whose session is linked to a block on
     * this day. The caller assembles that set — see `buildCalendarRange` — because only it
     * knows the whole range.
     */
    units: z.array(activityUnitSchema),
    launches: z.array(blockLaunchStateSchema),
    /** Range-wide launch attribution. Absent is the same as empty: no link, no attribution. */
    linked_sessions: z.array(linkedSessionSchema).default([]),
  })
  .strict();
export type DayAllocationInput = z.infer<typeof dayAllocationInputSchema>;

// ── Outputs ─────────────────────────────────────────────────────────────────

export const BLOCK_STATUSES = [
  "completed",
  "partial",
  "in_progress",
  "missed",
  "scheduled",
] as const;
export const blockStatusSchema = z.enum(BLOCK_STATUSES);
export type BlockStatus = z.infer<typeof blockStatusSchema>;

export const allocatedBlockSchema = z
  .object({
    block_id: z.string().uuid(),
    display_ordinal: z.number().int().positive(),
    engine: calendarEngineSchema,
    target: z.number().int().positive(),
    actual: z.number().int().min(0),
    /** The consumed units, in the order they were consumed. Identity is `(engine, unit_id)`. */
    unit_ids: z.array(z.string()),
    status: blockStatusSchema,
  })
  .strict();
export type AllocatedBlock = z.infer<typeof allocatedBlockSchema>;

/** §13: unconsumed units grouped by `(engine, section, domain)`. */
export const extraWorkGroupSchema = z
  .object({
    engine: calendarEngineSchema,
    section: calendarSectionSchema.nullable(),
    domain: z.string().nullable(),
    count: z.number().int().positive(),
    unit_ids: z.array(z.string()),
  })
  .strict();
export type ExtraWorkGroup = z.infer<typeof extraWorkGroupSchema>;

export const dayAllocationSchema = z
  .object({
    local_date: localDateSchema,
    blocks: z.array(allocatedBlockSchema),
    extra_work: z.array(extraWorkGroupSchema),
    /**
     * Units after deduplication by identity. `sum(blocks.actual) + sum(extra_work.count)`
     * equals this, always — the invariant the property test asserts.
     */
    units_considered: z.number().int().min(0),
  })
  .strict();
export type DayAllocation = z.infer<typeof dayAllocationSchema>;

// ── Matching (§9.2–§9.4) ────────────────────────────────────────────────────

/**
 * Engine equality first, then the engine's own scope rule. The order is the rule, not an
 * optimisation: `unit.engine = engineOf(b)` is the first clause of every adapter's
 * `matches` in §9.2, §9.3 and §9.4.
 */
export function unitMatchesBlock(unit: ActivityUnit, block: PlanBlock): boolean {
  if (unit.engine !== engineOfBlock(block.block_type)) return false;

  if (block.block_type === "practice") {
    if (unit.section !== block.section) return false;
    if (block.scope.level === "section") return true;
    if (unit.domain === null) return false;
    return block.scope.mix.some((entry) => entry.domain === unit.domain);
  }

  if (block.block_type === "review") {
    // §9.3: `matches` is engine equality. See the module header on `mode: "session"`.
    return true;
  }

  // §9.4 / SCL-168: a null `form_id` means "the next test" picked the form, so any exam counts.
  return block.scope.form_id === null || unit.form_id === block.scope.form_id;
}

// ── The allocator ───────────────────────────────────────────────────────────

/** `(engine, unit_id)` as one comparable key. JSON quoting keeps it unambiguous. */
function unitIdentity(unit: ActivityUnit): string {
  return JSON.stringify([unit.engine, unit.unit_id]);
}

/** §13: `sorted by (occurred_at, engine, unit_id)` — immutable engine facts, total order. */
function compareUnits(left: ActivityUnit, right: ActivityUnit): number {
  const byTime = instantSortKey(left.occurred_at) - instantSortKey(right.occurred_at);
  if (byTime !== 0) return byTime;
  if (left.engine !== right.engine) return left.engine < right.engine ? -1 : 1;
  if (left.unit_id !== right.unit_id) return left.unit_id < right.unit_id ? -1 : 1;
  return 0;
}

/** Display order is the only tiebreak §13 allows, and it is stored. */
function compareBlocks(left: PlanBlock, right: PlanBlock): number {
  if (left.display_ordinal !== right.display_ordinal) {
    return left.display_ordinal - right.display_ordinal;
  }
  if (left.block_id !== right.block_id) return left.block_id < right.block_id ? -1 : 1;
  return 0;
}

function statusOf(
  actual: number,
  target: number,
  hasActiveLaunch: boolean,
  isPast: boolean,
): BlockStatus {
  if (actual >= target) return "completed";
  if (actual > 0) return "partial";
  if (hasActiveLaunch) return "in_progress";
  if (isPast) return "missed";
  return "scheduled";
}

/** `(engine, session_id)` as one comparable key — the shape a launch row points at. */
function sessionKey(engine: string, sessionId: string): string {
  return JSON.stringify([engine, sessionId]);
}

/**
 * Allocate one day's activity to that day's blocks.
 *
 * Total: every legal input returns a `DayAllocation` and nothing throws. Deterministic: the
 * only orderings it uses are the stored display ordinal and the engines' own timestamps.
 *
 * TWO PASSES SINCE R-08-34 (Brief 15), and the order is the rule:
 *
 *   1. LINKED SESSIONS. A unit from an engine session that a launch row ties to block B
 *      belongs to B, whatever date the unit happened on. The student pressed Start on B and
 *      this is the work that came out of it; no date or scope comparison can be a better
 *      answer than that.
 *   2. DATE AND SCOPE, exactly as before, over whatever pass 1 left.
 *
 * Pass 1 goes first because it is the stronger claim. It also changes an ordinary same-day
 * case on purpose: with an Algebra-20 block at ordinal 1 and an Algebra-10 at ordinal 2, ten
 * Algebra units launched FROM the second now count for the second, where display order used
 * to hand them to the first. The student did the block they pressed.
 *
 * CONSERVATION, which is the part worth being careful about (INV-08-21). A unit linked to a
 * block that is NOT on this day is not this day's business at all: it is dropped before
 * anything counts it, so it is neither progress here nor extra work here, and
 * `units_considered` excludes it. It is counted exactly once, on its block's day, where the
 * caller has injected it. Without that exclusion a work-ahead unit would be extra work today
 * and progress tomorrow — the double count this invariant exists to forbid.
 *
 * A linked unit SURPLUS to its block's target is not special: once pass 1 has filled the
 * block, the leftovers behave like any other unit on the block's day — pass 2 may hand them
 * to another block, and otherwise they are that day's extra work. They are still counted once.
 */
export function allocateDay(input: DayAllocationInput): DayAllocation {
  // Which block each session belongs to, and which of those blocks are on this day.
  const sessionBlock = new Map<string, string>();
  for (const link of input.linked_sessions) {
    sessionBlock.set(
      sessionKey(link.engine, link.engine_session_id),
      link.block_id,
    );
  }
  const blockIdsHere = new Set(input.blocks.map((block) => block.block_id));

  /** The block this unit is linked to, or null when it is linked to none. */
  const linkedBlockOf = (unit: ActivityUnit): string | null => {
    if (unit.session_id === null) return null;
    return sessionBlock.get(sessionKey(unit.engine, unit.session_id)) ?? null;
  };

  const sortedUnits = [...input.units].sort(compareUnits);

  // Deduplicate by identity, first-in-sort-order wins (INV-08-21). A unit linked to a block
  // on ANOTHER day is dropped in the same pass: see the conservation note above.
  const seen = new Set<string>();
  const units: ActivityUnit[] = [];
  for (const unit of sortedUnits) {
    const identity = unitIdentity(unit);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const linkedBlock = linkedBlockOf(unit);
    if (linkedBlock !== null && !blockIdsHere.has(linkedBlock)) continue;
    units.push(unit);
  }

  const consumed = new Set<string>();
  const isPast = input.local_date < input.today;
  const activeLaunches = new Set(
    input.launches
      .filter((launch) => launch.lifecycle === "active")
      .map((launch) => launch.block_id),
  );

  // PASS 1 — linked sessions, per block in display order. Runs to completion across every
  // block before pass 2 starts, so a link can never lose a unit to an earlier block's scope
  // match. Two loops over the blocks rather than one interleaved pass, for exactly that.
  const claimed = new Map<string, string[]>();
  for (const block of [...input.blocks].sort(compareBlocks)) {
    const unitIds: string[] = [];
    for (const unit of units) {
      if (unitIds.length >= block.target_count) break;
      const identity = unitIdentity(unit);
      if (consumed.has(identity)) continue;
      if (linkedBlockOf(unit) !== block.block_id) continue;
      // ENGINE STILL HAS TO MATCH. R-08-34 relaxes the DATE, not §13's first clause: a link
      // says which block a session came from, and a day edit can leave a practice session
      // linked to a block that is now a review block (see the launch service's resume
      // branch, which hit exactly that). Counting review items toward a practice block's
      // target would make the block report work of a kind it never asked for. Such a unit
      // falls through to pass 2, matches nothing, and lands in extra work — visible, and
      // attributed to nobody who did not earn it.
      if (unit.engine !== engineOfBlock(block.block_type)) continue;
      consumed.add(identity);
      unitIds.push(unit.unit_id);
    }
    claimed.set(block.block_id, unitIds);
  }

  // PASS 2 — date and scope, unchanged.
  const blocks: AllocatedBlock[] = [];
  for (const block of [...input.blocks].sort(compareBlocks)) {
    const unitIds: string[] = claimed.get(block.block_id) ?? [];
    for (const unit of units) {
      if (unitIds.length >= block.target_count) break;
      const identity = unitIdentity(unit);
      if (consumed.has(identity)) continue;
      if (!unitMatchesBlock(unit, block)) continue;
      consumed.add(identity);
      unitIds.push(unit.unit_id);
    }
    blocks.push({
      block_id: block.block_id,
      display_ordinal: block.display_ordinal,
      engine: engineOfBlock(block.block_type),
      target: block.target_count,
      actual: unitIds.length,
      unit_ids: unitIds,
      status: statusOf(
        unitIds.length,
        block.target_count,
        activeLaunches.has(block.block_id),
        isPast,
      ),
    });
  }

  const extraWork: ExtraWorkGroup[] = [];
  const groupIndex = new Map<string, number>();
  for (const unit of units) {
    if (consumed.has(unitIdentity(unit))) continue;
    const key = JSON.stringify([unit.engine, unit.section, unit.domain]);
    const existing = groupIndex.get(key);
    if (existing === undefined) {
      groupIndex.set(key, extraWork.length);
      extraWork.push({
        engine: unit.engine,
        section: unit.section,
        domain: unit.domain,
        count: 1,
        unit_ids: [unit.unit_id],
      });
      continue;
    }
    const group = extraWork[existing];
    if (group === undefined) continue;
    group.count += 1;
    group.unit_ids.push(unit.unit_id);
  }

  return {
    local_date: input.local_date,
    blocks,
    extra_work: extraWork,
    units_considered: units.length,
  };
}
