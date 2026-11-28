# AI visibility — runbook

@spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28) items 1-5] | @implemented [2026-11-28]

What it does: every public page also exists as clean Markdown, `/llms.txt` lists them, and visits from AI crawlers are counted (bot, path, day) for the Monday growth report.

## Markdown copies and llms.txt

- **Which pages.** Every page in `sitemap.xml` (the indexable prerendered routes of `infra/route-surface-classification.yaml`). `/start` is noindex and has none. `/digital-sat` is a 301 to `/online-sat-prep`, so its copy is `/online-sat-prep.md`.
- **Where.** The page's path + `.md` (`/parent.md`, `/blog/<slug>.md`, `/sat-question-of-the-day/<date>.md`); the homepage is `/index.md`. Each page's head links its copy: `<link rel="alternate" type="text/markdown" href="https://lyceon.ai/<path>.md">`.
- **How.** The prerender (`client/src/prerender/entry-server.tsx`) converts each page's own rendered `<main>` to Markdown (`shared/seo/markdown-twin.ts`), in the same build step that writes its HTML. So a copy cannot say anything its page does not, and a page that cannot be converted fails the build.
- **Same for everyone.** They are static files: every visitor, person or bot, gets the same bytes. Nothing is served only to bots.
- **llms.txt** lists every copy with its page's own `<title>` and meta description (no new copy), grouped Pages / Blog / SAT Question of the Day / Legal.
- **Checks.** `pnpm run gate:seo-output` fails unless every sitemap URL has a copy, links it, and is in `llms.txt`. `tests/ci/ai-visibility.markdown.test.ts` compares each copy with its page's text, word for word, through a different HTML parser.

## AI crawler counts

- **Counted:** GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, Bytespider, CCBot, by the token in the User-Agent (`packages/shared/src/ai-crawler-schema.ts`).
  - Google-Extended and Applebot-Extended are robots.txt tokens, not user agents (Google and Apple crawl as Googlebot and Applebot), so their count stays 0.
  - User-Agents can be faked: these are visits that claim to be these crawlers.
- **How.** `middleware.ts` (Vercel Routing Middleware) runs on pages, copies, `llms.txt`, `robots.txt` and `sitemap.xml`. It always passes the request through unchanged. For an AI crawler only, it posts `{bot, path}` after the response, to `POST /api/internal/ai-crawler-visit` (CRON_SECRET), which adds one to `public.ai_crawler_visits` (`record_ai_crawler_visit`).
- **What is stored.** The America/Chicago day, the bot, the path and a count. No IP, no User-Agent string, nothing about a person. The path is a public page, its copy, one of the three site files, or `(other)`, so a path that can carry a token (`/join/...`) and anything after `?` are never stored.
- **Report.** The Monday growth report (#social) adds one line for the same week: total AI bot visits, by bot, and the top 5 paths (`ai_crawler_weekly`). If the counts cannot be read, the line says "not available" and the rest of the report still posts.

## robots.txt

The `User-agent: *` group already allows all of them. They are deliberately not given groups of their own: a crawler named in its own group ignores `*`, and would lose the `/api/` and `/auth/` disallows.

## Owner actions

1. Apply `supabase/migrations/20261212000000_ai_crawler_visits.sql`. Until then the report's AI line reads "not available" and the internal route answers 500 (logged; visitors are unaffected).
2. After the deploy, on the preview or production URL:
   - `curl -sI https://lyceon.ai/parent.md` shows 200 and `content-type: text/markdown; charset=utf-8`;
   - `curl -s https://lyceon.ai/llms.txt` lists the copies;
   - `curl -s -A "GPTBot/1.2" https://lyceon.ai/parent.md | sha256sum` equals the same with a browser User-Agent.
   - The middleware is running if the Vercel deployment's Functions list shows the middleware.
3. Read-only check that visits arrive, the day after the deploy:

```sql
SELECT visit_date, bot, sum(visits) FROM public.ai_crawler_visits
 WHERE visit_date >= current_date - 7 GROUP BY 1, 2 ORDER BY 1, 3 DESC;
```
