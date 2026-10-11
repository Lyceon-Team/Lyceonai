/**
 * The daily content publish job: rebuild the site only on a day a scheduled post goes live.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §3 ("3 a week: Monday, Wednesday and Friday, 07:00
 *       America/Chicago"), §8.3, §8.4 ("a daily job triggers the production deploy hook only on
 *       days when an item's date arrives, so scheduled items go live without manual action"),
 *       §8.6 (never publishes unapproved content); owner answer on Doc 10B Phase 1 Step 0, item 5
 *       (Karl, 2026-10-11): "07:00–07:59 go-live is fine"] | @implemented [2026-10-11]
 *
 * plain English: Vercel runs the cron twice a day, at 12:xx and 13:xx UTC, because Chicago is
 * UTC-5 in summer and UTC-6 in winter and a Hobby-plan cron fires somewhere inside its hour. Each
 * run acts only when the Chicago hour is 7, so exactly one run a day can act, in either season, and
 * no state needs storing. It acts only when an APPROVED post's `publishAt` falls on today and has
 * arrived (shared/content/schedule.ts, the same rule the build uses); then it posts the deploy
 * hook, and the build that follows includes the post. Any other day it does nothing.
 *
 * edge cases:
 *  - An unapproved post never triggers a build (its cycle has no merge stamp).
 *  - No hook configured: the decision is logged and nothing is deployed (`skipped_no_hook`).
 *  - A hook failure is logged at ERROR; the run reports `failed` so the cron route returns 500.
 */
import type { BlogPost } from "../../../shared/content/blog";
import {
  CONTENT_PUBLISH_HOUR,
  chicagoHour,
  isPagePublic,
} from "../../../shared/content/schedule";
import { chicagoToday } from "../../../shared/sat-test-dates";
import {
  triggerDeployHook,
  type DeployHookOutcome,
} from "../../lib/deploy-hook";
import { logger } from "../../logger";

export type ContentPublishDecision =
  | {
      action: "skip";
      reason: "not_publish_hour" | "nothing_due";
      today: string;
      chicagoHour: number;
    }
  | { action: "deploy"; due: string[]; today: string; chicagoHour: number };

/** Pure: whether this run rebuilds the site, and for which posts. */
export function decideContentPublish(
  posts: readonly BlogPost[],
  now: Date,
): ContentPublishDecision {
  const today = chicagoToday(now);
  const hour = chicagoHour(now);
  if (hour !== CONTENT_PUBLISH_HOUR) {
    return {
      action: "skip",
      reason: "not_publish_hour",
      today,
      chicagoHour: hour,
    };
  }
  const due = posts
    .filter(
      (p) =>
        p.page.publishAt?.slice(0, 10) === today && isPagePublic(p.page, now),
    )
    .map((p) => p.slug)
    .sort();
  return due.length === 0
    ? { action: "skip", reason: "nothing_due", today, chicagoHour: hour }
    : { action: "deploy", due, today, chicagoHour: hour };
}

export type ContentPublishSummary = {
  decision: ContentPublishDecision;
  deploy: DeployHookOutcome | "not_needed";
};

export async function runContentPublish(params: {
  posts: readonly BlogPost[];
  now: Date;
  deployHookUrl: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<ContentPublishSummary> {
  const decision = decideContentPublish(params.posts, params.now);
  const deploy =
    decision.action === "deploy"
      ? await triggerDeployHook(
          params.deployHookUrl,
          "CONTENT",
          params.fetchImpl,
        )
      : "not_needed";
  // Post slugs are public URLs on the day they go live; no content and no personal data is logged.
  const fields = {
    today: decision.today,
    chicagoHour: decision.chicagoHour,
    action: decision.action,
    ...(decision.action === "skip"
      ? { reason: decision.reason }
      : { due: decision.due }),
    deploy,
  };
  if (deploy === "failed") {
    logger.error(
      "CONTENT",
      "content_publish_deploy_failed",
      "Content publish deploy hook failed",
      undefined,
      fields,
    );
  } else {
    logger.info(
      "CONTENT",
      "content_publish_run",
      "Content publish run",
      fields,
    );
  }
  return { decision, deploy };
}
