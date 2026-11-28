/**
 * AI crawler visits: the bots counted, what the middleware reports, and the weekly counts.
 *
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       item 4; supabase/migrations/20261212000000_ai_crawler_visits.sql (the table's CHECK
 *       carries the same list)] | @implemented [2026-11-28]
 *
 * plain English: one list of the AI crawlers, by the token their User-Agent carries; the body the
 * routing middleware posts for one visit (a bot and a path, nothing else); and the week's counts
 * `ai_crawler_weekly` returns for the growth report, parsed at the boundary.
 */
import { z } from "zod";

/** The AI crawlers counted (owner brief item 4). */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
] as const;

export const aiCrawlerSchema = z.enum(AI_CRAWLERS);
export type AiCrawler = z.infer<typeof aiCrawlerSchema>;

/** A counted path: a public path, or "(other)". Never a query string. */
export const aiCrawlerPathSchema = z.union([
  z.literal("(other)"),
  z
    .string()
    .max(200)
    .regex(/^\/[a-z0-9./-]*$/),
]);

/** What the middleware posts for one visit. */
export const aiCrawlerVisitSchema = z
  .object({ bot: aiCrawlerSchema, path: aiCrawlerPathSchema })
  .strict();
export type AiCrawlerVisit = z.infer<typeof aiCrawlerVisitSchema>;

const count = z.number().int().min(0);

/** `ai_crawler_weekly(week_start)`: the week's visits by bot and its 5 most visited paths. */
export const aiCrawlerWeekSchema = z
  .object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    total: count,
    by_bot: z.array(z.object({ bot: aiCrawlerSchema, visits: count }).strict()),
    top_paths: z
      .array(z.object({ path: aiCrawlerPathSchema, visits: count }).strict())
      .max(5),
  })
  .strict();
export type AiCrawlerWeek = z.infer<typeof aiCrawlerWeekSchema>;
