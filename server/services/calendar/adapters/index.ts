/**
 * The adapter registry — Doc 05F §9.1.
 *
 * @spec [Doc-05F_V1.0 §9.1; Doc_05F_formula_sheet.md §8 item 12]
 * | @implemented [2026-09-18]
 *
 * plain English: one lookup, total over the three engines. A block's engine IS its
 * block type (the `calendar_blocks.block_type` and `calendar_block_launches.engine`
 * CHECKs list the same three strings), so there is no mapping and no default arm
 * that could silently swallow a fourth engine.
 */
import {
  engineOfBlock,
  type CalendarEngine,
  type PlanBlock,
} from "@lyceon/shared";
import type { CalendarEngineAdapter } from "./types";
import { practiceAdapter } from "./practice";
import { reviewAdapter } from "./review";
import { fullLengthAdapter } from "./full-length";

const ADAPTERS: Readonly<Record<CalendarEngine, CalendarEngineAdapter>> = {
  practice: practiceAdapter,
  review: reviewAdapter,
  full_length: fullLengthAdapter,
};

export function adapterFor(engine: CalendarEngine): CalendarEngineAdapter {
  return ADAPTERS[engine];
}

export function adapterForBlock(block: PlanBlock): CalendarEngineAdapter {
  return ADAPTERS[engineOfBlock(block.block_type)];
}

export { ADAPTERS };
export * from "./types";
export { localDayWindowUtc, isKnownTimeZone, localTodayIn } from "./local-day";
