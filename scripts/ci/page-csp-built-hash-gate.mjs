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
 *   - every hash in that script-src belongs to an inline script of the built page (no stale one);
 *   - the theme script's hash equals THEME_BOOT_SCRIPT_HASH, the constant the Express CSP uses.
 *
 * usage: node scripts/ci/page-csp-built-hash-gate.mjs [built-index.html] [vercel.json]
 * (defaults: dist/public/index.html, vercel.json). The selftest passes mutated copies.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const builtPath = process.argv[2] ?? path.join(root, "dist/public/index.html");
const vercelPath = process.argv[3] ?? path.join(root, "vercel.json");
const headersTs = path.join(root, "server/middleware/security-headers.ts");

const problems = [];

if (!existsSync(builtPath)) {
  console.error(
    `page-csp-built-hash-gate: ${builtPath} not found; run the build first`,
  );
  process.exit(1);
}
const html = readFileSync(builtPath, "utf8");

const openings = [...html.matchAll(/<script\b[^>]*>/gi)].length;
const scripts = [
  ...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script\b[^>]*>/gi),
];
if (scripts.length !== openings) {
  problems.push(
    `${openings} <script> openings but ${scripts.length} closed scripts`,
  );
}
const inline = scripts
  .filter((m) => !/\bsrc\s*=/i.test(m[1]))
  .map((m) => ({
    tag: m[1],
    hash: `sha256-${createHash("sha256").update(m[2]).digest("base64")}`,
  }));

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

for (const s of inline) {
  if (!allowed.includes(s.hash)) {
    problems.push(
      `built inline script ${s.tag} hashes to ${s.hash}, not in the page script-src`,
    );
  }
}
for (const h of allowed) {
  if (!inline.some((s) => s.hash === h)) {
    problems.push(
      `page script-src allows ${h}, which no inline script of the built page has`,
    );
  }
}

const pinned = /THEME_BOOT_SCRIPT_HASH\s*=\s*"([^"]+)"/.exec(
  readFileSync(headersTs, "utf8"),
)?.[1];
const theme = inline.find((s) => /id="lyceon-theme-boot"/.test(s.tag));
if (!theme) problems.push('built page has no <script id="lyceon-theme-boot">');
else if (theme.hash !== pinned) {
  problems.push(
    `built theme script hashes to ${theme.hash}; THEME_BOOT_SCRIPT_HASH is ${pinned}`,
  );
}

if (problems.length > 0) {
  for (const p of problems) console.error(`page-csp-built-hash-gate: ${p}`);
  process.exit(1);
}
console.log(
  `page-csp-built-hash-gate: ok (${inline.length} inline script(s), ${allowed.length} allowed hash(es))`,
);
