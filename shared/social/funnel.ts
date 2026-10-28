/**
 * One funnel for every social post: the `/start` page, its tagged links and the lines that point
 * at it.
 *
 * @spec [owner brief "One funnel for every social post: /start + CTAs + weekly growth report"
 *       (Karl, 2026-10-28) items 1-2; Karl's answer the same day on the free-plan question:
 *       "Reword to what's free" (the study calendar is a paid-plan feature, client/src/lib/
 *       plan-copy.ts PLAN_PAID_ADDS, so "free study plan" is reworded to what the free plan
 *       includes); Public Disclosure Doctrine 3 (the Dec 5 date is College Board's, cited where it
 *       is shown: shared/sat-test-dates.ts) and 5 (this wording needs Karl's written approval
 *       before it publishes)] | @implemented [2026-10-28]
 *
 * plain English: every social surface sends people to lyceon.ai/start with a tag naming the
 * channel and the campaign (`?utm_source=reddit&utm_campaign=qotd`), which the sign-up records as
 * signup_channel / signup_campaign. Until the cohort's test day (Dec 5, 2026) the copy speaks to
 * people taking that test; from the next day (America/Chicago, the site's day) it switches to the
 * evergreen line, with no deploy needed. All the wording lives here so the page, the QOTD captions
 * and the worked-example captions cannot drift apart.
 *
 * Edge cases: on test day itself the dated line still shows (people are still "taking" it that
 * morning); a date string that is not YYYY-MM-DD compares as text, so callers pass chicagoToday().
 */
import type {
  SignupCampaign,
  SignupChannel,
} from "../../packages/shared/src/analytics-consent-schema";
import { SAT_TEST_DATES, type SatTestDate } from "../sat-test-dates";

export const START_PATH = "/start";
export const START_HOST = "lyceon.ai";

/** The SAT administration the cohort copy names: a confirmed College Board date. */
export const START_COHORT_DATE = "2026-12-05";

export type FunnelPhase = "cohort" | "evergreen";

/** "cohort" through the test day (Chicago), "evergreen" from the day after. */
export function funnelPhase(chicagoToday: string): FunnelPhase {
  return chicagoToday <= START_COHORT_DATE ? "cohort" : "evergreen";
}

/** "Dec 5": the cohort date as the copy says it. */
export function cohortDateLabel(): string {
  const [y, m, d] = START_COHORT_DATE.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)));
}

/** The College Board entry the cohort date comes from (its source is shown beside the date). */
export function cohortTestDate(): SatTestDate | undefined {
  return SAT_TEST_DATES.find((t) => t.date === START_COHORT_DATE);
}

/** /start's headline. */
export function startHeadline(phase: FunnelPhase): string {
  return phase === "cohort"
    ? `Taking the SAT ${cohortDateLabel()}? Find your blind spots free before test day.`
    : "Find your SAT blind spots, free.";
}

/**
 * What the free plan gives, under the headline. The Help FAQ's free sentence without "unlimited
 * review": "unlimited" is banned on public pages (tests/ci/public-copy-claims.contract.test.ts,
 * claim F6 (b)), and this lists only what the free plan includes.
 */
export const START_SUBHEAD =
  "Free: Find your blind spots, your projected score and daily practice questions.";

/** The line above today's question on /start. */
export const START_TRY_ONE =
  "Answer today's SAT question below, no account needed. Then sign up free to find your blind spots and keep practising every day.";

/** A link to /start tagged with where it was posted, as people see it (no scheme). */
export function startLink(
  channel: SignupChannel,
  campaign: SignupCampaign,
): string {
  const params = new URLSearchParams({
    utm_source: channel,
    utm_campaign: campaign,
  });
  return `${START_HOST}${START_PATH}?${params.toString()}`;
}

/** The last line of a TikTok caption (links live in the bio there). */
export function bioCtaLine(phase: FunnelPhase): string {
  return phase === "cohort"
    ? `Taking the SAT ${cohortDateLabel()}? Free SAT practice: link in bio`
    : "Free SAT practice: link in bio";
}

/** Instagram: captions cannot link, so people comment and get the tagged link by message. */
export const INSTAGRAM_COMMENT_CTA = "Comment SAT and I'll send you the link";

/** The one-line call to action under a post that can carry a link (Reddit). */
export function linkCtaLine(
  phase: FunnelPhase,
  channel: SignupChannel,
  campaign: SignupCampaign,
): string {
  const lead =
    phase === "cohort"
      ? `Taking the SAT ${cohortDateLabel()}? Free SAT practice:`
      : "Free SAT practice:";
  return `${lead} ${startLink(channel, campaign)}`;
}
