/**
 * Public copy keeps the approved claims: the phrasings F6 removed cannot come back.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 (Public Disclosure Doctrine) rules 1, 2, 3
 *        and 5; §5 F6, F14; owner approval of the Wave 1B claim replacements, 2026-10-03]
 *        | @implemented [2026-10-03]
 *
 * plain English: renders every public page the way the build does (the real prerenderer, the
 * real registry, the real content — `tests/lib/prerendered-site.ts`) and fails if any page's
 * body, head, Open Graph tags or JSON-LD carries a phrase the owner-approved claim inventory
 * (`docs/compliance/claim-inventory.md`) removed. The OG image is a binary, so the script that
 * draws its text is checked instead.
 *
 * Each banned phrase names WHY it is banned, in the same words as the inventory's category:
 *   (b) contradicts the product or a ruling (e.g. adaptivity is only the paid study plan, R15)
 *   (c) describes a mechanism (Doctrine rule 2)
 *   (d) an unsourced general fact (Doctrine rule 3)
 *   (e) a Lyceon-specific or outcome claim without approval (Doctrine rule 5)
 *
 * WHY THE RENDERED PAGE AND NOT THE SOURCE FILES. A claim reaches a reader through the page,
 * whichever file it came from (a page, `shared/seo`, `shared/content/blog.ts`, the footer). The
 * rendered output is the one place every path meets, so a phrase reintroduced in a new file is
 * caught without this test knowing the file exists.
 *
 * edge cases: presence is asserted before absence — the page set must be the full public
 * surface, each page must carry real text, and a known approved phrase must be found — so an
 * empty render cannot pass for a clean one. Phrases are matched case-insensitively on word
 * boundaries, against both the decoded HTML (attributes, meta tags, JSON-LD) and the visible
 * text (where markup could split a phrase, e.g. "<strong>Unlimited</strong> practice").
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PrerenderedSite } from "../../client/src/prerender/entry-server";
import {
  REPO_ROOT,
  bodyText,
  getPrerenderedSite,
  loadRouteRegistry,
} from "../lib/prerendered-site";
import { stripComments } from "./lib/strip-comments";
import {
  APPROVED_OUTCOME_PHRASES,
  BANNED,
  OUTCOME_PATTERNS,
  firstUnapprovedOutcome,
} from "../../shared/seo/banned-phrases";

/** Entities decoded, so `don&#x27;t` and `don't` read the same. */
function decode(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Every phrase a reader or a crawler could see on the page, as two haystacks. */
function haystacks(html: string): string[] {
  const visible = decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ");
  return [decode(html), visible];
}

function violations(label: string, html: string): string[] {
  const found: string[] = [];
  for (const { pattern, why } of BANNED) {
    if (isKnownException(label, pattern)) continue;
    if (haystacks(html).some((text) => pattern.test(text))) {
      found.push(`${label}: ${pattern} — ${why}`);
    }
  }
  // Outcome claims (owner ruling 2026-10-05, F13 decision 3): only the approved sentences pass.
  // Not on /legal/*: published legal text is counsel's (Doctrine rule 6) and carries disclaimers
  // ("does not guarantee…") that deny an outcome rather than claim one; the BANNED list above
  // still scans it.
  if (label.startsWith("/legal/")) return found;
  for (const text of haystacks(html)) {
    const hit = firstUnapprovedOutcome(text);
    if (hit !== null) {
      found.push(`${label}: ${hit.pattern} — ${hit.why}`);
      break;
    }
  }
  return found;
}

/**
 * Hits the owner knows about and that this change may not fix, each pinned to ONE page and ONE
 * pattern. Published legal text changes only as a new version proposed for counsel (Doctrine
 * rule 6, plan row G7), never as a copy edit, so Billing Terms v2's "unlimited practice … and
 * expanded guardian visibility" (legal/billing-terms/v2/en.md:29) is reported to the owner and
 * excepted here rather than edited. Any other page, or any other phrase on this page, still
 * fails; and the last test below fails once the wording is gone, so the exception cannot
 * outlive the defect it covers.
 */
const KNOWN_EXCEPTIONS: readonly { path: string; pattern: RegExp }[] = [
  { path: "/legal/billing-terms", pattern: /\bunlimited\b/i },
  { path: "/legal/billing-terms", pattern: /expanded (guardian|visibility)/i },
];

function isKnownException(path: string, pattern: RegExp): boolean {
  return KNOWN_EXCEPTIONS.some(
    (e) => e.path === path && e.pattern.source === pattern.source,
  );
}

describe("public copy: the claims F6 removed stay removed", () => {
  let site: PrerenderedSite;

  beforeAll(async () => {
    site = await getPrerenderedSite();
  });

  it("renders the whole public surface, with real text on every page (presence first)", () => {
    const prerendered = loadRouteRegistry()
      .filter((row) => row.prerender)
      .map((row) => row.path_pattern);
    const rendered = new Set(site.pages.map((page) => page.path));
    // Every non-parameterised prerendered registry row is a rendered page.
    for (const path of prerendered.filter((p) => !p.includes(":"))) {
      expect(rendered, `${path} is rendered`).toContain(path);
    }
    expect(site.pages.length).toBeGreaterThanOrEqual(15);
    for (const page of site.pages) {
      expect(
        bodyText(page.html).length,
        `${page.path} has body text`,
      ).toBeGreaterThan(200);
    }
    expect(bodyText(site.notFoundHtml)).toContain("Page not found");
  });

  it("finds an approved phrase on the page that carries it (the scan can see the copy)", () => {
    const home = site.pages.find((page) => page.path === "/");
    expect(home).toBeDefined();
    expect(haystacks(home?.html ?? "")[1]).toContain(
      "Skill-level progress, plus a read-only view for a linked parent or guardian",
    );
    // and in the head and the JSON-LD, not only the body
    expect(home?.html).toContain("<title>Lyceon | SAT Prep</title>");
    expect(home?.html).toContain('"@type":"FAQPage"');
  });

  it("no public page, head or JSON-LD carries a banned phrase", () => {
    const found = [
      ...site.pages.flatMap((page) => violations(page.path, page.html)),
      ...violations("404.html", site.notFoundHtml),
    ];
    expect(found).toEqual([]);
  });

  it("the OG image's text (drawn by scripts/generate-assets.js) carries no banned phrase", () => {
    const script = stripComments(
      readFileSync(resolve(REPO_ROOT, "scripts/generate-assets.js"), "utf8"),
    );
    // presence first: the script still draws the approved text
    expect(script).toContain("Digital SAT Prep");
    expect(violations("scripts/generate-assets.js", script)).toEqual([]);
  });

  it("every banned phrase is caught by the scan it is meant for (no dead pattern)", () => {
    // Each pattern must match at least one known example of the phrase it bans, so a typo in
    // a pattern cannot leave a guard that matches nothing.
    const examples = [
      "SAT Tutor at your Finger Tips.",
      "Unlimited practice questions",
      "Unlock everything",
      "Priority feature access as plans roll out",
      "Expert SAT prep tips",
      "Master the Digital SAT",
      "our comprehensive guides",
      "Adaptive practice",
      "Practice adaptively",
      "Question difficulty adjusts as you improve",
      "Question selection adjusts by performance",
      "adapt to your level automatically",
      "Grounded in SAT-style questions",
      "References current question context",
      "Analyzing question...",
      "How does Lisa work?",
      "different from a generic chatbot",
      "Expanded guardian summary",
      "entitlement-gated for paid guardian access",
      "planning signals",
      "Trust Evidence",
      "/trust/evidence",
      "implementation-backed language",
      "Did you forget to add the page to the router?",
      "Authentication and legal consent are handled in one standard flow.",
      "thousands of SAT practice questions",
      "nearly 35% of the Digital SAT Math section",
      "Timed 98-question SAT simulation",
      "calculators for all math questions",
      "Typical Coverage",
      "~13-15 questions",
      "Here's exactly how it works",
      "Module 1 matters most",
      "67% of students got this right.",
    ];
    for (const { pattern } of BANNED) {
      expect(
        examples.some((example) => pattern.test(example)),
        `${pattern} matches a known example`,
      ).toBe(true);
    }
  });

  it("each known exception still matches its page (remove it once the wording is fixed)", () => {
    for (const { path, pattern } of KNOWN_EXCEPTIONS) {
      // the pattern is one of the banned ones, so the exception excuses exactly one guard
      expect(BANNED.map((b) => b.pattern.source)).toContain(pattern.source);
      const page = site.pages.find((p) => p.path === path);
      expect(page, `${path} is rendered`).toBeDefined();
      expect(
        haystacks(page?.html ?? "").some((text) => pattern.test(text)),
        `${path} still carries ${pattern}`,
      ).toBe(true);
    }
  });
});

describe("outcome claims: only the sentences Karl approved (F13, 2026-10-05)", () => {
  it("every approved outcome sentence is on a public page (no dead approval)", async () => {
    const site = await getPrerenderedSite();
    const text = site.pages.flatMap((page) => haystacks(page.html)).join("\n");
    for (const phrase of APPROVED_OUTCOME_PHRASES) {
      expect(text, phrase).toContain(phrase);
    }
  });

  it("the approved sentences pass, and each outcome pattern catches a known unapproved example", () => {
    for (const phrase of APPROVED_OUTCOME_PHRASES) {
      expect(firstUnapprovedOutcome(phrase), phrase).toBeNull();
    }
    const examples = [
      "Practice smarter. Score higher.",
      "Students get higher SAT scores",
      "Boost your SAT score fast",
      "Digital SAT prep built for real progress",
      "Score gains guaranteed",
      "A proven method",
      "Students see 150 points higher on test day",
    ];
    for (const { pattern } of OUTCOME_PATTERNS) {
      expect(
        examples.some((e) => pattern.test(e)),
        `${pattern} matches a known example`,
      ).toBe(true);
    }
    for (const e of examples) {
      expect(firstUnapprovedOutcome(e), e).not.toBeNull();
    }
  });

  it("a planted unapproved claim on the real homepage turns the scan red (presence before absence)", async () => {
    const site = await getPrerenderedSite();
    const home = site.pages.find((page) => page.path === "/");
    expect(home).toBeDefined();
    const html = home?.html ?? "";
    expect(violations("/", html)).toEqual([]);
    const planted = html.replace(
      "SAT prep for families",
      "SAT prep for families. Raise your score by 200 points.",
    );
    expect(planted).not.toBe(html);
    expect(violations("/", planted).length).toBeGreaterThan(0);
    // An approved sentence moved into another sentence is no longer the approved sentence.
    const reworded = html.replace(
      "SAT prep for families",
      "Real progress, guaranteed",
    );
    expect(violations("/", reworded).length).toBeGreaterThan(0);
  });
});

describe("F14: /trust/evidence is gone, not folded in", () => {
  it("has no registry row, no prerendered page and no sitemap entry", async () => {
    const site = await getPrerenderedSite();
    const registry = loadRouteRegistry().map((row) => row.path_pattern);
    // presence first: the trust hub itself is still there
    expect(registry).toContain("/trust");
    expect(site.sitemapXml).toContain("<loc>https://lyceon.ai/trust</loc>");

    expect(registry).not.toContain("/trust/evidence");
    expect(site.pages.map((page) => page.path)).not.toContain(
      "/trust/evidence",
    );
    expect(site.sitemapXml).not.toContain("/trust/evidence");
  });
});
