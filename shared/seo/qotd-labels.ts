/**
 * Labels for a Question of the Day archive day: its date and its section/domain line.
 *
 * Moved out of public-meta.ts on 2026-10-05 (SEO Wave 3) so the pages that show them do not pull
 * every page's metadata and content into their bundle; public-meta.ts re-exports both.
 */
import type { QotdArchiveResponse } from "../../packages/shared/src/qotd-schema";

const SECTION_NAME: Record<"M" | "RW", string> = {
  M: "Math",
  RW: "Reading and Writing",
};

/** "2026-10-04" -> "October 4, 2026" (UTC, so the label never shifts with the build machine's zone). */
export function formatQotdDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** The section and domain line a past day is labelled with, e.g. "Math: Algebra". */
export function qotdTopic(day: QotdArchiveResponse): string {
  return `${SECTION_NAME[day.question.section_code]}: ${day.question.domain}`;
}
