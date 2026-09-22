/**
 * @spec [Doc_05F_Study_Calendar, §16 guardian read (R-08-22), §17.1 layout, §14 derived state]
 * @implemented [2026-09-23]
 *
 * plain English: turns either payload — the student's or the guardian's — into the ONE shape
 * the grid, the month view and the side sheet render. Expected outcome: one set of
 * components draws both surfaces, and the guardian surface is missing its controls because
 * the data has no controls in it, not because a flag was checked in the right places.
 *
 * THIS IS THE GUARDIAN BOUNDARY, ON THE CLIENT. §16 gives a guardian no profile, no target
 * score, no explanation copy and no controls. The server already strips all of that — the
 * guardian payload is its own `.strict()` union that never carried an `explanation_key` at
 * either level. The job here is to not put any of it BACK. So:
 *
 *   - `explanations` is built ONLY in the student branch. The guardian branch has no access
 *     to a key to look copy up with, so it cannot produce a line even by mistake.
 *   - `controls` is a single discriminated value, not a set of booleans. A guardian day is
 *     `{ kind: "read_only" }` and there is no field on it a component could read a Start
 *     handler out of.
 *
 * A boolean `readOnly` prop threaded through eight components is eight chances to forget it.
 * A value that does not contain the thing is zero.
 *
 * trade-offs: the two branches duplicate the field-by-field mapping rather than sharing a
 * spread. That is deliberate and matches `toGuardianCalendarDay` on the server: naming every
 * field means adding one to the student model does not silently reach the guardian view.
 */
import type {
  CalendarDay,
  PlanBlock,
  CalendarReadyResponse,
  CanonicalDomain,
  GuardianCalendarDay,
  GuardianCalendarReadyResponse,
  PlanningEstimates,
} from "@lyceon/shared/calendar";
import { explanationLines } from "../copy/explanations";
import {
  isLaunchableBlockType,
  isStarted,
  minutesLabel,
  titleOf,
  toneOf,
  type BlockTone,
} from "./blocks";

/** What a viewer may do with this calendar. A guardian's value carries no capability at all. */
export type ViewControls = { kind: "editable" } | { kind: "read_only" };

export type ViewMixEntry = { domain: CanonicalDomain; count: number };

export type ViewBlock = {
  blockId: string;
  tone: BlockTone;
  title: string;
  /** "~23 min", or null for a full-length block and for every guardian block. */
  minutes: string | null;
  mix: readonly ViewMixEntry[];
  target: number;
  actual: number;
  /** §13 `actual / target`, already computed server-side. */
  progress: number;
  status: string;
  started: boolean;
  /** §17.6 "why this block". ALWAYS empty on the guardian surface — see the module note. */
  explanations: readonly string[];
  /** Which engines are real enough to Start — see `isLaunchableBlockType`. */
  launchable: boolean;
  /**
   * The block exactly as the plan holds it — needed to build a §12.4 member list, because
   * editing a block means CREATING a replacement with a new scope and dropping the old one.
   *
   * Present ONLY on the student branch. The guardian payload has no such object to give
   * (its blocks are the sanitised `guardianPlanBlockSchema`), so `plan` is `null` there and
   * the editor is not merely hidden from a guardian — it has nothing to operate on.
   */
  plan: PlanBlock | null;
};

export type ViewDay = {
  date: string;
  status: string;
  isStudyDay: boolean;
  /** Absent from the guardian payload — a guardian is not shown that the student edited. */
  isOverride: boolean;
  blocks: readonly ViewBlock[];
  plannedCount: number;
  actualCount: number;
  extraCount: number;
};

export type CalendarViewModel = {
  controls: ViewControls;
  days: readonly ViewDay[];
  facts: CalendarReadyResponse["facts"];
  streak: CalendarReadyResponse["streak"];
};

function toViewBlock(
  entry: CalendarDay["blocks"][number],
  estimates: PlanningEstimates,
): ViewBlock {
  const block = entry.block;
  const mix =
    block.block_type === "practice" && block.scope.level === "domain"
      ? block.scope.mix.map((item) => ({
          domain: item.domain,
          count: item.count,
        }))
      : [];
  const domainKeys =
    block.block_type === "practice" && block.scope.level === "domain"
      ? block.scope.mix.map((item) => item.explanation_key)
      : [];

  return {
    blockId: block.block_id,
    tone: toneOf(block),
    title: titleOf(block),
    minutes: minutesLabel(block, estimates),
    mix,
    target: block.target_count,
    actual: entry.actual,
    progress: entry.progress,
    status: entry.status,
    started: isStarted(entry),
    explanations: explanationLines({
      blockKey: block.explanation_key,
      domainKeys,
    }),
    launchable: isLaunchableBlockType(block.block_type),
    plan: block,
  };
}

/**
 * The guardian block. Note what is NOT here: no `explanations` lookup — there is no key to
 * look one up with, because the guardian payload never carried an `explanation_key` at
 * either level (§16, R-08-22).
 *
 * `minutes` IS here now, from the SAME `estimates` the student's payload carries (owner
 * ruling 2026-09-22). Withholding it was not a protection: §16's exclusions are controls,
 * explanation copy and the target score, and a minute estimate is none of the three. It
 * also produced a bug rather than preventing one — with no estimate, the card fell back to
 * "Full sitting" for every block type on this surface.
 */
function toGuardianViewBlock(
  entry: GuardianCalendarDay["blocks"][number],
  estimates: PlanningEstimates,
): ViewBlock {
  const block = entry.block;
  const mix =
    block.block_type === "practice" && block.scope.level === "domain"
      ? block.scope.mix.map((item) => ({
          domain: item.domain,
          count: item.count,
        }))
      : [];

  return {
    blockId: block.block_id,
    tone: toneOf(block),
    title: titleOf({
      ...block,
      // `titleOf` reads only these three, and the guardian block carries all three.
      block_type: block.block_type,
      target_count: block.target_count,
    } as Parameters<typeof titleOf>[0]),
    minutes: minutesLabel(
      {
        block_type: block.block_type,
        target_count: block.target_count,
      } as Parameters<typeof minutesLabel>[0],
      estimates,
    ),
    mix,
    target: block.target_count,
    actual: entry.actual,
    progress: entry.progress,
    status: entry.status,
    started: isStarted(entry),
    explanations: [],
    launchable: false,
    plan: null,
  };
}

export function studentViewModel(
  response: CalendarReadyResponse,
): CalendarViewModel {
  return {
    controls: { kind: "editable" },
    days: response.days.map((day) => ({
      date: day.local_date,
      status: day.status,
      isStudyDay: day.is_study_day,
      isOverride: day.is_user_override,
      blocks: day.blocks.map((entry) => toViewBlock(entry, response.estimates)),
      plannedCount: day.planned_count,
      actualCount: day.actual_count,
      extraCount: day.extra_count,
    })),
    facts: response.facts,
    streak: response.streak,
  };
}

export function guardianViewModel(
  response: GuardianCalendarReadyResponse,
): CalendarViewModel {
  return {
    controls: { kind: "read_only" },
    days: response.days.map((day) => ({
      date: day.local_date,
      status: day.status,
      isStudyDay: day.is_study_day,
      // The guardian payload has no `is_user_override` (§16: which version owns a date is a
      // control). False, not "unknown" — the day header simply never shows the edited marker.
      isOverride: false,
      blocks: day.blocks.map((entry) =>
        toGuardianViewBlock(entry, response.estimates),
      ),
      plannedCount: day.planned_count,
      actualCount: day.actual_count,
      extraCount: day.extra_count,
    })),
    facts: response.facts,
    streak: response.streak,
  };
}

/** The day at `date`, or null when the loaded range does not cover it. */
export function dayAt(model: CalendarViewModel, date: string): ViewDay | null {
  return model.days.find((day) => day.date === date) ?? null;
}

/** The block with this id and the day it is on, or null. */
export function blockAt(
  model: CalendarViewModel,
  blockId: string,
): { block: ViewBlock; day: ViewDay } | null {
  for (const day of model.days) {
    const block = day.blocks.find((entry) => entry.blockId === blockId);
    if (block !== undefined) return { block, day };
  }
  return null;
}
