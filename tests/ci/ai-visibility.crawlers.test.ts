/**
 * @spec [owner brief "AI visibility: markdown copies + AI crawler tracking" (Karl, 2026-11-28)
 *       items 1, 4, 5 and its tests "a request with each bot's user agent is counted", "a normal
 *       browser request is not counted", "bot and human get the same bytes for the same URL"]
 *       | @implemented [2026-11-28]
 *
 * plain English: the whole counting chain, end to end except the database (proved in
 * ai-crawler-visits.pg.ci.test.ts): the real middleware (server/lib/ai-crawler-middleware.ts as
 * middleware.ts wires it, with the real `next()`) reports through the real `reportAiCrawlerVisit`,
 * whose fetch reaches the real internal route, which calls `record_ai_crawler_visit`. Then:
 *   * each bot's real User-Agent string is counted under its own name and the visited path;
 *   * browsers and search engines are never counted (nothing reported, no database call);
 *   * a bot and a person get the same response from the middleware, and the same bytes from a
 *     static server over the real build output;
 *   * a path that can carry a token, or anything after "?", is never stored;
 *   * robots.txt lets every one of these crawlers read the pages, the copies and llms.txt;
 *   * the growth report's AI line.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import express from "express";
import request from "supertest";
import { next } from "@vercel/functions";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AI_CRAWLERS,
  ROBOTS_ONLY_TOKENS,
  TRACKED_PAGE_PATTERNS,
  aiCrawlerFor,
  countedPath,
  OTHER_PATH,
} from "../../shared/seo/ai-crawlers";
import {
  AI_CRAWLER_VISIT_PATH,
  createAiCrawlerMiddleware,
  reportAiCrawlerVisit,
} from "../../server/lib/ai-crawler-middleware";
import type { AiCrawlerVisit } from "../../packages/shared/src/ai-crawler-schema";
import {
  AI_CRAWLERS_NOT_AVAILABLE,
  aiCrawlerLines,
} from "../../server/lib/growth-report";
import { twinFileFor } from "../../shared/seo/markdown-twin";
import { getPrerenderedSite, loadRouteRegistry } from "../lib/prerendered-site";

const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
}));
vi.mock("../../server/middleware/supabase-auth.js", async (orig) => ({
  ...(await orig<object>()),
  getSupabaseAdmin: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpc.calls.push({ name, args });
      return { data: null, error: null };
    },
  }),
}));

/** Each crawler's published User-Agent string (the robots-only tokens have none). */
const BOT_USER_AGENTS: Record<string, string> = {
  GPTBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)",
  "OAI-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  "ChatGPT-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  ClaudeBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  "Claude-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  PerplexityBot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  "Perplexity-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  Bytespider:
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
  CCBot: "CCBot/2.0 (https://commoncrawl.org/faq/)",
};

const BROWSERS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0",
  // A search engine is not an AI crawler either.
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
];

const SECRET = "test-cron-secret";

/** The internal route, as server/index.ts mounts it (JSON body, then the router). */
async function internalApp(): Promise<express.Express> {
  const router = (await import("../../server/routes/internal-cron-routes"))
    .default;
  const app = express();
  app.use(express.json());
  app.use("/api/internal", router);
  return app;
}

/** A fetch that delivers the middleware's report to the real route, through supertest. */
function fetchInto(app: express.Express): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const res = await request(app)
      .post(url.pathname)
      .set("authorization", headers.get("authorization") ?? "")
      .set("content-type", headers.get("content-type") ?? "")
      .send(typeof init?.body === "string" ? init.body : "");
    return new Response(null, { status: res.status });
  }) as typeof fetch;
}

/** The middleware as middleware.ts builds it, with the report awaited for the test. */
function middlewareFor(app: express.Express): {
  handle: (url: string, userAgent: string) => Promise<Response>;
  reported: AiCrawlerVisit[];
} {
  const reported: AiCrawlerVisit[] = [];
  const pending: Promise<unknown>[] = [];
  const mw = createAiCrawlerMiddleware({
    next: () => next(),
    waitUntil: (work) => {
      pending.push(work);
    },
    report: (visit, requestUrl) => {
      reported.push(visit);
      return reportAiCrawlerVisit(visit, requestUrl, fetchInto(app));
    },
  });
  return {
    reported,
    handle: async (url, userAgent) => {
      const res = mw(
        new Request(url, { headers: { "user-agent": userAgent } }),
      );
      await Promise.all(pending.splice(0));
      return res;
    },
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  rpc.calls.length = 0;
});

describe("counting", () => {
  it("lists exactly the eleven crawlers of the brief", () => {
    expect([...AI_CRAWLERS].sort()).toEqual(
      [
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
      ].sort(),
    );
    // Every crawler that sends a User-Agent has one here.
    expect(Object.keys(BOT_USER_AGENTS).sort()).toEqual(
      AI_CRAWLERS.filter((b) => !ROBOTS_ONLY_TOKENS.includes(b)).sort(),
    );
  });

  it("a request with each bot's user agent is counted, under its own name and path", async () => {
    const mw = middlewareFor(await internalApp());
    for (const ua of Object.values(BOT_USER_AGENTS)) {
      await mw.handle("https://lyceon.ai/parent.md", ua);
    }
    // The robots-only tokens are recognised too, if a request ever carries one.
    for (const token of ROBOTS_ONLY_TOKENS)
      await mw.handle(
        "https://lyceon.ai/",
        `Mozilla/5.0 (compatible; ${token})`,
      );
    expect(rpc.calls).toEqual([
      ...Object.keys(BOT_USER_AGENTS).map((bot) => ({
        name: "record_ai_crawler_visit",
        args: { p_bot: bot, p_path: "/parent.md" },
      })),
      ...ROBOTS_ONLY_TOKENS.map((bot) => ({
        name: "record_ai_crawler_visit",
        args: { p_bot: bot, p_path: "/" },
      })),
    ]);
  });

  it("a normal browser request is not counted", async () => {
    const mw = middlewareFor(await internalApp());
    // Presence first: the same chain does count a bot.
    await mw.handle("https://lyceon.ai/parent", BOT_USER_AGENTS.GPTBot ?? "");
    expect(rpc.calls).toHaveLength(1);
    rpc.calls.length = 0;
    mw.reported.length = 0;
    for (const ua of BROWSERS) {
      for (const url of ["https://lyceon.ai/", "https://lyceon.ai/parent.md"])
        await mw.handle(url, ua);
    }
    await mw.handle("https://lyceon.ai/", "");
    expect(mw.reported).toEqual([]);
    expect(rpc.calls).toEqual([]);
  });

  it("the route refuses a report without the secret, or with a bad body", async () => {
    const app = await internalApp();
    const visit = { bot: "GPTBot", path: "/parent" };
    expect(
      (await request(app).post(AI_CRAWLER_VISIT_PATH).send(visit)).status,
    ).toBe(404);
    const auth = `Bearer ${SECRET}`;
    for (const body of [
      { bot: "Googlebot", path: "/" },
      { bot: "GPTBot", path: "/parent?ref=x" },
      { bot: "GPTBot", path: "/parent", ip: "203.0.113.7" },
    ])
      expect(
        (
          await request(app)
            .post(AI_CRAWLER_VISIT_PATH)
            .set("authorization", auth)
            .send(body)
        ).status,
      ).toBe(400);
    expect(rpc.calls).toEqual([]);
    // A path that passes the schema but is not public is stored as "(other)".
    const res = await request(app)
      .post(AI_CRAWLER_VISIT_PATH)
      .set("authorization", auth)
      .send({ bot: "GPTBot", path: "/join/abc123" });
    expect(res.status).toBe(204);
    expect(rpc.calls).toEqual([
      {
        name: "record_ai_crawler_visit",
        args: { p_bot: "GPTBot", p_path: OTHER_PATH },
      },
    ]);
  });
});

describe("the counted path", () => {
  it("keeps public pages, their copies and the site files", () => {
    for (const path of [
      "/",
      "/index.md",
      "/parent",
      "/parent/",
      "/parent.md",
      "/online-sat-prep.md",
      "/blog/how-to-study",
      "/blog/how-to-study.md",
      "/sat-question-of-the-day/2026-11-20",
      "/sat-question-of-the-day/2026-11-20.md",
      "/legal/privacy-policy.md",
      "/llms.txt",
      "/robots.txt",
      "/sitemap.xml",
    ])
      expect(countedPath(path), path).toBe(
        path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path,
      );
  });

  it("never stores a path that can carry a token, or an unknown path", () => {
    for (const path of [
      "/join/9f2c4e1a7b",
      "/auth/callback",
      "/api/internal/ai-crawler-visit",
      "/account/recover",
      "/dashboard",
      "/login.md",
      "/.md",
      "/blog/x/y",
      `/blog/${"a".repeat(300)}`,
    ])
      expect(countedPath(path), path).toBe(OTHER_PATH);
  });

  it("drops the query string: the middleware counts the pathname only", async () => {
    const mw = middlewareFor(await internalApp());
    await mw.handle(
      "https://lyceon.ai/parent?email=someone%40example.com&token=abc",
      BOT_USER_AGENTS.ClaudeBot ?? "",
    );
    expect(mw.reported).toEqual([{ bot: "ClaudeBot", path: "/parent" }]);
  });

  it("tracks exactly the prerendered routes of the registry", () => {
    const prerendered = loadRouteRegistry()
      .filter((r) => r.prerender)
      .map((r) => r.path_pattern);
    expect(prerendered.length).toBeGreaterThan(20);
    expect([...TRACKED_PAGE_PATTERNS].sort()).toEqual([...prerendered].sort());
  });

  it("names a crawler only from its own token", () => {
    expect(aiCrawlerFor(null)).toBeNull();
    expect(aiCrawlerFor("")).toBeNull();
    expect(aiCrawlerFor("Claude-User/1.0")).toBe("Claude-User");
    expect(aiCrawlerFor("ClaudeBot/1.0")).toBe("ClaudeBot");
    expect(aiCrawlerFor("perplexitybot/1.0")).toBe("PerplexityBot");
  });
});

describe("bot and human get the same bytes for the same URL", () => {
  let site: Awaited<ReturnType<typeof getPrerenderedSite>>;
  beforeAll(async () => {
    site = await getPrerenderedSite();
  }, 120_000);

  it("the middleware answers both with the same pass-through", async () => {
    const mw = middlewareFor(await internalApp());
    const describeRes = async (res: Response) => ({
      status: res.status,
      headers: [...res.headers.entries()].sort(),
      body: await res.text(),
    });
    for (const url of [
      "https://lyceon.ai/",
      "https://lyceon.ai/parent.md",
      "https://lyceon.ai/llms.txt",
    ]) {
      const bot = await describeRes(
        await mw.handle(url, BOT_USER_AGENTS.GPTBot ?? ""),
      );
      const human = await describeRes(await mw.handle(url, BROWSERS[0] ?? ""));
      expect(bot).toEqual(human);
      // Pass-through: no rewrite, no redirect, no body of its own.
      expect(bot.headers).toContainEqual(["x-middleware-next", "1"]);
      expect(
        bot.headers.some(([k]) => k.includes("rewrite") || k === "location"),
      ).toBe(false);
      expect(bot.body).toBe("");
    }
  });

  it("a static server over the build output returns identical bytes to both", async () => {
    // The build output, written as prerender.mjs writes it.
    const root = mkdtempSync(join(tmpdir(), "ai-visibility-"));
    const write = (file: string, text: string): void => {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), text);
    };
    for (const page of site.pages) write(page.file, page.html);
    for (const twin of site.markdownTwins) write(twin.file, twin.markdown);
    write("llms.txt", site.llmsTxt);
    const app = express();
    app.use(express.static(root)); // as server/index.ts serves dist/public
    const urls = [
      "/",
      "/parent/",
      "/parent.md",
      "/index.md",
      "/llms.txt",
      `/${twinFileFor(site.markdownTwins[5]?.path ?? "/")}`,
    ];
    for (const url of urls) {
      const bot = await request(app)
        .get(url)
        .set("user-agent", BOT_USER_AGENTS.PerplexityBot ?? "")
        .buffer(true);
      const human = await request(app)
        .get(url)
        .set("user-agent", BROWSERS[1] ?? "")
        .buffer(true);
      expect(bot.status, url).toBe(200);
      expect(human.status, url).toBe(200);
      const bytes = (r: request.Response): string => r.text;
      expect(bytes(bot).length, url).toBeGreaterThan(100);
      expect(bytes(bot), url).toBe(bytes(human));
      expect(bot.headers["content-type"]).toBe(human.headers["content-type"]);
    }
  });
});

describe("robots.txt", () => {
  const robots = readFileSync("client/public/robots.txt", "utf8");
  /** The groups: their User-agent lines and rules. */
  const groups = (): { agents: string[]; rules: string[] }[] => {
    const out: { agents: string[]; rules: string[] }[] = [];
    let current: { agents: string[]; rules: string[] } | null = null;
    for (const raw of robots.split("\n")) {
      const line = raw.replace(/#.*/, "").trim();
      if (line === "") continue;
      const [key = "", ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (key.toLowerCase() === "user-agent") {
        if (!current || current.rules.length > 0) {
          current = { agents: [], rules: [] };
          out.push(current);
        }
        current.agents.push(value.toLowerCase());
      } else if (current && /^(allow|disallow)$/i.test(key)) {
        current.rules.push(`${key.toLowerCase()}:${value}`);
      }
    }
    return out;
  };

  it("lets every AI crawler read the pages, their copies and llms.txt", () => {
    const all = groups();
    expect(all.length).toBeGreaterThan(0);
    for (const bot of AI_CRAWLERS) {
      // A crawler obeys the group naming it, else the "*" group.
      const named = all.find((g) => g.agents.includes(bot.toLowerCase()));
      const group = named ?? all.find((g) => g.agents.includes("*"));
      expect(group, bot).toBeDefined();
      const disallowed = (group?.rules ?? [])
        .filter((r) => r.startsWith("disallow:"))
        .map((r) => r.slice("disallow:".length))
        .filter((p) => p !== "");
      for (const path of [
        "/",
        "/parent",
        "/index.md",
        "/parent.md",
        "/llms.txt",
        "/blog/x.md",
      ])
        expect(
          disallowed.some((d) => path.startsWith(d)),
          `${bot} may read ${path}`,
        ).toBe(false);
    }
  });
});

describe("the growth report line", () => {
  it("shows the week's visits by bot and the top 5 paths", () => {
    expect(
      aiCrawlerLines({
        week_start: "2026-11-23",
        total: 42,
        by_bot: [
          { bot: "GPTBot", visits: 30 },
          { bot: "ClaudeBot", visits: 12 },
        ],
        top_paths: [
          { path: "/", visits: 20 },
          { path: "/parent.md", visits: 9 },
          { path: "/llms.txt", visits: 6 },
          { path: "/blog", visits: 4 },
          { path: "(other)", visits: 3 },
        ],
      }),
    ).toEqual([
      "• AI bot visits: *42* (by bot: GPTBot 30, ClaudeBot 12)",
      "    top 5 paths: / 20, /parent.md 9, /llms.txt 6, /blog 4, (other) 3",
    ]);
  });

  it("an empty week says none; an unreadable week says so", () => {
    expect(
      aiCrawlerLines({
        week_start: "2026-11-23",
        total: 0,
        by_bot: [],
        top_paths: [],
      }),
    ).toEqual(["• AI bot visits: *0* (by bot: none)", "    top 5 paths: none"]);
    expect(aiCrawlerLines(null)).toEqual([
      `• AI bot visits: ${AI_CRAWLERS_NOT_AVAILABLE}`,
    ]);
  });
});
