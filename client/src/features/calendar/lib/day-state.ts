/**
 * @spec [Doc_05F_Study_Calendar, §12.4 day edit, §17.2 day controls]
 * @implemented [2026-09-22]
 *
 * plain English: what a day IS, for the two grids and the day menu. One definition, used
 * by Week and Month alike, so the hatched "Day off" and the menu's Block out / Undo label
 * can never disagree about the same date.
 *
 * "BLOCKED OUT" IS NOT A COLUMN. There is no `is_blocked` anywhere, deliberately: blocking
 * out a day IS an edit to an empty member list (§12.4), so the database records it as any
 * other override. The derived pair — the student owns this date AND it holds nothing — is
 * therefore the whole definition, and it is written down once here rather than inline in
 * two grids.
 *
 * A REST DAY IS NOT A DAY OFF. A date outside `study_days_mask` is also empty, and it is
 * not something the student did; it has no override and no Undo. Conflating the two would
 * offer "Undo day off" on a Sunday the student never touched.
 */
import type { ViewDay } from "./view-model";

/** The student cleared this date themselves. */
export function isBlockedOut(day: ViewDay | null): boolean {
  return day !== null && day.isOverride && day.blocks.length === 0;
}

/**
 * Whether a date may carry day controls at all. §12.2 never owns a past date, so offering
 * them there would be offering a control the server refuses.
 */
export function canControlDay(date: string, today: string): boolean {
  return date >= today;
}
