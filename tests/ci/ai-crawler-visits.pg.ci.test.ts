/**
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       item 4; supabase/migrations/20261212000000_ai_crawler_visits.sql] | @implemented [2026-11-28]
 *
 * plain English: the counts on real Postgres, the database every migration builds:
 *   * each call adds one visit to today's (bot, path) row, and calls at once all count;
 *   * the table refuses a bot that is not listed, and a path that is not a public path (a query
 *     string, a capital letter, an "@", or anything over 200 characters);
 *   * `ai_crawler_weekly` counts only the Monday–Sunday week asked for, by bot, with the 5 most
 *     visited paths, and its output parses with the schema the growth report uses;
 *   * neither function, nor the table, is open to anon or authenticated: service_role only;
 *   * the table holds no column for an IP, a User-Agent or a person.
 */
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aiCrawlerWeekSchema } from "../../packages/shared/src/ai-crawler-schema";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const DB_NAME = "ai_crawler_visits_ci";
let pg: Client;

async function record(bot: string, path: string): Promise<void> {
  await pg.query("SELECT public.record_ai_crawler_visit($1, $2)", [bot, path]);
}

async function rows(): Promise<
  { bot: string; path: string; visits: number }[]
> {
  return (
    await pg.query(
      "SELECT bot, path, visits FROM public.ai_crawler_visits ORDER BY bot, path",
    )
  ).rows;
}

describe.skipIf(!PG_AVAILABLE)("AI crawler visits (real Postgres)", () => {
  beforeAll(async () => {
    pg = await bootstrapPgDatabase(DB_NAME);
  }, 180_000);

  afterAll(async () => {
    await pg?.end();
  });

  it("each visit adds one to today's row; simultaneous visits all count", async () => {
    await pg.query("DELETE FROM public.ai_crawler_visits");
    await record("GPTBot", "/parent.md");
    await record("GPTBot", "/parent.md");
    await Promise.all(
      Array.from({ length: 5 }, () => record("ClaudeBot", "/")),
    );
    await record("ClaudeBot", "(other)");
    expect(await rows()).toEqual([
      { bot: "ClaudeBot", path: "(other)", visits: 1 },
      { bot: "ClaudeBot", path: "/", visits: 5 },
      { bot: "GPTBot", path: "/parent.md", visits: 2 },
    ]);
    const today = (
      await pg.query(
        "SELECT DISTINCT visit_date = (now() AT TIME ZONE 'America/Chicago')::date AS today FROM public.ai_crawler_visits",
      )
    ).rows;
    expect(today).toEqual([{ today: true }]);
  });

  it("refuses an unlisted bot and any path that is not a public path", async () => {
    for (const [bot, path] of [
      ["Googlebot", "/"],
      ["GPTBot", "/parent?ref=x"],
      ["GPTBot", "/Parent"],
      ["GPTBot", "/join/someone@example.com"],
      ["GPTBot", "parent"],
      ["GPTBot", `/${"a".repeat(200)}`],
    ] as const) {
      await expect(record(bot, path), `${bot} ${path}`).rejects.toThrow(
        /check constraint/,
      );
    }
  });

  it("the week's counts: that week only, by bot, top 5 paths", async () => {
    await pg.query("DELETE FROM public.ai_crawler_visits");
    const week = "2026-11-23"; // a Monday
    const insert = (date: string, bot: string, path: string, visits: number) =>
      pg.query(
        "INSERT INTO public.ai_crawler_visits (visit_date, bot, path, visits) VALUES ($1, $2, $3, $4)",
        [date, bot, path, visits],
      );
    await insert("2026-11-22", "GPTBot", "/", 100); // Sunday before: not this week
    await insert("2026-11-23", "GPTBot", "/", 10); // Monday
    await insert("2026-11-29", "GPTBot", "/parent", 4); // Sunday
    await insert("2026-11-30", "ClaudeBot", "/", 100); // next Monday: not this week
    await insert("2026-11-25", "ClaudeBot", "/parent", 3);
    await insert("2026-11-25", "ClaudeBot", "/llms.txt", 6);
    await insert("2026-11-26", "CCBot", "/blog", 2);
    await insert("2026-11-26", "CCBot", "/trust", 1);
    await insert("2026-11-27", "CCBot", "/contact", 1);
    const { rows: out } = await pg.query(
      "SELECT public.ai_crawler_weekly($1::date) AS week",
      [week],
    );
    const parsed = aiCrawlerWeekSchema.parse(out[0]?.week);
    expect(parsed).toEqual({
      week_start: week,
      total: 27,
      by_bot: [
        { bot: "GPTBot", visits: 14 },
        { bot: "ClaudeBot", visits: 9 },
        { bot: "CCBot", visits: 4 },
      ],
      top_paths: [
        { path: "/", visits: 10 },
        { path: "/parent", visits: 7 },
        { path: "/llms.txt", visits: 6 },
        { path: "/blog", visits: 2 },
        { path: "/contact", visits: 1 },
      ],
    });
    const empty = await pg.query(
      "SELECT public.ai_crawler_weekly('2020-01-06'::date) AS week",
    );
    expect(aiCrawlerWeekSchema.parse(empty.rows[0]?.week)).toEqual({
      week_start: "2020-01-06",
      total: 0,
      by_bot: [],
      top_paths: [],
    });
  });

  it("is service_role only, and stores nothing about a person", async () => {
    const privilege = async (sql: string): Promise<boolean> =>
      (await pg.query(`SELECT ${sql} AS ok`)).rows[0]?.ok === true;
    for (const role of ["anon", "authenticated"]) {
      expect(
        await privilege(
          `has_function_privilege('${role}', 'public.record_ai_crawler_visit(text, text)', 'EXECUTE')`,
        ),
      ).toBe(false);
      expect(
        await privilege(
          `has_function_privilege('${role}', 'public.ai_crawler_weekly(date)', 'EXECUTE')`,
        ),
      ).toBe(false);
      expect(
        await privilege(
          `has_table_privilege('${role}', 'public.ai_crawler_visits', 'SELECT')`,
        ),
      ).toBe(false);
    }
    expect(
      await privilege(
        "has_function_privilege('service_role', 'public.record_ai_crawler_visit(text, text)', 'EXECUTE')",
      ),
    ).toBe(true);
    const columns = (
      await pg.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ai_crawler_visits' ORDER BY ordinal_position",
      )
    ).rows.map((r: { column_name: string }) => r.column_name);
    expect(columns).toEqual(["visit_date", "bot", "path", "visits"]);
    const rls = await pg.query(
      "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ai_crawler_visits'::regclass",
    );
    expect(rls.rows[0]?.relrowsecurity).toBe(true);
  });
});
