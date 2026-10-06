/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md §5 F1, F2, F3, F12] | @implemented [2026-10-03]
 *
 * plain English: runs after `pnpm run build` and checks what will actually deploy (dist/public)
 * against infra/route-surface-classification.yaml, in both directions:
 *   registry → output: every indexable static row is in sitemap.xml and has a prerendered file;
 *   output → registry: every sitemap URL has a file, carries its own canonical, and matches an
 *     indexable registry row; every prerendered page file is in the sitemap.
 * Plus: 404.html and app.html exist and are noindex, and no client/public/sitemap.xml exists.
 *
 * Exit 1 with every failure listed. `pnpm run route:validate` covers App.tsx ↔ registry; this
 * covers registry ↔ deployed output.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseRouteRegistry,
  routePatternToVercelSource,
} from "../../shared/seo/route-registry";
import { BASE_URL } from "../../shared/seo/structured-data";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = resolve(ROOT, "dist/public");
const failures: string[] = [];
// Not product code and ships in no bundle; written to the streams directly (no-console, §16).
const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};
const err = (line: string): void => {
  process.stderr.write(`${line}\n`);
};
const fail = (message: string): void => {
  failures.push(message);
};

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return pageFiles(full);
    return name === "index.html" ? [relative(OUT, full)] : [];
  });
}

function urlPathOf(file: string): string {
  const dir = file.replace(/(^|\/)index\.html$/, "");
  return dir === "" ? "/" : `/${dir}`;
}

function locOf(urlPath: string): string {
  return urlPath === "/" ? `${BASE_URL}/` : `${BASE_URL}${urlPath}`;
}

if (!existsSync(join(OUT, "sitemap.xml"))) {
  err(
    "SEO OUTPUT GATE: dist/public/sitemap.xml missing — run `pnpm run build` first",
  );
  process.exit(1);
}

const registry = parseRouteRegistry(
  readFileSync(
    resolve(ROOT, "infra/route-surface-classification.yaml"),
    "utf8",
  ),
);
const indexableRows = registry.filter((r) => r.indexable);
const sitemap = readFileSync(join(OUT, "sitemap.xml"), "utf8");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
  (m) => m[1] ?? "",
);
const locSet = new Set(locs);
const files = pageFiles(OUT);

if (locs.length === 0) fail("sitemap.xml lists no URLs");
if (locSet.size !== locs.length) fail("sitemap.xml lists a URL twice");

// registry → output
for (const row of indexableRows.filter((r) => !r.content_source)) {
  if (!locSet.has(locOf(row.path_pattern)))
    fail(
      `registry row ${row.path_pattern} is indexable but not in sitemap.xml`,
    );
}
// A database-sourced row may legitimately expand to nothing: the Question of the Day archive is
// read at build time (client/src/prerender/qotd-archive-source.ts), so a build without database
// credentials (local, CI) or a production build before the first day has ended has no archive
// days. Production cannot reach this silently — the loader FAILS a Vercel production build that
// lacks the credentials. Code-sourced rows (blog, legal) must always produce URLs.
const DATABASE_SOURCED = new Set(["qotd"]);
for (const row of indexableRows.filter(
  (r) => r.content_source && !DATABASE_SOURCED.has(r.content_source),
)) {
  const re = new RegExp(routePatternToVercelSource(row.path_pattern));
  if (!locs.some((loc) => re.test(loc.slice(BASE_URL.length)))) {
    fail(
      `registry row ${row.path_pattern} (${row.content_source}) produced no sitemap URL`,
    );
  }
}

// output → registry
for (const loc of locs) {
  const urlPath = loc === `${BASE_URL}/` ? "/" : loc.slice(BASE_URL.length);
  const file =
    urlPath === "/" ? "index.html" : `${urlPath.slice(1)}/index.html`;
  if (!existsSync(join(OUT, file))) {
    fail(`sitemap URL ${loc} has no prerendered file (${file})`);
    continue;
  }
  const html = readFileSync(join(OUT, file), "utf8");
  const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
  if (canonical !== loc)
    fail(
      `${file}: canonical ${canonical ?? "(none)"} is not its own URL ${loc}`,
    );
  const row = indexableRows.find((r) =>
    new RegExp(routePatternToVercelSource(r.path_pattern)).test(urlPath),
  );
  if (!row) fail(`sitemap URL ${loc} matches no indexable registry row`);
}
for (const file of files) {
  const loc = locOf(urlPathOf(file));
  if (!locSet.has(loc)) fail(`prerendered ${file} is not in sitemap.xml`);
}

for (const [file, label] of [
  ["404.html", "404 page"],
  ["app.html", "SPA shell"],
] as const) {
  const path = join(OUT, file);
  if (!existsSync(path)) fail(`${label} ${file} missing`);
  else if (
    !readFileSync(path, "utf8").includes(
      '<meta name="robots" content="noindex" />',
    )
  )
    fail(`${label} ${file} is not noindex`);
}
if (existsSync(resolve(ROOT, "client/public/sitemap.xml")))
  fail(
    "client/public/sitemap.xml exists: the sitemap is generated, not hand-written",
  );

if (failures.length > 0) {
  err(`SEO OUTPUT GATE FAILED (${failures.length}):`);
  for (const f of failures) err(`  - ${f}`);
  process.exit(1);
}
out(
  `SEO OUTPUT GATE OK: ${locs.length} sitemap URLs ↔ ${files.length} prerendered pages ↔ ${indexableRows.length} indexable registry rows`,
);
