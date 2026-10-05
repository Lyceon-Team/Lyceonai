#!/usr/bin/env node
/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F2, F3; owner ruling 2026-10-03 (approach A)]
 * @implemented [2026-10-03]
 *
 * plain English: the last step of `pnpm run build`. It loads the SSR bundle Vite built from
 * client/src/prerender/entry-server.tsx, renders every prerendered route in
 * infra/route-surface-classification.yaml, and writes into dist/public:
 *   - <route>/index.html for each public page (index.html for `/`),
 *   - 404.html (noindex) for every path nothing else answers,
 *   - app.html, the untouched SPA shell vercel.json hands the signed-in routes,
 *   - sitemap.xml, generated from the registry with content-dated lastmod.
 * Then it deletes dist/prerender, so the SSR bundle never ships.
 *
 * Fails (exit 1) on any render error, missing metadata or registry problem: a page that cannot be
 * prerendered must not deploy as an empty shell.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const publicDir = path.join(repoRoot, "dist/public");
const ssrDir = path.join(repoRoot, "dist/prerender");
const entry = path.join(ssrDir, "entry-server.js");

if (!fs.existsSync(entry)) {
  console.error(
    `prerender: ${path.relative(repoRoot, entry)} not found — run the SSR build first`,
  );
  process.exit(1);
}

const template = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const { prerenderSite } = await import(pathToFileURL(entry).href);

let site;
try {
  site = await prerenderSite({ repoRoot, template });
} catch (error) {
  console.error(
    "prerender failed:",
    error instanceof Error ? error.stack : error,
  );
  process.exit(1);
}

// The shell first: index.html is about to become the prerendered homepage.
fs.writeFileSync(path.join(publicDir, "app.html"), site.shellHtml);
for (const page of site.pages) {
  const out = path.join(publicDir, page.file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page.html);
}
fs.writeFileSync(path.join(publicDir, "404.html"), site.notFoundHtml);
fs.writeFileSync(path.join(publicDir, "sitemap.xml"), site.sitemapXml);
fs.rmSync(ssrDir, { recursive: true, force: true });

console.log(
  `QOTD archive: ${site.qotdArchive.days.length} past day(s) (source: ${site.qotdArchive.source})`,
);
console.log(
  `PRERENDERED ${site.pages.length} pages (${site.pages.filter((p) => p.indexable).length} in sitemap.xml) + 404.html + app.html`,
);
