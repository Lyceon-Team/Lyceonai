/**
 * Which blog posts are NOT public at a given instant, and the module file of each.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.3 ("Before then it is not prerendered, not in the sitemap
 *       or index, and returns 404"); owner answer on Doc 10B Phase 1 Step 0, item 4 (Karl,
 *       2026-10-11): "filter future and unapproved posts at build time"] | @implemented [2026-10-11]
 *
 * plain English: the content-schedule Vite plugin runs this once per build (`--now <ISO>`, the
 * build's single instant) and replaces each listed module with `export default null`, so a withheld
 * post's words are in no bundle, no prerendered page, no sitemap and no index. Visibility is
 * decided by the one shared rule, isPagePublic (shared/content/schedule.ts). Prints JSON:
 * `{ "now": "<ISO>", "withheld": [{ "slug", "file" }] }`.
 *
 * edge cases:
 *  - A withheld post must live in its own module, shared/content/posts/<slug>.ts; a withheld post
 *    anywhere else (e.g. inside blog.ts) cannot be stubbed, so this exits 1 and the build fails
 *    rather than shipping it.
 *  - A bad `--now` exits 1.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BLOG_POSTS, type BlogPost } from "../../shared/content/blog";
import { isPagePublic } from "../../shared/content/schedule";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const POSTS_DIR = join(ROOT, "shared", "content", "posts");

export type WithheldPost = { slug: string; file: string };

/** The posts not public at `now`, each with its module file. Throws if one has no own module. */
export function withheldPosts(
  posts: readonly BlogPost[],
  now: Date,
  postsDir: string = POSTS_DIR,
  fileExists: (file: string) => boolean = existsSync,
): WithheldPost[] {
  return posts
    .filter((post) => !isPagePublic(post.page, now))
    .map((post) => {
      const file = join(postsDir, `${post.slug}.ts`);
      if (!fileExists(file)) {
        throw new Error(
          `blog post ${post.slug} is not public yet but has no module of its own (${file}); it cannot be kept out of the build`,
        );
      }
      return { slug: post.slug, file };
    });
}

function main(argv: readonly string[]): void {
  const at = argv.indexOf("--now");
  const raw = at >= 0 ? argv[at + 1] : undefined;
  const now = raw === undefined ? new Date() : new Date(raw);
  if (Number.isNaN(now.getTime())) {
    process.stderr.write(
      `withheld-posts: --now is not a date: ${String(raw)}\n`,
    );
    process.exit(1);
  }
  const withheld = withheldPosts(ALL_BLOG_POSTS, now);
  process.stdout.write(
    `${JSON.stringify({ now: now.toISOString(), withheld })}\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
