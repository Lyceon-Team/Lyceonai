/**
 * Keeps blog posts that are not yet public out of every built bundle.
 *
 * @spec [docs/Spec/Lyceon_Doc_10B.md §8.3 ("An approved item is public only once its date arrives.
 *       Before then it is not prerendered, not in the sitemap or index, and returns 404"); owner
 *       answer on Doc 10B Phase 1 Step 0, item 4 (Karl, 2026-10-11)] | @implemented [2026-10-11]
 *
 * plain English: the browser bundle and the prerender bundle both import the post list. Filtering
 * that list at runtime would still ship a scheduled post's words in the JavaScript, readable by
 * anyone before its date. So at build time this plugin asks scripts/content/withheld-posts.ts
 * which posts are not public at the build's instant (unapproved, or `publishAt` still ahead) and
 * replaces each one's module (shared/content/posts/<slug>.ts) with `export default null`. The
 * post list then has nothing to render, link, prerender or put in the sitemap, and its URL has no
 * file, so Vercel serves the 404.
 *
 * One instant per build: the client build and the prerender build are two `vite build` runs, so
 * the first writes `dist/.content-build-now` and the second reuses it (the `prebuild` step deletes
 * dist/ before every build). A post can never be public in one bundle and withheld in the other.
 * The withheld list is also written to `dist/content-withheld.json` for the output gate
 * (scripts/ci/seo-output-gate.ts), which checks the built files really lack those posts.
 *
 * trade-offs: build-only (`apply: "build"`); in dev every post is visible, which is what an author
 * previewing a draft needs. Fail-closed: if the list cannot be computed the build stops.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { z } from "zod";

const withheldOutputSchema = z
  .object({
    now: z.string().datetime(),
    withheld: z.array(
      z.object({ slug: z.string().min(1), file: z.string().min(1) }).strict(),
    ),
  })
  .strict();
export type WithheldOutput = z.infer<typeof withheldOutputSchema>;

/** A stamp older than this is from an earlier build, not this one. */
const BUILD_NOW_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function buildInstant(stateDir: string): string {
  const file = path.join(stateDir, ".content-build-now");
  if (
    existsSync(file) &&
    Date.now() - statSync(file).mtimeMs < BUILD_NOW_MAX_AGE_MS
  ) {
    return readFileSync(file, "utf8").trim();
  }
  const now = new Date().toISOString();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${now}\n`);
  return now;
}

function runWithheldScript(root: string, now: string): WithheldOutput {
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  const out = execFileSync(
    tsx,
    ["scripts/content/withheld-posts.ts", "--now", now],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  return withheldOutputSchema.parse(JSON.parse(out));
}

export type ContentSchedulePluginOptions = {
  /** For tests: the withheld list, instead of running the script against the repo's posts. */
  resolveWithheld?: (now: string) => WithheldOutput;
  /** For tests: where `.content-build-now` and `content-withheld.json` go (default `<root>/dist`). */
  stateDir?: string;
};

export function contentSchedulePlugin(
  root: string,
  options: ContentSchedulePluginOptions = {},
): Plugin {
  let withheld = new Set<string>();
  return {
    name: "lyceon-content-schedule",
    apply: "build",
    buildStart() {
      const stateDir = options.stateDir ?? path.join(root, "dist");
      const now = buildInstant(stateDir);
      const result = (
        options.resolveWithheld ?? ((n) => runWithheldScript(root, n))
      )(now);
      withheld = new Set(result.withheld.map((w) => path.resolve(w.file)));
      writeFileSync(
        path.join(stateDir, "content-withheld.json"),
        `${JSON.stringify(result)}\n`,
      );
    },
    load(id) {
      const file = path.resolve(id.split("?")[0] ?? id);
      return withheld.has(file) ? "export default null;\n" : null;
    },
  };
}
