/**
 * The skeleton of a monthly content plan: the month's SAT calendar and every publish slot, with
 * the days to the next test, ready for the AI CMO to fill in.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3A.1-2 ("every monthly calendar shows the days remaining to
 *       each upcoming test and lines up content with them"), §8.1, §8.7 (monthly plan, 20th);
 *       owner brief "Doc 10B Phase 1" (Karl, 2026-10-11) scope 6-7] | @implemented [2026-10-11]
 *
 * Usage: pnpm exec tsx scripts/content/plan-skeleton.ts 2026-11 > content/batches/2026-11-plan/PLAN.md
 *
 * plain English: every SAT date in the plan comes from shared/sat-test-dates.ts (College Board's
 * published dates, cited), never typed by hand. The skeleton has two tables: the month's SAT
 * events (test days, registration and late-registration deadlines, score releases) with their
 * sources, and the Monday/Wednesday/Friday 07:00 slots grouped by weekly cycle, each with the
 * next test and the days to it. The topic columns are left for the plan to fill in.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SAT_DATES_SOURCE_URL,
  SAT_SCORE_RELEASE_SOURCE_URL,
  SAT_TEST_DATES,
  daysUntil,
  formatSatTestDate,
  satCalendarEvents,
  type SatCalendarEventKind,
} from "../../shared/sat-test-dates";
import { isoWeekCycle, publishSlots } from "../../shared/content/schedule";

const EVENT_LABEL: Record<SatCalendarEventKind, string> = {
  registration_deadline: "Registration deadline",
  late_registration_deadline: "Late registration and changes deadline",
  test_day: "SAT test day",
  scores_released: "Scores released (students)",
};

/** The last day of `month` (`YYYY-MM`). */
/** The month's last day, `YYYY-MM-DD`. */
export function lastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y ?? 1970, m ?? 1, 0));
  return d.toISOString().slice(0, 10);
}

/** `2026-11` → `November 2026`. */
export function monthTitle(month: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

/** The next SAT test on or after `date`, or null past the published list. */
export function nextTest(date: string): string | null {
  return SAT_TEST_DATES.find((t) => t.date >= date)?.date ?? null;
}

export function planSkeleton(month: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error(`month must be YYYY-MM, got "${month}"`);
  const first = `${month}-01`;
  const last = lastDay(month);
  const monthName = monthTitle(month);

  const out: string[] = [
    `# Content plan: ${monthName} (${month}-plan)`,
    "",
    "Proposed by Claude (AI CMO skill) for Karl's approval by the 25th (Doc 10B §8.1). Karl's merge of",
    "this pull request approves the calendar; each weekly batch is still approved on its own.",
    "",
    "## SAT calendar this month",
    "",
    `Sources: College Board, [SAT dates and deadlines](${SAT_DATES_SOURCE_URL}) and`,
    `[score release dates](${SAT_SCORE_RELEASE_SOURCE_URL}).`,
    "",
    "| Date | Event | For the test on | Days from the 1st |",
    "| --- | --- | --- | --- |",
  ];
  const events = satCalendarEvents(first, last);
  if (events.length === 0)
    out.push("| — | No published SAT dates this month | — | — |");
  for (const e of events) {
    out.push(
      `| ${formatSatTestDate(e.date)} | ${EVENT_LABEL[e.kind]} | ${formatSatTestDate(e.test_date)} | ${daysUntil(first, e.date)} |`,
    );
  }
  out.push(
    "",
    "## Publish slots",
    "",
    "Monday, Wednesday and Friday at 7:00 a.m. Central (Doc 10B §3). One row per post; each weekly",
    "batch is produced the Wednesday before its week.",
    "",
    "| Cycle | Publishes | Next test (days to it) | Slug | Target keyword | Audience | Search intent | Why now |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const slot of publishSlots(first, last)) {
    const day = slot.slice(0, 10);
    const test = nextTest(day);
    const toTest = test
      ? `${formatSatTestDate(test)} (${daysUntil(day, test)})`
      : "none published";
    out.push(
      `| ${isoWeekCycle(day)} | ${formatSatTestDate(day)} | ${toTest} |  |  |  |  |  |`,
    );
  }
  return `${out.join("\n")}\n`;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.chdir(ROOT);
  process.stdout.write(planSkeleton(process.argv[2] ?? ""));
}
