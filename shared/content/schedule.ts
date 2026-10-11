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
