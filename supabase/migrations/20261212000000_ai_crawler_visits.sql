-- ============================================================================
-- AI crawler visits: daily counts by bot and path, for the Monday growth report.
--
-- @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
--       item 4 ("Record visits from GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User,
--       PerplexityBot, Perplexity-User, Google-Extended, Applebot-Extended, Bytespider and CCBot:
--       path, bot, date. Count by bot and path. No IPs, no personal data. Add a weekly line to the
--       Monday Slack growth report: AI bot visits by bot and top 5 paths."); CLAUDE.md privacy
--       invariant (no tokens, no personal data)] | @implemented [2026-11-28]
--
-- plain English:
--   ai_crawler_visits — one row per (America/Chicago day, bot, path) with a count. Nothing else:
--     no IP address, no User-Agent string, no cookie, no person. The path is one the server has
--     already reduced to a public page, its Markdown copy, /llms.txt, /robots.txt, /sitemap.xml or
--     '(other)' (shared/seo/ai-crawlers.ts `countedPath`), so a token in a URL is never stored.
--   record_ai_crawler_visit(bot, path) — adds one visit to today's row (insert or increment, in
--     one statement, so two visits at once both count).
--   ai_crawler_weekly(week_start) — the Monday–Sunday week the growth report covers
--     (growth_report_week_start): visits by bot, the 5 most visited paths, and the total.
--
-- Days are America/Chicago, like the growth report's weeks.
--
-- Security: both functions are SECURITY INVOKER and callable by service_role only (the
--   CRON_SECRET-gated internal route and the growth report); EXECUTE is revoked from PUBLIC, anon
--   and authenticated. The table has RLS on, no policies, and grants to service_role only.
--
-- Mutations: none target an existing function body; every object here is new.
--
-- OWNER-RUN. Karl applies to prod. DO NOT auto-apply. LYCEON-MIGRATION-REVIEWED
--
-- rollback (in this order):
--   DROP FUNCTION IF EXISTS public.ai_crawler_weekly(date);
--   DROP FUNCTION IF EXISTS public.record_ai_crawler_visit(text, text);
--   DROP TABLE IF EXISTS public.ai_crawler_visits;
-- ============================================================================

BEGIN;

CREATE TABLE public.ai_crawler_visits (
  visit_date date    NOT NULL,
  bot        text    NOT NULL CHECK (bot IN (
               'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-User',
               'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended',
               'Bytespider', 'CCBot')),
  path       text    NOT NULL CHECK (
               path = '(other)'
               OR (path ~ '^/[a-z0-9./-]*$' AND char_length(path) <= 200)),
  visits     integer NOT NULL DEFAULT 1 CHECK (visits > 0),
  PRIMARY KEY (visit_date, bot, path)
);
COMMENT ON TABLE public.ai_crawler_visits IS
  'AI crawler visits per America/Chicago day, bot and public path (owner brief "AI visibility", 2026-11-28). Counts only: no IP, no User-Agent string, nothing about a person.';
ALTER TABLE public.ai_crawler_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_crawler_visits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ai_crawler_visits TO service_role;

CREATE OR REPLACE FUNCTION public.record_ai_crawler_visit(p_bot text, p_path text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  INSERT INTO public.ai_crawler_visits (visit_date, bot, path, visits)
  VALUES ((now() AT TIME ZONE 'America/Chicago')::date, p_bot, p_path, 1)
  ON CONFLICT (visit_date, bot, path)
  DO UPDATE SET visits = public.ai_crawler_visits.visits + 1;
$$;

CREATE OR REPLACE FUNCTION public.ai_crawler_weekly(p_week_start date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH week AS (
    SELECT bot, path, visits
      FROM public.ai_crawler_visits
     WHERE visit_date >= p_week_start AND visit_date < p_week_start + 7
  )
  SELECT jsonb_build_object(
    'week_start', to_char(p_week_start, 'YYYY-MM-DD'),
    'total', COALESCE((SELECT sum(visits) FROM week), 0)::integer,
    'by_bot', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('bot', bot, 'visits', n) ORDER BY n DESC, bot)
        FROM (SELECT bot, sum(visits)::integer AS n FROM week GROUP BY bot) b), '[]'::jsonb),
    'top_paths', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('path', path, 'visits', n) ORDER BY n DESC, path)
        FROM (SELECT path, sum(visits)::integer AS n FROM week GROUP BY path
               ORDER BY n DESC, path LIMIT 5) p), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.record_ai_crawler_visit(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ai_crawler_weekly(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_crawler_visit(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.ai_crawler_weekly(date) TO service_role;

COMMIT;
