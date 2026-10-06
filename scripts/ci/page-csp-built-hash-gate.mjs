#!/usr/bin/env node
/**
 * The page CSP allows exactly the inline scripts the BUILT page ships (register §8 F-58, F-59).
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02: "the CSP hash matches the
 *        built theme script"; F-58 (hash, never 'unsafe-inline')] | @implemented [2026-10-02]
 *
 * plain English: tests/ci/csp-theme-hash.ci.test.ts hashes the theme script in the SOURCE
 * client/index.html. What the browser checks is the script in the page Vercel serves, which Vite
 * writes to dist/public/index.html. If the build ever rewrote that script (minified it, changed
 * whitespace, injected another), the source test would stay green while every page refused to
 * run it. This runs after the build and requires, for dist/public/index.html:
 *   - every inline script's sha256 appears in the page CSP's script-src in vercel.json;
 *   - every hash in that script-src belongs to an inline script of SOME built page (no stale one);
 *   - the theme script's hash equals THEME_BOOT_SCRIPT_HASH, the constant the Express CSP uses.
 *
 * usage: node scripts/ci/page-csp-built-hash-gate.mjs [built-page.html] [vercel.json]
 * (defaults: EVERY .html page under dist/public, vercel.json). The selftest passes mutated copies.
 *
 * SEO Wave 1A (2026-10-03, #1054): the public pages are now prerendered, so dist/public holds 21 (22
 * until Wave 1B F14 removed /trust/evidence) pages plus 404.html and app.html (the SPA shell) — each a copy of the built template carrying the
 * same theme script. By default every one of them is checked, not only index.html. And a
 * prerendered page carries JSON-LD in <script type="application/ld+json">: a data block, which the
 * HTML spec never executes, so CSP script-src never evaluates it and it needs no hash. Only
 * executable scripts (no type, a JavaScript MIME type, or "module") are hashed; anything else is a
 * data block. An executable inline script still needs its hash, whatever page it is on.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const builtArg = process.argv[2];
const vercelPath = process.argv[3] ?? path.join(root, "vercel.json");
const headersTs = path.join(root, "server/middleware/security-headers.ts");

const problems = [];

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return name.endsWith(".html") ? [full] : [];
  });
}

const publicDir = path.join(root, "dist/public");
const builtPaths = builtArg
  ? [builtArg]
  : existsSync(publicDir)
    ? htmlFiles(publicDir)
    : [];
if (builtPaths.length === 0 || !builtPaths.every((p) => existsSync(p))) {
  console.error(
    `page-csp-built-hash-gate: ${builtArg ?? "dist/public/*.html"} not found; run the build first`,
  );
  process.exit(1);
}

/** HTML spec: a script with no type, a JavaScript MIME type, or "module" executes; any other type is a data block. */
const JS_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
  "text/ecmascript",
]);
function executable(tag) {
  const type = /\btype\s*=\s*["']?([^"'\s>]*)/i.exec(tag)?.[1];
  return type === undefined || JS_TYPES.has(type.trim().toLowerCase());
}

function inspect(file) {
  const html = readFileSync(file, "utf8");
  const rel = path.relative(root, file);
  const openings = [...html.matchAll(/<script\b[^>]*>/gi)].length;
  const scripts = [
    ...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\b[^>]*>/gi),
  ];
  if (scripts.length !== openings) {
    problems.push(
      `${rel}: ${openings} <script> openings but ${scripts.length} closed scripts`,
    );
  }
  const inline = scripts
    .filter((m) => !/\bsrc\s*=/i.test(m[1]) && executable(m[1]))
    .map((m) => ({
      tag: m[1],
      hash: `sha256-${createHash("sha256").update(m[2]).digest("base64")}`,
    }));
  return { rel, inline };
}
const pages = builtPaths.map(inspect);
const inline = pages.flatMap((p) => p.inline);
// A hash is stale only when NO built page ships its script. Pages differ since F13 (2026-10-05):
// the homepage alone carries the hero swap script, so checking one page on its own (the
// selftest's mode) must still count the hashes the rest of the built site uses.
const siteInline = [
  ...inline,
  ...(existsSync(publicDir) && builtArg
    ? htmlFiles(publicDir)
        .filter((f) => !builtPaths.includes(f))
        .flatMap((f) => inspect(f).inline)
    : []),
];

const vercel = JSON.parse(readFileSync(vercelPath, "utf8"));
const route = (vercel.routes ?? []).find(
  (r) => r.headers && r.continue === true,
);
const csp = route?.headers?.["Content-Security-Policy"]?.includes("script-src")
  ? route.headers["Content-Security-Policy"]
  : route?.headers?.["Content-Security-Policy-Report-Only"];
const scriptSrc = (csp ?? "")
  .split(";")
  .map((d) => d.trim())
  .find((d) => d.startsWith("script-src "));
if (!scriptSrc) problems.push("vercel.json page CSP has no script-src");
const allowed = [
  ...(scriptSrc ?? "").matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g),
].map((m) => m[1]);

for (const page of pages) {
  for (const s of page.inline) {
    if (!allowed.includes(s.hash)) {
      problems.push(
        `${page.rel}: built inline script ${s.tag} hashes to ${s.hash}, not in the page script-src`,
      );
    }
  }
}
for (const h of allowed) {
  if (!siteInline.some((s) => s.hash === h)) {
    problems.push(
      `page script-src allows ${h}, which no inline script of the built page has`,
    );
  }
}

const pinned = /THEME_BOOT_SCRIPT_HASH\s*=\s*"([^"]+)"/.exec(
  readFileSync(headersTs, "utf8"),
)?.[1];
for (const page of pages) {
  const theme = page.inline.find((s) => /id="lyceon-theme-boot"/.test(s.tag));
  if (!theme) {
    problems.push(
      `${page.rel}: built page has no <script id="lyceon-theme-boot">`,
    );
  } else if (theme.hash !== pinned) {
    problems.push(
      `${page.rel}: built theme script hashes to ${theme.hash}; THEME_BOOT_SCRIPT_HASH is ${pinned}`,
    );
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`page-csp-built-hash-gate: ${p}`);
  process.exit(1);
}
console.log(
  `page-csp-built-hash-gate: ok (${pages.length} page(s), ${inline.length} executable inline script(s), ${allowed.length} allowed hash(es))`,
);
