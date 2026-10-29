/**
 * Every pipeline blog post, one import per post.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.3 (not prerendered, not in the sitemap or index, 404 before
 *       its date)] | @implemented [2026-10-11]
 *
 * plain English: add a post by adding `shared/content/posts/<slug>.ts` and one import line here.
 * At BUILD time, the content-schedule Vite plugin replaces the module of every post that is not
 * yet public (unapproved, or `publishAt` still ahead) with `export default null`, so its text never
 * reaches the browser or the prerender bundle; that is why the list is typed `| null` and filtered
 * where it is read (shared/content/blog.ts). Anywhere else (tests, the server, scripts) the full
 * list is present and visibility is decided by shared/content/schedule.ts.
 */
import type { ScheduledPostSpec } from "./types";
import howLongIsTheSat from "./how-long-is-the-sat";
import howToRegisterForTheSat from "./how-to-register-for-the-sat";
import lastMinuteSatPrep from "./last-minute-sat-prep";
import satDeviceRequirements from "./sat-device-requirements";
import satFeeWaiver from "./sat-fee-waiver";
import satGrammarQuestions from "./sat-grammar-questions";
import satMathFormulas from "./sat-math-formulas";
import twoWeekSatStudyPlan from "./two-week-sat-study-plan";
import whatToBringToTheSat from "./what-to-bring-to-the-sat";

export const SCHEDULED_POST_SPECS: ReadonlyArray<ScheduledPostSpec | null> = [
  // 2026-W43
  howToRegisterForTheSat,
  satFeeWaiver,
  twoWeekSatStudyPlan,
  // 2026-W44
  satGrammarQuestions,
  satMathFormulas,
  satDeviceRequirements,
  // 2026-W45
  whatToBringToTheSat,
  lastMinuteSatPrep,
  howLongIsTheSat,
];
