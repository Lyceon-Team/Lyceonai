/**
 * The Doc 10B §5 quality gates added for the blog pipeline: each passes on the real pages and
 * rejects a planted violation.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §5 gates 2, 6, 7, 8, 11, 12; owner brief "Doc 10B Phase 1"
 *       (Karl, 2026-10-11) scope 5 ("each new gate rejects a planted violation"); owner answer on
 *       Step 0, item 8 (LISA as a product feature); Vale decision 2026-10-11]
 *       | @implemented [2026-10-11]
 *
 * plain English: every plant starts from a real page that passes the real publish gate
 * (assertContentPagesPublishable, run as the build runs it) and changes one thing:
 *   - gate 11: a second page targeting a term an existing page owns (plural or case changed);
 *   - gate 12: an AI mention (LISA as "your AI tutor" passes) and a missing trademark notice;
 *   - gate 2: an internal label;
 *   - gate 7: a post that links to no practice or score page;
 *   - gate 6: Vale (the repo's .vale.ini, Microsoft + ai-tells) on planted AI-tell prose;
 *   - gate 8: lychee (the repo's lychee.toml) on a College Board URL that 404s.
 * Vale and lychee are the pinned builds CI installs (.github/actions/content-tools); a machine
 * without them skips those two cases locally, and CI fails rather than skip.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assertContentPagesPublishable,
  type PrerenderedSite,
} from "../../client/src/prerender/entry-server";
import { CONTENT_PAGES } from "../../shared/content/pages";
import { ALL_BLOG_PAGES, BLOG_PAGES } from "../../shared/content/blog";
import {
  PRACTICE_OR_SCORE_PATHS,
  SAT_TRADEMARK_NOTICE,
  duplicateTargetProblems,
  normalizedKeyword,
} from "../../shared/seo/content-gate";
import { firstPipelinePhrase } from "../../shared/seo/banned-phrases";
import type { ContentPage } from "../../packages/shared/src/seo-content-schema";
import { postProseMarkdown } from "../../scripts/content/export-prose";
import {
  REPO_ROOT,
  bodyText,
  getPrerenderedSite,
  loadRouteRegistry,
} from "../lib/prerendered-site";

const registry = loadRouteRegistry();
const inventory = readFileSync(
  resolve(REPO_ROOT, "docs/compliance/claim-inventory.md"),
  "utf8",
);
const ALL_PAGES: readonly ContentPage[] = [...CONTENT_PAGES, ...BLOG_PAGES];

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 60_000);

/** The publish gate as the build runs it, over `pages`, with optional replacement HTML. */
function gate(
  pages: readonly ContentPage[],
  html: Record<string, string> = {},
): () => void {
  return () =>
    assertContentPagesPublishable(
      pages,
      site.pages.map((p) =>
        html[p.path] !== undefined ? { ...p, html: html[p.path] ?? "" } : p,
      ),
      registry,
      inventory,
    );
}

function blogPage(index = 0): ContentPage {
  const page = BLOG_PAGES[index];
  if (!page) throw new Error("no blog page to plant into");
  return structuredClone(page);
}

/** A copy of `page` with `sentence` appended to its first intro paragraph. */
function withSentence(page: ContentPage, sentence: string): ContentPage {
  const copy = structuredClone(page);
  const first = copy.intro.find((b) => b.type === "p");
  if (!first || first.type !== "p") throw new Error("no intro paragraph");
  first.text = `${first.text} ${sentence}`;
  return copy;
}

describe("presence: the real pages pass every new gate", () => {
  it("every content page and post passes the publish gate, and there are posts to check", () => {
    expect(BLOG_PAGES.length).toBeGreaterThanOrEqual(5);
    expect(gate(ALL_PAGES)).not.toThrow();
  });
});

describe("gate 11: no two pages target the same search term", () => {
  it("every page and post carries a target keyword, and no two collide", () => {
    for (const page of [...CONTENT_PAGES, ...ALL_BLOG_PAGES])
      expect(page.targetKeyword, page.path).toBeDefined();
    expect(
      duplicateTargetProblems([...CONTENT_PAGES, ...ALL_BLOG_PAGES]),
    ).toEqual([]);
  });

  it("a second page targeting an owned term, in plural and capitals, is rejected", () => {
    const owner = blogPage(0);
    const keyword = owner.targetKeyword ?? "";
    expect(normalizedKeyword(`${keyword.toUpperCase()}s`)).toBe(
      normalizedKeyword(keyword),
    );
    const planted = { ...blogPage(1), targetKeyword: `${keyword}s` };
    expect(gate([owner, planted])).toThrow(
      new RegExp(
        `${planted.path}: targets .*${owner.path} already covers.*gate 11`,
      ),
    );
  });

  it("a blog post with no target keyword is rejected", () => {
    const { targetKeyword: _k, ...rest } = blogPage(0);
    expect(gate([rest])).toThrow(/needs a targetKeyword/);
  });
});

describe("gate 12: no AI, automation or process; LISA as a feature excepted", () => {
  it("an AI mention in a post is rejected", () => {
    expect(
      gate([withSentence(blogPage(), "We use AI to choose your next step.")]),
    ).toThrow(/mentions AI.*gate 12/);
  });
  it("a process mention in a post is rejected", () => {
    expect(
      gate([
        withSentence(blogPage(), "This guide was reviewed by our editors."),
      ]),
    ).toThrow(/how content is made.*gate 12/);
  });
  it('"LISA, your AI tutor" is the one AI mention allowed', () => {
    expect(firstPipelinePhrase("Ask LISA, your AI tutor, for a hint.")).toBe(
      null,
    );
    expect(
      firstPipelinePhrase("Ask LISA, your AI tutor, or any AI tool."),
    ).not.toBe(null);
  });
  it("every post's built page carries the trademark notice", () => {
    for (const page of BLOG_PAGES) {
      const built = site.pages.find((p) => p.path === page.path);
      expect(built, page.path).toBeDefined();
      expect(bodyText(built?.html ?? ""), page.path).toContain(
        SAT_TRADEMARK_NOTICE,
      );
    }
  });
  it("a built page without the trademark notice is rejected", () => {
    const page = blogPage();
    const built = site.pages.find((p) => p.path === page.path)?.html ?? "";
    const stripped = built.replace(
      /SAT(®|&reg;|&#174;) is a trademark registered by the College Board[^<]*/,
      "",
    );
    expect(stripped).not.toBe(built);
    expect(gate([page], { [page.path]: stripped })).toThrow(
      /has no SAT trademark notice/,
    );
  });
});

describe("gate 2: no internal labels", () => {
  it("a register ID in a post is rejected", () => {
    expect(
      gate([withSentence(blogPage(), "See SCL-222 for the rule.")]),
    ).toThrow(/internal label/);
  });
  it("a mastery-computation phrase in a post is rejected", () => {
    expect(
      gate([withSentence(blogPage(), "Your mastery score rises each week.")]),
    ).toThrow(/mastery computation/);
  });
});

describe("gate 7: a post links on to a practice or score page", () => {
  it("every real post does", () => {
    for (const page of BLOG_PAGES)
      expect(
        PRACTICE_OR_SCORE_PATHS.some((p) => JSON.stringify(page).includes(p)),
        page.path,
      ).toBe(true);
  });
  it("a post whose practice and score links are removed is rejected", () => {
    let json = JSON.stringify(blogPage());
    for (const p of PRACTICE_OR_SCORE_PATHS)
      json = json.split(`(${p}`).join("(/blog").split(`"${p}`).join('"/blog');
    const planted = JSON.parse(json) as ContentPage;
    expect(gate([planted])).toThrow(/links to no practice or score page/);
  });
});

function onPath(tool: string): boolean {
  return spawnSync(tool, ["--version"], { encoding: "utf8" }).status === 0;
}
const TOOLS = onPath("vale") && onPath("lychee");
if (!TOOLS && process.env.CI) {
  throw new Error(
    "vale and lychee must be on PATH in CI (.github/actions/content-tools)",
  );
}

describe.skipIf(!TOOLS)("gates 6 and 8: Vale and lychee, as configured", () => {
  const dir = mkdtempSync(join(tmpdir(), "content-gates-"));
  const vale = (file: string): { status: number | null; out: string } => {
    const r = spawnSync(
      "vale",
      [
        "--config",
        join(REPO_ROOT, ".vale.ini"),
        "--minAlertLevel=error",
        "--output=line",
        file,
      ],
      { encoding: "utf8" },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const lychee = (urls: string[]): { status: number | null; out: string } => {
    const file = join(dir, `links-${urls.length}-${Date.now()}.txt`);
    writeFileSync(file, `${urls.join("\n")}\n`);
    const r = spawnSync(
      "lychee",
      ["--no-progress", "--config", join(REPO_ROOT, "lychee.toml"), file],
      { encoding: "utf8" },
    );
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  beforeAll(() => {
    const sync = spawnSync(
      "vale",
      ["--config", join(REPO_ROOT, ".vale.ini"), "sync"],
      { encoding: "utf8" },
    );
    expect(sync.status, `${sync.stdout}${sync.stderr}`).toBe(0);
  }, 60_000);

  it("Vale passes plain, cited-style prose", () => {
    const file = join(dir, "clean.md");
    writeFileSync(
      file,
      "# SAT test dates for fall 2026\n\nThe next SAT is on November 7, 2026. Register by October 23.\n\nScores for that date come out on November 20.\n",
    );
    expect(vale(file)).toMatchObject({ status: 0 });
  });

  it("Vale rejects planted AI-tell prose in a real post's export", () => {
    const file = join(dir, "planted.md");
    const page = withSentence(
      blogPage(),
      "Let us delve into the rich tapestry of test dates.",
    );
    writeFileSync(file, postProseMarkdown(page));
    const r = vale(file);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/ai-tells\.OverusedVocabulary.*'delve'/);
    expect(r.out).toMatch(/ai-tells\.AICompoundPhrases.*'rich tapestry'/);
  });

  it("lychee passes a live College Board page and rejects one that 404s", () => {
    expect(
      lychee(["https://satsuite.collegeboard.org/sat/dates-deadlines"]),
    ).toMatchObject({ status: 0 });
    const bad = lychee([
      "https://satsuite.collegeboard.org/sat/no-such-page-lyceon-link-check",
    ]);
    expect(bad.status).not.toBe(0);
    expect(bad.out).toMatch(/404/);
  }, 90_000);
});
