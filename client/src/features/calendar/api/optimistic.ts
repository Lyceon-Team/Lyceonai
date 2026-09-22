/**
 * @spec [Doc_05F_Study_Calendar, §12.4 day edit, §12.2 protected state, §13 progress]
 * @implemented [2026-09-23]
 *
 * plain English: pure functions that transform a cached `CalendarResponse` the way the
 * server is about to. Expected outcome: a drag or an edit paints immediately, and if the
 * write fails the hook restores the snapshot it took — nothing here performs IO or decides
 * anything, so all of it is directly testable.
 *
 * WHY A PROVISIONAL BLOCK NEEDS A FLAG. `calendar_blocks` rows are append-only, so changing
 * a block's mix does not update a row — it CREATES one and drops the old member. Until the
 * write returns, the client cannot know the new `block_id`. These functions mint a
 * `provisional:` id so React has a stable key, and `isProvisional` lets the UI disable the
 * controls on it: launching a block id the server has never seen is a 404, and offering the
 * button is offering a broken one.
 *
 * trade-offs: an optimistic day is a PREDICTION, and the only honest way to run one is to
 * replace it with the server's answer on settle. Every caller invalidates.
 *
 * edge cases: a response in the `setup_required` state has no days at all, so every
 * function returns it untouched — there is nothing to be optimistic about before setup.
 */
import type { CalendarDay, CalendarResponse, DayBlock } from "@lyceon/shared";

/** The id prefix a block carries while the server has not yet confirmed it. */
export const PROVISIONAL_PREFIX = "provisional:" as const;

export function isProvisional(blockId: string): boolean {
  return blockId.startsWith(PROVISIONAL_PREFIX);
}

let provisionalCounter = 0;

/**
 * Monotonic rather than random: two provisional blocks created in the same tick must not
 * collide as React keys, and a predictable id makes the tests readable. It is never sent to
 * the server — `isProvisional` gates that.
 */
export function nextProvisionalId(): string {
  provisionalCounter += 1;
  return `${PROVISIONAL_PREFIX}${provisionalCounter}`;
}

/** Test seam: resets the counter so ids are deterministic per test. */
export function resetProvisionalIds(): void {
  provisionalCounter = 0;
}

type DayMapper = (day: CalendarDay) => CalendarDay;

/**
 * Applies `mapper` to every day, then recomputes the two per-day totals §14 derives from the
 * block list. Recomputing rather than leaving them stale is the point: the day header reads
 * "3 of 15", and an optimistic removal that changed the blocks but not the count would show
 * a number that contradicts the blocks directly beneath it.
 */
function mapDays(
  response: CalendarResponse,
  mapper: DayMapper,
): CalendarResponse {
  if (response.status !== "ready") return response;
  return {
    ...response,
    days: response.days.map((day) => {
      const mapped = mapper(day);
      if (mapped === day) return day;
      return {
        ...mapped,
        planned_count: mapped.blocks.reduce(
          (sum, entry) => sum + entry.block.target_count,
          0,
        ),
        actual_count: mapped.blocks.reduce(
          (sum, entry) => sum + entry.actual,
          0,
        ),
      };
    }),
  };
}

/** Finds a block and the local date it sits on, or null when the range does not hold it. */
export function findBlock(
  response: CalendarResponse,
  blockId: string,
): { block: DayBlock; date: string } | null {
  if (response.status !== "ready") return null;
  for (const day of response.days) {
    const block = day.blocks.find((entry) => entry.block.block_id === blockId);
    if (block !== undefined) return { block, date: day.local_date };
  }
  return null;
}

/**
 * §12.2/§12.4 move. The block leaves the source day and is appended to the target, carrying
 * its progress with it — a moved block is the same work, so `actual` and `status` travel.
 *
 * Both days become `is_user_override`, matching what `calendar_move_block` writes, so the
 * "edited" marker in the day header appears the moment the student drops rather than one
 * refetch later.
 *
 * Returns the response unchanged when the target date is not in the loaded range: the
 * student dragged onto a day this query does not cover, and inventing it would render a day
 * the server never sent.
 */
export function applyMove(
  response: CalendarResponse,
  blockId: string,
  toDate: string,
): CalendarResponse {
  if (response.status !== "ready") return response;
  const found = findBlock(response, blockId);
  if (found === null || found.date === toDate) return response;
  if (!response.days.some((day) => day.local_date === toDate)) return response;

  const moved: DayBlock = {
    ...found.block,
    block: { ...found.block.block, scheduled_date: toDate },
  };

  return mapDays(response, (day) => {
    if (day.local_date === found.date) {
      return {
        ...day,
        is_user_override: true,
        blocks: day.blocks.filter((entry) => entry.block.block_id !== blockId),
      };
    }
    if (day.local_date === toDate) {
      return { ...day, is_user_override: true, blocks: [...day.blocks, moved] };
    }
    return day;
  });
}

/** §12.4: removing a block is a day edit that omits it from the member list. */
export function applyRemoveBlock(
  response: CalendarResponse,
  date: string,
  blockId: string,
): CalendarResponse {
  return mapDays(response, (day) =>
    day.local_date === date
      ? {
          ...day,
          is_user_override: true,
          blocks: day.blocks.filter(
            (entry) => entry.block.block_id !== blockId,
          ),
        }
      : day,
  );
}

/**
 * §12.4: replaces ONE block on a day with an edited version of itself — a changed mix, a
 * changed review target. The replacement is provisional because the server will create a
 * new row with a new id.
 *
 * `actual` is carried but `status` is not recomputed: §13 owns block status and this module
 * is not a second copy of it. The settle-invalidate brings back the server's verdict.
 */
export function applyBlockEdit(
  response: CalendarResponse,
  date: string,
  blockId: string,
  edited: DayBlock["block"],
): CalendarResponse {
  return mapDays(response, (day) =>
    day.local_date === date
      ? {
          ...day,
          is_user_override: true,
          blocks: day.blocks.map((entry) =>
            entry.block.block_id === blockId
              ? {
                  ...entry,
                  block: { ...edited, block_id: nextProvisionalId() },
                }
              : entry,
          ),
        }
      : day,
  );
}

/**
 * §12.6 "Do it now": a copy of a missed block is appended to today with NO progress, because
 * the copy is fresh work. The source block on its past day is left exactly as it was — the
 * student did not do it, and the plan is a record of that.
 */
export function applyDoItNow(
  response: CalendarResponse,
  sourceBlockId: string,
  today: string,
): CalendarResponse {
  if (response.status !== "ready") return response;
  const found = findBlock(response, sourceBlockId);
  if (found === null) return response;
  if (!response.days.some((day) => day.local_date === today)) return response;

  const copy: DayBlock = {
    block: {
      ...found.block.block,
      block_id: nextProvisionalId(),
      scheduled_date: today,
      derived_from_block_id: sourceBlockId,
      source: "student",
    },
    actual: 0,
    progress: 0,
    status: "scheduled",
  };

  return mapDays(response, (day) =>
    day.local_date === today
      ? { ...day, is_user_override: true, blocks: [...day.blocks, copy] }
      : day,
  );
}

/**
 * §12.7: dismissing the plan-updated banner clears it locally the moment it is pressed. The
 * acknowledgement itself is monotonic server-side, so a failed write leaves the watermark
 * where it was and the banner returns on the next read — which is the correct outcome, not
 * a lost one.
 */
export function applyAcknowledge(response: CalendarResponse): CalendarResponse {
  if (response.status !== "ready") return response;
  return { ...response, latest_unacknowledged_nonstudent_change: null };
}
