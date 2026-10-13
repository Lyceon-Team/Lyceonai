/**
 * The structural record of what a cycle produced: the only thing Claude writes in a review
 * record's section 1 (Karl's ruling, 2026-10-13: "Claude's self-audit is private"; SCL-229).
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §4 stage 5 ("no access to the writer's reasoning"), §8.7 as
 *       amended by SCL-229] | @implemented [2026-10-13]
 *
 * plain English: one row per item, built from the content itself, never typed: a post's title,
 * publish time (America/Chicago), target keyword and the sources it cites; for a monthly plan,
 * the month, its publish slots and the College Board pages its dates come from. The last cell is
 * always "Passed internal audit." Claude's audit happens before the pull request opens and is
 * not written anywhere; findings, reasoning and doubts never appear in the record. Run
 * `pnpm exec tsx scripts/content/production-record.ts <cycle>` to print the section's table.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BLOG_POSTS, type BlogPost } from "../../shared/content/blog";
import { publishSlots } from "../../shared/content/schedule";
import {
  SAT_DATES_SOURCE_URL,
  SAT_SCORE_RELEASE_SOURCE_URL,
} from "../../shared/sat-test-dates";
import { lastDay, monthTitle } from "./plan-skeleton";

export const PASSED_INTERNAL_AUDIT = "Passed internal audit.";

export const PRODUCTION_HEADER = [
  "| Item | Title | Publishes | Target keyword | Sources | Audit |",
  "| --- | --- | --- | --- | --- | --- |",
] as const;

/** One item's row: the post's slug (or `plan`) and the cells that must follow it. */
export type ProductionItem = {
  item: string;
  title: string;
  publishes: string;
  keyword: string;
  /** Every source URL the item cites, sorted, each once. */
  sources: readonly string[];
};

/** Plan rows name every slot's keyword in PLAN.md rather than in this cell. */
export const PLAN_KEYWORD_CELL = "One per post, in PLAN.md";

/** `2026-11-02T07:00` → `2026-11-02 07:00 CT`. */
export function publishesCell(publishAt: string): string {
  return `${publishAt.replace("T", " ")} CT`;
}

/** The source URLs a page cites anywhere (intro, sections, FAQ), sorted, each once. */
export function citedSourceUrls(page: BlogPost["page"]): string[] {
  const urls = new Set<string>();
  const blocks = [...page.intro, ...page.sections.flatMap((s) => s.blocks)];
  for (const block of blocks) {
    if ("sources" in block)
      for (const s of block.sources ?? []) urls.add(s.url);
  }
  for (const item of page.faq)
    for (const s of item.sources ?? []) urls.add(s.url);
  return [...urls].sort();
}

export function postProduction(post: BlogPost): ProductionItem {
  return {
    item: post.slug,
    title: post.page.title,
    publishes: publishesCell(post.page.publishAt ?? ""),
    keyword: post.page.targetKeyword ?? "",
    sources: citedSourceUrls(post.page),
  };
}

/** `2026-11-plan`: the month's content plan, its publish slots, the College Board date pages. */
export function planProduction(cycle: string): ProductionItem {
  const month = cycle.replace(/-plan$/, "");
  const slots = publishSlots(`${month}-01`, lastDay(month));
  const first = slots[0]?.slice(0, 10) ?? "";
  const last = slots[slots.length - 1]?.slice(0, 10) ?? "";
  return {
    item: "plan",
    title: `${monthTitle(month)} content plan`,
    publishes: `${slots.length} posts, ${first} to ${last}`,
    keyword: PLAN_KEYWORD_CELL,
    sources: [SAT_DATES_SOURCE_URL, SAT_SCORE_RELEASE_SOURCE_URL].sort(),
  };
}

/** The items a cycle carries now, as section 1 must record them. */
export function cycleProduction(
  cycle: string,
  posts: readonly BlogPost[] = ALL_BLOG_POSTS,
): ProductionItem[] {
  if (cycle.endsWith("-plan")) return [planProduction(cycle)];
  return posts.filter((p) => p.batch === cycle).map(postProduction);
}

/** A table cell: a pipe in the text (a page title's "… | Lyceon") is escaped. */
const cell = (text: string): string => text.replace(/\|/g, "\\|");

/** The row Claude writes for an item. */
export function productionRow(p: ProductionItem): string {
  const sources = p.sources.map((u) => `<${u}>`).join(" ");
  return `| \`${p.item}\` | ${cell(p.title)} | ${p.publishes} | ${cell(p.keyword)} | ${sources} | ${PASSED_INTERNAL_AUDIT} |`;
}

export function productionTable(items: readonly ProductionItem[]): string {
  return [...PRODUCTION_HEADER, ...items.map(productionRow)].join("\n");
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const cycle = process.argv[2] ?? "";
  const items = cycleProduction(cycle);
  if (items.length === 0) {
    process.stderr.write(`no items for cycle "${cycle}"\n`);
    process.exit(1);
  }
  process.stdout.write(`${productionTable(items)}\n`);
}
