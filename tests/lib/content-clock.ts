/**
 * The one fixed "now" for tests that assert on which blog posts are public.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.3 (a post is public only once approved AND its publishAt has
 *       arrived)] | @implemented [2026-10-20]
 *
 * plain English: `BLOG_POSTS` / `BLOG_PAGES` (shared/content/blog.ts) are computed from the clock
 * when the module loads, so any test that counts or lists the live posts changes its answer the
 * moment a scheduled post goes public. It failed exactly that way when "How to Register for the
 * SAT" went live at 2026-10-19 07:00 Chicago, and would again on Oct 21 and Oct 23. A test that
 * calls `pinContentClock()` from `vi.hoisted` (before any import is evaluated) sees `Date` frozen at
 * CONTENT_FIXTURE_NOW, the same instant as the prerendered-site fixture's QOTD clock, so the live
 * set is the five C4 posts on every run, on any day.
 *
 * Only `Date` is faked; timers stay real, so builds and async fixtures run as before. Tests that
 * exercise the schedule itself still pass explicit instants to `publishedBlogPosts(now, ...)`.
 */
import { vi } from "vitest";
import { QOTD_FIXTURE_NOW } from "./qotd-fixture";

export const CONTENT_FIXTURE_NOW: Date = QOTD_FIXTURE_NOW;

export function pinContentClock(): void {
  vi.useFakeTimers({ toFake: ["Date"], now: CONTENT_FIXTURE_NOW });
}
