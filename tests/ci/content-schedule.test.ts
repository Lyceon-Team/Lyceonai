/**
 * Scheduled publishing for blog posts (Doc 10B §8.3): a post is public only when approved AND its
 * publishAt (America/Chicago) has arrived; before that it is not prerendered, not in the sitemap or
 * index, its URL has no page (Vercel serves the 404), and none of its words ship in the bundles.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §2.4, §8.3; owner answers on Doc 10B Phase 1 Step 0 (Karl,
 *       2026-10-11) items 1, 4, 5] | @implemented [2026-10-11]
 *
 * plain English: fixtures are built by the real producer (toScheduledPost) from a real post's page,
 * so they have exactly the shape the site renders. The bundle test runs a real Vite build through
 * the content-schedule plugin and reads what came out.
 */
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { contentSchedulePlugin } from "../../vite-plugin-content-schedule";
import {
  ALL_BLOG_POSTS,
  BLOG_POSTS,
  publishedBlogPosts,
  toScheduledPost,
  type BlogPost,
} from "../../shared/content/blog";
import {
  approvalFor,
  approvalsFileSchema,
} from "../../shared/content/approvals";
import {
  chicagoHour,
  chicagoWallClock,
  isPagePublic,
} from "../../shared/content/schedule";
import { withheldPosts } from "../../scripts/content/withheld-posts";
import {
  buildSitemapXml,
  expandPrerenderPages,
} from "../../shared/seo/route-registry";
import { BASE_URL } from "../../shared/seo/structured-data";
import { contentPageProblems, claimIdsIn } from "../../shared/seo/content-gate";
import { loadRouteRegistry, REPO_ROOT } from "../lib/prerendered-site";
import { FIXTURE_APPROVALS, scheduledSpec } from "../lib/content-fixtures";

const APPROVED = FIXTURE_APPROVALS;

const at = (iso: string): Date => new Date(iso);
// 2026-10-19 is a Monday in CDT (UTC-5): 07:00 Chicago is 12:00 UTC.
const BEFORE = at("2026-10-19T11:59:00Z");
const ON_TIME = at("2026-10-19T12:00:00Z");

describe("the Chicago wall clock (one rule, DST-safe)", () => {
  it("reads 07:00 at 12:00 UTC in summer time and at 13:00 UTC in standard time", () => {
    expect(chicagoWallClock(at("2026-10-19T12:00:00Z"))).toBe(
      "2026-10-19T07:00",
    );
    expect(chicagoWallClock(at("2026-11-02T13:00:00Z"))).toBe(
      "2026-11-02T07:00",
    );
    expect(chicagoHour(at("2026-11-02T12:00:00Z"))).toBe(6);
  });
});

describe("isPagePublic", () => {
  const approved = { by: "Karl", date: "2026-10-16" };
  it("an unapproved page is never public, whatever its date", () => {
    expect(
      isPagePublic(
        { publishAt: "2026-10-19T07:00" },
        at("2030-01-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(isPagePublic({}, at("2030-01-01T00:00:00Z"))).toBe(false);
  });
  it("an approved page with a future publishAt is not public; it is public from its minute on", () => {
    expect(
      isPagePublic({ approved, publishAt: "2026-10-19T07:00" }, BEFORE),
    ).toBe(false);
    expect(
      isPagePublic({ approved, publishAt: "2026-10-19T07:00" }, ON_TIME),
    ).toBe(true);
    expect(isPagePublic({ approved }, BEFORE)).toBe(true);
  });
});

describe("approval comes only from the cycle's merge stamp", () => {
  it("a post in a stamped cycle is approved with the merge date; an unstamped cycle is not", () => {
    expect(toScheduledPost(scheduledSpec(), APPROVED).page.approved).toEqual({
      by: "Karl",
      date: "2026-10-16",
    });
    expect(toScheduledPost(scheduledSpec(), {}).page.approved).toBeUndefined();
    expect(approvalFor("2026-W44", APPROVED)).toBeUndefined();
  });
  it("the approvals file refuses a stamp not by Karl, or without a full merge sha", () => {
    expect(
      approvalsFileSchema.safeParse({
        "2026-W43": { ...APPROVED["2026-W43"], by: "Claude" },
      }).success,
    ).toBe(false);
    expect(
      approvalsFileSchema.safeParse({
        "2026-W43": { ...APPROVED["2026-W43"], mergeSha: "abc" },
      }).success,
    ).toBe(false);
    expect(
      approvalsFileSchema.safeParse({ "not-a-cycle": APPROVED["2026-W43"] })
        .success,
    ).toBe(false);
  });
  it("the repo's approvals file parses, and every post the site shows today is approved", () => {
    for (const post of BLOG_POSTS)
      expect(post.page.approved, post.slug).toBeDefined();
  });
});

describe("a future publishAt is absent everywhere, and appears on its date", () => {
  const registry = loadRouteRegistry();
  const scheduled = toScheduledPost(scheduledSpec(), APPROVED);
  const all: BlogPost[] = [...ALL_BLOG_POSTS, scheduled];
  const sitemapAt = (now: Date): { paths: string[]; xml: string } => {
    const blog = publishedBlogPosts(now, all).map((p) => ({
      slug: p.slug,
      date: p.date,
    }));
    const pages = expandPrerenderPages(registry, { blog, legal: [], qotd: [] });
    return {
      paths: pages.map((p) => p.path),
      xml: buildSitemapXml(pages, BASE_URL),
    };
  };

  it("before 07:00 Chicago on its date: not listed, not prerendered, not in the sitemap", () => {
    expect(publishedBlogPosts(BEFORE, all).map((p) => p.slug)).not.toContain(
      "scheduled-fixture",
    );
    const { paths, xml } = sitemapAt(BEFORE);
    expect(paths).toContain("/blog"); // presence: the hub is built
    expect(paths).not.toContain("/blog/scheduled-fixture");
    expect(xml).not.toContain("/blog/scheduled-fixture<");
  });

  it("at 07:00 Chicago on its date: listed, prerendered and in the sitemap", () => {
    expect(publishedBlogPosts(ON_TIME, all).map((p) => p.slug)).toContain(
      "scheduled-fixture",
    );
    const { paths, xml } = sitemapAt(ON_TIME);
    expect(paths).toContain("/blog/scheduled-fixture");
    expect(xml).toContain(`<loc>${BASE_URL}/blog/scheduled-fixture</loc>`);
  });

  it("an unapproved post never appears, even years after its date", () => {
    const unapproved = toScheduledPost(scheduledSpec(), {});
    expect(
      publishedBlogPosts(at("2031-01-01T00:00:00Z"), [unapproved]),
    ).toEqual([]);
  });

  it("the build withholds exactly the posts that are not public, by their own module file", () => {
    const unapproved = toScheduledPost(
      scheduledSpec({ slug: "unapproved-fixture" }),
      {},
    );
    const list = withheldPosts(
      [scheduled, unapproved, ...BLOG_POSTS],
      BEFORE,
      "/posts",
      () => true,
    );
    expect(list.map((w) => w.slug).sort()).toEqual([
      "scheduled-fixture",
      "unapproved-fixture",
    ]);
    expect(list[0]?.file).toBe("/posts/scheduled-fixture.ts");
    expect(withheldPosts([scheduled], ON_TIME, "/posts", () => true)).toEqual(
      [],
    );
  });

  it("a withheld post without a module of its own stops the build", () => {
    expect(() =>
      withheldPosts([scheduled], BEFORE, "/posts", () => false),
    ).toThrow(/no module of its own/);
  });
});

describe("the publish gate on a scheduled post", () => {
  const inventory = readFileSync(
    join(REPO_ROOT, "docs/compliance/claim-inventory.md"),
    "utf8",
  );
  const ctx = {
    resolves: () => true,
    claimIds: claimIdsIn(inventory),
    claimInventory: inventory,
  };
  it("a post approved by its batch merge before its publish date passes the approval check", () => {
    const problems = contentPageProblems(
      toScheduledPost(scheduledSpec(), APPROVED).page,
      ctx,
    );
    expect(problems.filter((p) => /approved|not approved/.test(p))).toEqual([]);
  });
  it("a correction after publication needs a new approval on or after it", () => {
    const corrected = toScheduledPost(
      scheduledSpec({ updated: "2026-10-25" }),
      APPROVED,
    );
    expect(contentPageProblems(corrected.page, ctx).join("\n")).toMatch(
      /before its last change 2026-10-25/,
    );
  });
  it("an unapproved draft is reported as not approved", () => {
    expect(
      contentPageProblems(toScheduledPost(scheduledSpec(), {}).page, ctx).join(
        "\n",
      ),
    ).toMatch(/not approved/);
  });
});

describe("the content-schedule plugin keeps a withheld post's words out of the bundle", () => {
  it("a real Vite build ships the public post and not the withheld one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "content-schedule-"));
    mkdirSync(join(dir, "posts"));
    writeFileSync(
      join(dir, "posts", "public.js"),
      'export default { h1: "PUBLIC-POST-WORDS" };\n',
    );
    writeFileSync(
      join(dir, "posts", "future.js"),
      'export default { h1: "FUTURE-POST-WORDS" };\n',
    );
    writeFileSync(
      join(dir, "entry.js"),
      'import a from "./posts/public.js";\nimport b from "./posts/future.js";\nexport const POSTS = [a, b].filter((p) => p !== null);\n',
    );
    await build({
      root: dir,
      logLevel: "silent",
      configFile: false,
      plugins: [
        contentSchedulePlugin(dir, {
          stateDir: join(dir, "state"),
          resolveWithheld: (now) => ({
            now,
            withheld: [
              { slug: "future", file: join(dir, "posts", "future.js") },
            ],
          }),
        }),
      ],
      build: {
        outDir: join(dir, "out"),
        lib: {
          entry: join(dir, "entry.js"),
          formats: ["es"],
          fileName: "bundle",
        },
        minify: false,
      },
    });
    const out = readdirSync(join(dir, "out"))
      .map((f) => readFileSync(join(dir, "out", f), "utf8"))
      .join("\n");
    expect(out).toContain("PUBLIC-POST-WORDS"); // presence first
    expect(out).not.toContain("FUTURE-POST-WORDS");
    expect(
      JSON.parse(
        readFileSync(join(dir, "state", "content-withheld.json"), "utf8"),
      ).withheld,
    ).toHaveLength(1);
  }, 60_000);
});
