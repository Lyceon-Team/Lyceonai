/**
 * When a content page is public: approved, and its publish time (if any) has arrived.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.3 ("An approved item is public only once its date
 *       arrives. Before then it is not prerendered, not in the sitemap or index, and returns
 *       404"), §8.4 (daily rebuild), §2.4 (Karl's approval is the merge of the batch PR); owner
 *       answers on Doc 10B Phase 1 Step 0 (Karl, 2026-10-11): "merge alone counts", "filter future
 *       and unapproved posts at build time", "07:00–07:59 go-live is fine"]
 *       | @implemented [2026-10-11]
 *
 * plain English: ONE pure rule, used by every place that decides visibility: the blog list the
 * site renders (shared/content/blog.ts), the build plugin that keeps withheld posts out of the
 * bundles (vite-plugin-content-schedule.ts via scripts/content/withheld-posts.ts), and the daily
 * publish cron (server/services/content/publish-job.ts). A page is public when it carries Karl's
 * approval AND either has no `publishAt` or `publishAt` is at or before the current America/Chicago
 * wall-clock time. Times are compared as `YYYY-MM-DDTHH:mm` strings in Chicago, so daylight
 * saving never moves a publish time.
 *
 * edge cases:
 *  - An unapproved page is never public, whatever its date.
 *  - Equal times are public (07:00 is live at 07:00).
 */
import { chicagoToday } from "../sat-test-dates";

/** Doc 10B §3: blog posts go live Monday, Wednesday and Friday at 07:00 America/Chicago. */
export const CONTENT_PUBLISH_HOUR = 7;
export const CONTENT_PUBLISH_TIME = "07:00";
export const CONTENT_PUBLISH_WEEKDAYS: readonly string[] = [
  "Monday",
  "Wednesday",
  "Friday",
];

/** Why a `publishAt` is off the §3 cadence (wrong time or weekday), or null when it is on it. */
export function publishAtProblem(publishAt: string): string | null {
  if (publishAt.slice(11) !== CONTENT_PUBLISH_TIME) {
    return `publishAt ${publishAt} is not at ${CONTENT_PUBLISH_TIME} America/Chicago (Doc 10B §3)`;
  }
  const [y, m, d] = publishAt.slice(0, 10).split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
  return CONTENT_PUBLISH_WEEKDAYS.includes(weekday)
    ? null
    : `publishAt ${publishAt} falls on a ${weekday}; posts go out on ${CONTENT_PUBLISH_WEEKDAYS.join(", ")} (Doc 10B §3)`;
}

/** The America/Chicago wall clock at `now`, `YYYY-MM-DDTHH:mm`. */
export function chicagoWallClock(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${chicagoToday(now)}T${hour}:${minute}`;
}

/** The Chicago hour (0–23) at `now`. */
export function chicagoHour(now: Date): number {
  return Number(chicagoWallClock(now).slice(11, 13));
}

export type Schedulable = {
  approved?: { by: string; date: string } | undefined;
  publishAt?: string | undefined;
};

/** Public: approved, and no publish time or one that has arrived (Chicago wall clock). */
export function isPagePublic(page: Schedulable, now: Date): boolean {
  if (!page.approved) return false;
  if (page.publishAt === undefined) return true;
  return page.publishAt <= chicagoWallClock(now);
}

function utcDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/**
 * The weekly cycle a publish date belongs to: its ISO 8601 week, `YYYY-Www` (Doc 10B §8.2: each
 * Wednesday's batch carries the NEXT week's items, so a batch is named for the week it publishes
 * in). ISO weeks start on Monday; week 1 holds the year's first Thursday.
 */
export function isoWeekCycle(date: string): string {
  const d = utcDate(date);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // the Thursday of this week
  const year = d.getUTCFullYear();
  const week = Math.ceil(
    ((d.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7,
  );
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Why a post's `publishAt` is outside its batch's week, or null when it is inside it. */
export function batchWeekProblem(
  batch: string,
  publishAt: string,
): string | null {
  if (!/^\d{4}-W\d{2}$/.test(batch)) return null;
  const week = isoWeekCycle(publishAt.slice(0, 10));
  return week === batch
    ? null
    : `publishAt ${publishAt} is in ${week}, not in its batch ${batch}`;
}

/** Every on-cadence publish slot (`YYYY-MM-DDT07:00`) from `from` to `to` inclusive. */
export function publishSlots(from: string, to: string): string[] {
  const slots: string[] = [];
  for (
    const d = utcDate(from);
    d.getTime() <= utcDate(to).getTime();
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const slot = `${d.toISOString().slice(0, 10)}T${CONTENT_PUBLISH_TIME}`;
    if (publishAtProblem(slot) === null) slots.push(slot);
  }
  return slots;
}
