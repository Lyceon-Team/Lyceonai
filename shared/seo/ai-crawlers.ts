/**
 * AI crawlers: which user agents are counted, and which path a visit is counted under.
 *
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       items 4 and 5; CLAUDE.md Public Disclosure Doctrine 7 (no personal data) and the privacy
 *       invariant (never log tokens)] | @implemented [2026-11-28]
 *
 * plain English: `aiCrawlerFor(userAgent)` names the AI crawler a request's User-Agent claims to
 * be, or null for anything else (a browser, a search engine, an unknown bot). `countedPath(path)`
 * is the path a visit is recorded under: the path itself when it is a public page, its Markdown
 * copy, /llms.txt, /robots.txt or /sitemap.xml, and "(other)" for everything else. So a path that
 * can carry a token (`/join/<token>`, `/auth/...`) or anything typed after a `?` is never stored.
 *
 * What is recorded is the bot's name, that path and the day: no IP address, no User-Agent string,
 * no cookie, nothing about a person. A browser request is never recorded at all.
 *
 * Edge cases:
 *  - User-Agent strings can be faked. These are visits that CLAIM to be these crawlers.
 *  - Google-Extended and Applebot-Extended are robots.txt product tokens, not user agents: Google
 *    and Apple crawl as Googlebot and Applebot and honour these tokens for AI use. They are listed
 *    (the brief names them, and robots.txt allows them), but no request carries them, so their
 *    count stays 0.
 *  - The match is a case-insensitive search for the bot's token in the User-Agent. The tokens do
 *    not contain one another, so the order of the list does not matter.
 *  - `TRACKED_PAGE_PATTERNS` must equal the prerendered rows of
 *    infra/route-surface-classification.yaml; tests/ci/ai-visibility.test.ts fails when a route is
 *    added there and not here.
 */

import {
  AI_CRAWLERS,
  type AiCrawler,
} from "../../packages/shared/src/ai-crawler-schema";

export { AI_CRAWLERS, type AiCrawler };

/** Tokens that never appear in a User-Agent header (see the header). */
export const ROBOTS_ONLY_TOKENS: readonly AiCrawler[] = [
  "Google-Extended",
  "Applebot-Extended",
];

export function aiCrawlerFor(userAgent: string | null): AiCrawler | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  return AI_CRAWLERS.find((bot) => ua.includes(bot.toLowerCase())) ?? null;
}

/** The prerendered routes of the registry (`:param` matches one path segment). */
export const TRACKED_PAGE_PATTERNS = [
  "/",
  "/sat-practice-questions",
  "/sat-practice-questions/math",
  "/sat-practice-questions/reading-and-writing",
  "/sat-practice-questions/math/algebra",
  "/sat-practice-questions/math/advanced-math",
  "/sat-practice-questions/math/problem-solving-and-data-analysis",
  "/sat-practice-questions/math/geometry-and-trigonometry",
  "/sat-practice-questions/reading-and-writing/information-and-ideas",
  "/sat-practice-questions/reading-and-writing/craft-and-structure",
  "/sat-practice-questions/reading-and-writing/expression-of-ideas",
  "/sat-practice-questions/reading-and-writing/standard-english-conventions",
  "/what-is-a-good-sat-score",
  "/what-is-a-good-sat-score/1100",
  "/what-is-a-good-sat-score/1200",
  "/what-is-a-good-sat-score/1300",
  "/what-is-a-good-sat-score/1400",
  "/what-is-a-good-sat-score/1500",
  "/free-sat-practice-test",
  "/online-sat-prep",
  "/how-to-study-for-the-sat",
  "/sat-tutor-cost",
  "/lyceon-vs-sat-tutor",
  "/is-sat-tutoring-worth-it",
  "/blog",
  "/blog/:slug",
  "/start",
  "/sat-question-of-the-day",
  "/sat-question-of-the-day/:date",
  "/trust",
  "/contact",
  "/parent",
  "/legal",
  "/legal/:slug",
] as const;

/** Site files a crawler reads that are not pages. */
const TRACKED_FILES = new Set(["/llms.txt", "/robots.txt", "/sitemap.xml"]);

/** The path every untracked visit is counted under. */
export const OTHER_PATH = "(other)";

/** Longest path recorded; anything longer is "(other)". */
const MAX_PATH_LENGTH = 200;

const PAGE_MATCHERS: readonly RegExp[] = TRACKED_PAGE_PATTERNS.map(
  (pattern) =>
    new RegExp(
      `^${pattern
        .split("/")
        .map((seg) =>
          seg.startsWith(":")
            ? "[a-z0-9][a-z0-9-]*"
            : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/")}$`,
    ),
);

function isTrackedPage(path: string): boolean {
  return PAGE_MATCHERS.some((re) => re.test(path));
}

/**
 * The path a visit is counted under. `rawPath` is the URL's pathname (no query string or fragment);
 * a trailing slash is dropped, and a page's Markdown copy counts as itself plus ".md"
 * (`/index.md` for the homepage).
 */
export function countedPath(rawPath: string): string {
  const path =
    rawPath.length > 1 && rawPath.endsWith("/")
      ? rawPath.slice(0, -1)
      : rawPath;
  if (path.length > MAX_PATH_LENGTH) return OTHER_PATH;
  if (TRACKED_FILES.has(path)) return path;
  if (path === "/index.md") return path;
  if (path.endsWith(".md")) {
    const page = path.slice(0, -".md".length);
    // The homepage's copy is /index.md (above); "/.md" is not a copy of anything.
    return page !== "" && page !== "/" && isTrackedPage(page)
      ? path
      : OTHER_PATH;
  }
  return isTrackedPage(path) ? path : OTHER_PATH;
}
