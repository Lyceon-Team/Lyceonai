/**
 * The publish gate on posts that are not built yet (Doc 10B §4 stage 4 before stage 6).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §4, §5; owner brief "Doc 10B Phase 1" (Karl, 2026-10-11)]
 *       | @implemented [2026-10-11]
 *
 * plain English: a batch's posts are unapproved until Karl merges, so the build withholds them and
 * its gate never runs on them. THE GATE here is the first test: every pipeline post on the branch
 * passes every check, as it will be on the day it goes live. The rest prove that check is real:
 * it passes the five live posts and a pipeline post built by the real producer, and fails each
 * planted defect.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The live blog set is computed from the clock at import time: freeze Date before any import
// runs, so this file sees the same posts on every day (tests/lib/content-clock.ts).
await vi.hoisted(async () => {
  const { pinContentClock } = await import("../lib/content-clock");
  pinContentClock();
});
import {
  draftPostProblems,
  type PrerenderedSite,
} from "../../client/src/prerender/entry-server";
import { CONTENT_PAGES } from "../../shared/content/pages";
import {
  ALL_BLOG_PAGES,
  ALL_BLOG_POSTS,
  BLOG_PAGES,
  toScheduledPost,
} from "../../shared/content/blog";
import type { ContentPage } from "../../packages/shared/src/seo-content-schema";
import { scheduledSpec } from "../lib/content-fixtures";
import {
  REPO_ROOT,
  getPrerenderedSite,
  loadRouteRegistry,
} from "../lib/prerendered-site";

const registry = loadRouteRegistry();
const inventory = readFileSync(
  resolve(REPO_ROOT, "docs/compliance/claim-inventory.md"),
  "utf8",
);
const ALL: readonly ContentPage[] = [...CONTENT_PAGES, ...ALL_BLOG_PAGES];

let site: PrerenderedSite;
beforeAll(async () => {
  site = await getPrerenderedSite();
}, 60_000);

const gate = (posts: readonly ContentPage[]): string[] =>
  draftPostProblems(posts, ALL, site.pages, registry, inventory);

/** A pipeline post from the real producer, unapproved (no stamp): what a batch carries. */
function draft(): ContentPage {
  return structuredClone(toScheduledPost(scheduledSpec(), {}).page);
}

describe("THE GATE: every pipeline post on this branch", () => {
  it("passes every check it will meet on its publish day", () => {
    const pipeline = ALL_BLOG_POSTS.filter((p) => p.batch !== undefined);
    expect(gate(pipeline.map((p) => p.page))).toEqual([]);
  });
});

describe("the gate is real", () => {
  it("passes the five live posts, rendered on their own", () => {
    expect(BLOG_PAGES.length).toBe(5);
    expect(gate(BLOG_PAGES)).toEqual([]);
  });

  it("passes an unapproved pipeline post from the real producer", () => {
    const page = draft();
    expect(page.approved).toBeUndefined();
    expect(gate([page])).toEqual([]);
  });

  it("fails a draft that targets a term a live page owns (gate 11)", () => {
    const page = { ...draft(), targetKeyword: "good SAT scores" };
    expect(gate([page]).join("\n")).toMatch(
      /targets "good SAT scores", which \/what-is-a-good-sat-score already covers/,
    );
  });

  it("fails a draft with an unsourced paragraph", () => {
    const page = draft();
    page.sections[0]?.blocks.push({
      type: "p",
      text: "The SAT is getting harder every year.",
    });
    expect(gate([page]).join("\n")).toMatch(
      /\/blog\/scheduled-fixture: section .* states something with no source and no claim-inventory row/,
    );
  });

  it("fails a draft whose article links to a page that does not exist", () => {
    const page = draft();
    const first = page.intro.find((b) => b.type === "p");
    if (!first || first.type !== "p") throw new Error("no intro paragraph");
    first.text = `${first.text} See [our guide](/no-such-guide).`;
    expect(gate([page]).join("\n")).toMatch(
      // The rendered article is gated too, not only the data that feeds it.
      /\/blog\/scheduled-fixture \(rendered\): .*\/no-such-guide/,
    );
  });

  it("fails a draft that mentions AI (gate 12)", () => {
    const page = draft();
    const first = page.intro.find((b) => b.type === "p");
    if (!first || first.type !== "p") throw new Error("no intro paragraph");
    first.text = `${first.text} An AI wrote this plan.`;
    expect(gate([page]).join("\n")).toMatch(/gate 12/);
  });
});
