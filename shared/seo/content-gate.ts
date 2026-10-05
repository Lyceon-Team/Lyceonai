/**
 * The publish gate for public content pages (SEO Wave 3, plan row C3).
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md §0 (Public Disclosure Doctrine) rules 3, 4, 5, 8;
 *       §5 C3 ("a page builds only if it passes: banned-phrase and outcome guards; every claim
 *       sourced or in the claim inventory; meta lengths; internal links resolve; one H1 and a
 *       correct heading order; approved: { by: 'Karl', date }. CI fails on an unapproved or
 *       unsourced page"); owner decision 1, 2026-10-05 (no skill-level promotion)]
 *       | @implemented [2026-10-05]
 *
 * plain English: two pure checks. `contentPageProblems` reads the page's data: approval, meta
 * lengths, a basis (source or claim-inventory row) on every block of text, that each cited
 * claim row and source URL is in the internal claim inventory, the banned-phrase and outcome
 * guards, and that every internal link resolves. `renderedPageProblems` reads the HTML the
 * prerender produced for it: exactly one <h1>, headings that never skip a level, and every
 * internal link in the page body resolving. The prerender (client/src/prerender/entry-server.tsx)
 * runs both over every content page and fails the build on any problem, so an unapproved or
 * unsourced page cannot deploy; tests/ci/content-publish-gate.test.ts proves each rule fails on a
 * planted defect.
 *
 * trade-offs:
 *  - "Every claim" is every block of text. Deciding which sentences are claims would be a
 *    heuristic with holes; requiring a basis on every block is stricter and leaves none. Plain
 *    advice cites its claim-inventory row (W12) like anything else.
 *  - A source must be in the claim inventory's text (its URL), not just in shared/seo/sources.ts:
 *    the inventory is where the quote that backs it is kept (Doctrine rule 4).
 *  - Approval must be dated on or after `lastModified`: an edit after Karl's approval is a page he
 *    has not approved.
 *
 * edge cases: `/#pricing` resolves as `/`; external links must be https; a link with a query
 * string (the diagnostic CTA's `/login?next=…`) resolves on its path.
 */
import type {
  ContentBlock,
  ContentPage,
} from "../../packages/shared/src/seo-content-schema";
import { firstBannedPhrase, firstUnapprovedOutcome } from "./banned-phrases";

export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;

export type GateContext = {
  /** True when an internal path (no query or hash) is a page the site serves. */
  resolves: (path: string) => boolean;
  /** Row IDs in docs/compliance/claim-inventory.md. */
  claimIds: ReadonlySet<string>;
  /** The claim inventory's full text: every cited source URL must appear in it. */
  claimInventory: string;
};

/** The claim-inventory row IDs: the first cell of every table row that looks like `| W12 |`. */
export function claimIdsIn(inventory: string): Set<string> {
  const ids = new Set<string>();
  for (const m of inventory.matchAll(/^\|\s*([A-Z]{1,2}\d+[a-z]?)\s*\|/gm)) {
    if (m[1]) ids.add(m[1]);
  }
  return ids;
}

const INLINE_LINK = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** `[label](href)` pairs in a run of text. */
export function inlineLinks(text: string): { label: string; href: string }[] {
  return [...text.matchAll(INLINE_LINK)].map((m) => ({
    label: m[1] ?? "",
    href: m[2] ?? "",
  }));
}

/** The text with link markup reduced to its label, as a reader sees it. */
export function plainText(text: string): string {
  return text.replace(INLINE_LINK, "$1");
}

/** The path part of an internal href: no query string, no fragment; `/#x` is `/`. */
export function internalPath(href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut === -1 ? href : href.slice(0, cut);
  return path === "" ? "/" : path;
}

function linkProblem(
  where: string,
  href: string,
  ctx: GateContext,
): string | null {
  if (href.startsWith("/")) {
    return ctx.resolves(internalPath(href))
      ? null
      : `${where}: internal link ${href} does not resolve to a page the site serves`;
  }
  return href.startsWith("https://")
    ? null
    : `${where}: link ${href} is neither an internal path nor https`;
}

type TextUnit = {
  where: string;
  texts: string[];
  sources: readonly { url: string }[];
  claims: readonly string[];
  /** False for navigation, which states nothing. */
  needsBasis: boolean;
  links: string[];
};

function blockUnit(block: ContentBlock, where: string): TextUnit | null {
  switch (block.type) {
    case "p":
      return {
        where,
        texts: [block.text],
        sources: block.sources ?? [],
        claims: block.claims ?? [],
        needsBasis: true,
        links: inlineLinks(block.text).map((l) => l.href),
      };
    case "ul":
      return {
        where,
        texts: block.items,
        sources: block.sources ?? [],
        claims: block.claims ?? [],
        needsBasis: true,
        links: block.items.flatMap((i) => inlineLinks(i).map((l) => l.href)),
      };
    case "table": {
      const cells = [...block.head, ...block.rows.flat()].flatMap((cell) =>
        typeof cell === "string" ? [cell] : [],
      );
      const texts = [
        block.caption,
        ...cells,
        ...(block.note ? [block.note] : []),
      ];
      return {
        where,
        texts,
        sources: block.sources ?? [],
        claims: block.claims ?? [],
        needsBasis: true,
        links: texts.flatMap((t) => inlineLinks(t).map((l) => l.href)),
      };
    }
    case "links":
      return {
        where,
        texts: block.items.map((i) => i.label),
        sources: [],
        claims: [],
        needsBasis: false,
        links: block.items.map((i) => i.href),
      };
    case "qotd":
    case "cta":
      return null;
  }
}

function textUnits(page: ContentPage): TextUnit[] {
  const units: TextUnit[] = [];
  page.intro.forEach((block, i) => {
    const unit = blockUnit(block, `intro[${i}] (${block.type})`);
    if (unit) units.push(unit);
  });
  page.sections.forEach((section) => {
    units.push({
      where: `section "${section.heading}" heading`,
      texts: [section.heading],
      sources: [],
      claims: [],
      needsBasis: false,
      links: [],
    });
    section.blocks.forEach((block, b) => {
      const unit = blockUnit(
        block,
        `section "${section.heading}" block ${b + 1} (${block.type})`,
      );
      if (unit) units.push(unit);
    });
  });
  page.faq.forEach((item) => {
    units.push({
      where: `FAQ "${item.question}"`,
      texts: [item.question, item.answer],
      sources: item.sources ?? [],
      claims: item.claims ?? [],
      needsBasis: true,
      links: inlineLinks(item.answer).map((l) => l.href),
    });
  });
  return units;
}

/** Every problem the page's DATA has. Empty means the data may publish. */
export function contentPageProblems(
  page: ContentPage,
  ctx: GateContext,
): string[] {
  const at = (message: string): string => `${page.path}: ${message}`;
  const problems: string[] = [];

  // Karl's approval gate (Doctrine rule 5).
  if (!page.approved) {
    problems.push(at('not approved (no `approved: { by: "Karl", date }`)'));
  } else if (page.approved.date < page.lastModified) {
    problems.push(
      at(
        `approved ${page.approved.date}, before its last change ${page.lastModified}: the current text is not approved`,
      ),
    );
  }
  if (page.lastModified < page.published) {
    problems.push(at("lastModified is before published"));
  }

  // Meta lengths.
  if (page.title.length > TITLE_MAX) {
    problems.push(
      at(`title is ${page.title.length} characters (max ${TITLE_MAX})`),
    );
  }
  if (
    page.description.length < DESCRIPTION_MIN ||
    page.description.length > DESCRIPTION_MAX
  ) {
    problems.push(
      at(
        `description is ${page.description.length} characters (${DESCRIPTION_MIN}–${DESCRIPTION_MAX})`,
      ),
    );
  }

  // Heading order in the data: the first section is an <h2>; an <h3> follows an <h2>.
  if (page.sections[0]?.level !== 2) {
    problems.push(at("the first section must be a level-2 heading"));
  }

  const units = textUnits(page);
  for (const unit of units) {
    // Every claim sourced or in the claim inventory (Doctrine rules 3, 4).
    if (
      unit.needsBasis &&
      unit.sources.length === 0 &&
      unit.claims.length === 0
    ) {
      problems.push(
        at(
          `${unit.where} states something with no source and no claim-inventory row`,
        ),
      );
    }
    for (const claim of unit.claims) {
      if (!ctx.claimIds.has(claim)) {
        problems.push(
          at(
            `${unit.where} cites claim ${claim}, which is not in the claim inventory`,
          ),
        );
      }
    }
    for (const source of unit.sources) {
      if (!ctx.claimInventory.includes(source.url)) {
        problems.push(
          at(
            `${unit.where} cites ${source.url}, which the claim inventory's Sources table does not record`,
          ),
        );
      }
    }
    for (const href of unit.links) {
      const problem = linkProblem(unit.where, href, ctx);
      if (problem) problems.push(at(problem));
    }
  }

  // Banned-phrase and outcome guards, over every word the page shows or puts in its head.
  const everything = [
    page.title,
    page.description,
    page.h1,
    page.crumb,
    ...units.flatMap((u) => u.texts.map(plainText)),
  ];
  for (const text of everything) {
    const banned = firstBannedPhrase(text);
    if (banned)
      problems.push(
        at(`banned phrase ${banned.pattern} (${banned.why}) in "${text}"`),
      );
    const outcome = firstUnapprovedOutcome(text);
    if (outcome)
      problems.push(
        at(
          `unapproved outcome claim ${outcome.pattern} (${outcome.why}) in "${text}"`,
        ),
      );
  }

  if (page.parent !== undefined && !ctx.resolves(page.parent)) {
    problems.push(at(`parent ${page.parent} does not resolve`));
  }
  return problems;
}

/** The content article of a rendered page, from its opening tag to its close. */
export function contentArticle(html: string): string | null {
  const start = html.indexOf("<article data-content-page");
  if (start === -1) return null;
  const end = html.indexOf("</article>", start);
  return end === -1 ? null : html.slice(start, end);
}

/** Every problem the RENDERED page has: one h1, no skipped heading level, links resolve. */
export function renderedPageProblems(
  path: string,
  html: string,
  ctx: GateContext,
): string[] {
  const at = (message: string): string => `${path} (rendered): ${message}`;
  const problems: string[] = [];
  const rootStart = html.indexOf('<div id="root">');
  const body = rootStart === -1 ? html : html.slice(rootStart);

  const h1s = [...body.matchAll(/<h1[\s>]/g)].length;
  if (h1s !== 1) problems.push(at(`has ${h1s} <h1> elements (exactly 1)`));

  const article = contentArticle(body);
  if (article === null) {
    problems.push(at("has no <article data-content-page>"));
    return problems;
  }
  const levels = [...article.matchAll(/<h([1-6])[\s>]/g)].map((m) =>
    Number(m[1]),
  );
  if (levels[0] !== 1) {
    problems.push(
      at(`the article's first heading is h${levels[0] ?? "none"}, not h1`),
    );
  }
  levels.forEach((level, i) => {
    const previous = levels[i - 1];
    if (previous !== undefined && level > previous + 1) {
      problems.push(at(`heading order skips from h${previous} to h${level}`));
    }
  });

  for (const m of article.matchAll(/<a\b[^>]*href="([^"]*)"/g)) {
    const href = (m[1] ?? "").replace(/&amp;/g, "&");
    const problem = linkProblem("link", href, ctx);
    if (problem) problems.push(at(problem));
  }
  return problems;
}
