#!/usr/bin/env node
/**
 * Serve the production build with the headers vercel.json gives it (register §8 F-59).
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02] | @implemented [2026-10-02]
 *
 * plain English: a stand-in for Vercel's CDN for tests/e2e/page-csp-flows.spec.ts. It serves
 * dist/public and applies vercel.json's `routes` the way Vercel does (the same walk as
 * tests/ci/page-security-headers.ci.test.ts): header routes with `continue: true` add their
 * headers, `handle: filesystem` serves a file that exists, the last route falls back to
 * /index.html. So the browser gets the built bundle with the exact header values production
 * will send, without depending on a preview's network path. /api is not served: the spec
 * answers it in the browser.
 *
 * usage: pnpm run build, then
 *   node scripts/ops/page-csp-static-server.mjs [port]   (default 5175)
 */
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const publicDir = path.join(root, "dist/public");
const routes = JSON.parse(
  readFileSync(path.join(root, "vercel.json"), "utf8"),
).routes;
const port = Number(process.argv[2] ?? 5175);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

function fileFor(pathname) {
  const p = path.join(publicDir, decodeURIComponent(pathname));
  if (!p.startsWith(publicDir)) return null;
  if (existsSync(p) && statSync(p).isFile()) return p;
  return null;
}

createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://x").pathname;
  const headers = {};
  let file = null;
  for (const route of routes) {
    if (route.handle === "filesystem") {
      file = fileFor(pathname === "/" ? "/index.html" : pathname);
      if (file) break;
      continue;
    }
    if (route.handle) continue;
    if (!new RegExp(route.src).test(pathname)) continue;
    Object.assign(headers, route.headers ?? {});
    if (route.continue === true) continue;
    if (route.dest === "/index.html") file = path.join(publicDir, "index.html");
    break;
  }
  if (!file) {
    res.writeHead(404, { ...headers, "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    ...headers,
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => {
  console.log(`page-csp static server on http://127.0.0.1:${port}`);
});
