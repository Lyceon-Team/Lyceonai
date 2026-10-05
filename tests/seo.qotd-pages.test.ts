/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md R16, R18, R20a, Q3; Public Disclosure Doctrine
 *       §0.2; owner Step 0 decisions 2026-10-05 (Quiz JSON-LD on archive pages only; server-side
 *       KaTeX; today's HTML carries no answer)] | @implemented [2026-10-05]
 *
 * plain English: asserts on what the build emits (tests/lib/prerendered-site.ts — the real
 * renderer, fed the shared QOTD fixture, which is real SQL output) for the Question of the Day:
 *   * every past day has its own page, head, Quiz + BreadcrumbList JSON-LD and sitemap entry;
 *   * TODAY is never built, even when the archive source hands it over (the build drops it);
 *   * the homepage and the hub carry no question and no answer for today;
 *   * an archive page shows exactly the answer its JSON-LD names, with typeset maths;
 *   * no QOTD page describes how questions are chosen or scheduled (doctrine §0.2).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { PrerenderedSite } from "../client/src/prerender/entry-server";
import { BASE_URL } from "../shared/seo/structured-data";
import {
  bodyText,
  getPrerenderedSite,
  jsonLdBlocks,
} from "./lib/prerendered-site";
import {
  QOTD_ARCHIVE_ROWS,
  QOTD_FIXTURE_TODAY,
  qotdTodayRow,
} from "./lib/qotd-fixture";

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 60_000);

const HUB = "/sat-question-of-the-day";

function page(path: string) {
  const found = site.pages.find((p) => p.path === path);
  if (!found) throw new Error(`no prerendered page for ${path}`);
  return found;
}

function sitemapLastmod(path: string): string | undefined {
  const loc = `${BASE_URL}${path}`;
  const re = new RegExp(
    `<loc>${loc.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}</loc>\\s*<lastmod>([^<]+)</lastmod>`,
  );
  return re.exec(site.sitemapXml)?.[1];
}

describe("archive pages (Q3)", () => {
  it("builds one page per past day, and none for today", () => {
    // Presence before absence: the fixture has past days and the build kept them.
    expect(QOTD_ARCHIVE_ROWS.length).toBeGreaterThanOrEqual(3);
    const built = site.pages
      .filter((p) => p.path.startsWith(`${HUB}/`))
      .map((p) => p.path)
      .sort();
    expect(built).toEqual(
      QOTD_ARCHIVE_ROWS.map((r) => `${HUB}/${r.qotd_date}`).sort(),
    );
    // Today's row was handed to the prerender as if it were archive; it must not be built.
    expect(built).not.toContain(`${HUB}/${QOTD_FIXTURE_TODAY}`);
    expect(site.qotdArchive.days.map((d) => d.qotd_date)).not.toContain(
      QOTD_FIXTURE_TODAY,
    );
  });

  it("every archive day and the hub are in sitemap.xml with content-dated lastmod; today is not", () => {
    for (const row of QOTD_ARCHIVE_ROWS) {
      expect(sitemapLastmod(`${HUB}/${row.qotd_date}`)).toBe(row.qotd_date);
    }
    expect(sitemapLastmod(HUB)).toBeDefined();
    expect(site.sitemapXml).not.toContain(`${HUB}/${QOTD_FIXTURE_TODAY}<`);
  });

  it("each archive page has its own title and canonical, a BreadcrumbList and a Quiz whose answer is the one shown", () => {
    const titles = new Set<string>();
    for (const row of QOTD_ARCHIVE_ROWS) {
      const p = page(`${HUB}/${row.qotd_date}`);
      const title = /<title>([^<]+)<\/title>/.exec(p.html)?.[1] ?? "";
      expect(title).toContain("SAT Question of the Day for");
      titles.add(title);
      expect(p.html).toContain(
        `<link rel="canonical" href="${BASE_URL}${HUB}/${row.qotd_date}" />`,
      );
      const blocks = jsonLdBlocks(p.html);
      const types = blocks.map((b) => b["@type"]);
      expect(types).toEqual(["BreadcrumbList", "Quiz"]);
      const quiz = blocks[1] as {
        hasPart: {
          acceptedAnswer: { text: string; answerExplanation: { text: string } };
        }[];
      };
      const accepted = quiz.hasPart[0]?.acceptedAnswer;
      const text = bodyText(p.html);
      // The explanation in the markup is the explanation a visitor reads (modulo typeset maths:
      // compare the plain-text part before the first `$`).
      const plainLead = (row.explanation ?? "").split("$")[0]?.trim() ?? "";
      expect(plainLead.length).toBeGreaterThan(0);
      expect(accepted?.answerExplanation.text).toBe(row.explanation);
      expect(text).toContain(plainLead);
      if (row.item_type === "mcq") {
        const options = row.options as { key: string; text: string }[];
        const correct = options.find((o) => o.key === row.correct_answer);
        expect(accepted?.text).toBe(correct?.text);
        expect(p.html).toContain("Correct answer");
      } else {
        expect(accepted?.text).toBe(row.correct_answer);
        expect(text).toContain(`Correct answer: ${row.correct_answer}`);
      }
    }
    expect(titles.size).toBe(QOTD_ARCHIVE_ROWS.length);
  });

  it("maths is typeset in the static HTML (server-side KaTeX), not left as $...$", () => {
    const p = page(`${HUB}/${QOTD_ARCHIVE_ROWS[0]?.qotd_date ?? ""}`);
    expect(p.html).toContain('class="katex"');
    expect(bodyText(p.html)).not.toMatch(/\$[^$]+\$/);
  });
});

describe("today's question never reaches static HTML (R18, Q3)", () => {
  const today = qotdTodayRow();

  it.each(["/", HUB])(
    "%s holds the loading state, not today's question or answer",
    (path) => {
      const html = page(path).html;
      // Presence first: the slot is on the page.
      expect(html).toContain('data-testid="qotd-loading"');
      expect(html).not.toContain(today.stem);
      expect(html).not.toContain(today.explanation ?? "\u0000");
      expect(html).not.toContain('data-testid="qotd-question-area"');
    },
  );

  it("the Quiz type appears on archive pages only", () => {
    for (const p of site.pages) {
      const hasQuiz = jsonLdBlocks(p.html).some((b) => b["@type"] === "Quiz");
      expect(hasQuiz, p.path).toBe(p.path.startsWith(`${HUB}/`));
    }
  });

  it("the hub lists every archive day", () => {
    const html = page(HUB).html;
    for (const row of QOTD_ARCHIVE_ROWS) {
      expect(html).toContain(`href="${HUB}/${row.qotd_date}"`);
    }
  });
});

describe("approved QOTD wording (Karl, 2026-10-05; claim inventory open item 4)", () => {
  const LINE = "A free SAT practice question every day — no account needed.";

  it("the hub title, the homepage and hub line, and each archive description are the approved strings", () => {
    expect(/<title>([^<]+)<\/title>/.exec(page(HUB).html)?.[1]).toBe(
      "SAT Question of the Day – Free Daily SAT Practice | Lyceon",
    );
    for (const path of ["/", HUB])
      expect(bodyText(page(path).html), path).toContain(LINE);
    for (const row of QOTD_ARCHIVE_ROWS) {
      const description = /<meta name="description" content="([^"]+)"/.exec(
        page(`${HUB}/${row.qotd_date}`).html,
      )?.[1];
      expect(description, row.qotd_date).toMatch(
        /^An SAT (Math|Reading and Writing): .+ practice question from [A-Z][a-z]+ \d{1,2}, \d{4}, with the correct answer and a worked explanation\.$/,
      );
    }
  });

  it('no QOTD page says "Digital" (the keyword ruling)', () => {
    const paths = site.pages
      .map((p) => p.path)
      .filter((p) => p === HUB || p.startsWith(`${HUB}/`));
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const path of paths) {
      const html = page(path).html;
      const head = html.slice(0, html.indexOf('<div id="root">'));
      // The page's own content only, not the site-wide nav and footer around it.
      const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
      expect(main.length, path).toBeGreaterThan(0);
      expect(bodyText(main), path).not.toMatch(/\bDigital\b/);
      expect(head, path).not.toMatch(/\bDigital\b/);
    }
    const home = bodyText(page("/").html);
    // F13 (homepage design 2026-10-05): the QOTD slot sits between "See how it works" and
    // "Who Lyceon is for".
    const slot = home.slice(
      home.indexOf("SAT Question of the Day"),
      home.indexOf("Who Lyceon is for"),
    );
    expect(slot.length).toBeGreaterThan(0);
    expect(slot).not.toMatch(/\bDigital\b/);
  });
});

describe("Public Disclosure Doctrine §0.2 on QOTD pages", () => {
  // Words that would describe the mechanism behind which question appears on which day.
  const MECHANISM =
    /\b(algorithm|rotat\w*|schedul\w*|selected|selection|pool|question bank|bank of|randomi[sz]\w*|personali[sz]\w*)\b/i;

  it("no QOTD page or homepage text describes selection, scheduling or bank size", () => {
    const paths = site.pages
      .map((p) => p.path)
      .filter((p) => p === "/" || p === HUB || p.startsWith(`${HUB}/`));
    expect(paths.length).toBeGreaterThanOrEqual(5);
    for (const path of paths) {
      const text = bodyText(page(path).html);
      const qotdPart =
        path === "/"
          ? text.slice(
              text.indexOf("SAT Question of the Day"),
              text.indexOf("Who Lyceon is for"),
            )
          : text;
      expect(qotdPart.length, path).toBeGreaterThan(0);
      expect(qotdPart, path).not.toMatch(MECHANISM);
    }
  });
});
