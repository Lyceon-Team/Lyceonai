/**
 * Renders pipeline posts' prose to Markdown for Vale, and lists their external links for lychee.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §5 gates 6 ("prose passes the Vale linter with the agreed style
 *       guide and an AI-tells rule set") and 8 ("all links resolve"), §9; owner decision 2026-10-11
 *       ("Vale: Microsoft (error level) plus ai-tells, pinned")] | @implemented [2026-10-11]
 *
 * plain English: posts are TypeScript data (one content model, Doc 10A §8.2), and Vale reads
 * Markdown, so this writes each pipeline post (one with a `batch`, i.e. a shared/content/posts
 * module) to build/content-prose/<slug>.md: the H1, the description, every heading, paragraph, list
 * item, table cell and FAQ, in reading order, with link labels kept. It also writes
 * build/content-prose/links.txt: every external URL the posts cite or link (internal links are
 * already checked by the content gate). The 2024 posts predate the pipeline and are not exported
 * unless `--all` is given. scripts/content/lint-prose.sh runs Vale and lychee over the output.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BLOG_POSTS, type BlogPost } from "../../shared/content/blog";
import { inlineLinks } from "../../shared/seo/content-gate";
import type {
  ContentBlock,
  ContentPage,
} from "../../packages/shared/src/seo-content-schema";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const PROSE_DIR = join(ROOT, "build", "content-prose");

function blockMarkdown(block: ContentBlock): string[] {
  switch (block.type) {
    case "p":
      return [block.text];
    case "ul":
      return block.items.map((i) => `- ${i}`);
    case "table":
      return [
        block.caption,
        ...[block.head, ...block.rows].map(
          (row) =>
            `| ${row.map((c) => (typeof c === "string" ? c : "")).join(" | ")} |`,
        ),
        ...(block.note ? [block.note] : []),
      ];
    case "links":
      return block.items.map((l) => `- [${l.label}](${l.href})`);
    default:
      return [];
  }
}

/** The post as a reader reads it, in Markdown. */
export function postProseMarkdown(page: ContentPage): string {
  const out: string[] = [`# ${page.h1}`, "", page.description, ""];
  for (const block of page.intro) out.push(...blockMarkdown(block), "");
  for (const section of page.sections) {
    out.push(`${"#".repeat(section.level)} ${section.heading}`, "");
    for (const block of section.blocks) out.push(...blockMarkdown(block), "");
  }
  for (const item of page.faq)
    out.push(`### ${item.question}`, "", item.answer, "");
  return `${out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

/** Every external URL a page cites (sources) or links inline. */
export function externalLinks(page: ContentPage): string[] {
  const urls = new Set<string>();
  const visit = (v: unknown): void => {
    if (typeof v === "string") {
      for (const l of inlineLinks(v))
        if (l.href.startsWith("https://")) urls.add(l.href);
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "url" && typeof x === "string") urls.add(x);
        else visit(x);
      }
    }
  };
  visit(page);
  return [...urls].sort();
}

/** The pipeline posts: those carried by a batch (the 2024 posts have none). */
export function pipelinePosts(
  all: readonly BlogPost[],
  everything: boolean,
): BlogPost[] {
  return all.filter((p) => everything || p.batch !== undefined);
}

function main(argv: readonly string[]): void {
  const posts = pipelinePosts(ALL_BLOG_POSTS, argv.includes("--all"));
  rmSync(PROSE_DIR, { recursive: true, force: true });
  mkdirSync(PROSE_DIR, { recursive: true });
  const links = new Set<string>();
  for (const post of posts) {
    writeFileSync(
      join(PROSE_DIR, `${post.slug}.md`),
      postProseMarkdown(post.page),
    );
    for (const url of externalLinks(post.page)) links.add(url);
  }
  writeFileSync(
    join(PROSE_DIR, "links.txt"),
    [...links].sort().join("\n") + (links.size ? "\n" : ""),
  );
  process.stdout.write(
    `export-prose: ${posts.length} post(s), ${links.size} external link(s)\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
