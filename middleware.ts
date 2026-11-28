/**
 * Vercel Routing Middleware: counts AI crawler visits. It never changes a response.
 *
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       item 4] | @implemented [2026-11-28]
 *
 * plain English: the logic and its reasoning live in server/lib/ai-crawler-middleware.ts. This
 * file only wires it to Vercel (`next()` passes the request on unchanged, `waitUntil` sends the
 * count after the response) and says which requests it sees: pages, their Markdown copies,
 * llms.txt, robots.txt and sitemap.xml. It skips the API (including the route it reports to), the
 * auth callback, the built assets and every other static file.
 */
import { next, waitUntil } from "@vercel/functions";
import {
  createAiCrawlerMiddleware,
  reportAiCrawlerVisit,
} from "./server/lib/ai-crawler-middleware";

export const config = {
  runtime: "nodejs",
  matcher: [
    "/((?!api/|api$|auth/|assets/|fonts/|images/|media/|.*\\.(?:js|mjs|css|map|json|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|mp3|mp4|webm|pdf|zip)$).*)",
  ],
};

export default createAiCrawlerMiddleware({
  next: () => next(),
  waitUntil,
  report: (visit, requestUrl) => reportAiCrawlerVisit(visit, requestUrl),
});
