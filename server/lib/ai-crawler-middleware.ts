/**
 * The routing middleware that counts AI crawler visits, without touching the response.
 *
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       items 1 ("Same content for every visitor. Do not serve anything only to bots.") and 4;
 *       CLAUDE.md "Managed-service first" (Vercel Routing Middleware: the public pages are static
 *       files Vercel's CDN serves without reaching our server, so the platform's own request hook
 *       is the one place a visit to them can be seen)] | @implemented [2026-11-28]
 *
 * plain English: Vercel runs this before every page, Markdown copy, llms.txt, robots.txt and
 * sitemap.xml request (middleware.ts `config.matcher`). It always answers `next()`, the same
 * pass-through for every visitor, so a bot and a person get the same bytes for the same URL: the
 * middleware reads the request, it never changes the response. When the User-Agent names one of
 * the AI crawlers, it reports `{bot, path}` to the CRON_SECRET-gated internal route in the
 * background (`waitUntil`), after the response has gone. A browser's request reports nothing.
 *
 * Privacy: the report carries the bot's name and the counted path only (`countedPath`: a public
 * path or "(other)", never a query string). The IP address and the User-Agent string are never
 * read into it, sent or logged.
 *
 * Edge cases:
 *  - No CRON_SECRET: nothing is reported (and the route would refuse it anyway).
 *  - A failed report is logged (the bot and the HTTP status, nothing else) and dropped: a count
 *    is not worth retrying, and the visitor's response never waits on it.
 */
import { logger } from "../logger";
import { aiCrawlerFor, countedPath } from "../../shared/seo/ai-crawlers";
import type { AiCrawlerVisit } from "../../packages/shared/src/ai-crawler-schema";

/** Where a visit is reported (server/routes/internal-cron-routes.ts). */
export const AI_CRAWLER_VISIT_PATH = "/api/internal/ai-crawler-visit";

export type AiCrawlerMiddlewareDeps = {
  /** The pass-through response (`next()` from @vercel/functions). */
  next: () => Response;
  /** Runs work after the response is sent (`waitUntil` from @vercel/functions). */
  waitUntil: (work: Promise<unknown>) => void;
  /** Sends one visit. */
  report: (visit: AiCrawlerVisit, requestUrl: string) => Promise<void>;
};

/** The visit to report for a request, or null for anything that is not an AI crawler. */
export function aiCrawlerVisitFor(request: Request): AiCrawlerVisit | null {
  const bot = aiCrawlerFor(request.headers.get("user-agent"));
  if (bot === null) return null;
  return { bot, path: countedPath(new URL(request.url).pathname) };
}

export function createAiCrawlerMiddleware(
  deps: AiCrawlerMiddlewareDeps,
): (request: Request) => Response {
  return (request: Request): Response => {
    const visit = aiCrawlerVisitFor(request);
    if (visit !== null) deps.waitUntil(deps.report(visit, request.url));
    return deps.next();
  };
}

/** Posts one visit to the internal route on the same deployment. */
export async function reportAiCrawlerVisit(
  visit: AiCrawlerVisit,
  requestUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return;
  try {
    const res = await fetchImpl(new URL(AI_CRAWLER_VISIT_PATH, requestUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(visit),
    });
    if (!res.ok)
      logger.warn(
        "AI_CRAWLERS",
        "ai_crawler_visit_report_refused",
        "The internal route refused an AI crawler visit",
        { bot: visit.bot, status: res.status },
      );
  } catch (err) {
    logger.warn(
      "AI_CRAWLERS",
      "ai_crawler_visit_report_failed",
      "Reporting an AI crawler visit failed",
      { bot: visit.bot, error: err instanceof Error ? err.name : "unknown" },
    );
  }
}
