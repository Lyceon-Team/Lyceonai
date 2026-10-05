#!/usr/bin/env node
/**
 * Serve the production build with the headers vercel.json gives it (register §8 F-59).
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02] | @implemented [2026-10-02]
 *
 * plain English: a stand-in for Vercel's CDN for tests/e2e/page-csp-flows.spec.ts. It serves
 * dist/public and applies vercel.json's `routes` the way Vercel does (the same walk as
 * tests/ci/page-security-headers.ci.test.ts): header routes with `continue: true` add their
 * headers, `handle: filesystem` serves a file that exists, and the routes after it rewrite to
 * the prerendered page, the SPA shell (app.html) or 404.html as vercel.json says. So the browser gets the built bundle with the exact header values production
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
  // SEO Wave 1A (#1054): vercel.json now routes by registry — 301s, filesystem, the prerendered
  // homepage, the SPA shell (app.html), a directory-index rewrite applied only when the file
  // exists (`check`; a miss carries the rewritten path forward, as Vercel does), and a final 404.
  // This walk follows any `dest`/`status`/`check`, not only the old /index.html fallback.
  let pathname = new URL(req.url ?? "/", "http://x").pathname;
  const headers = {};
  let file = null;
  let status = 200;
  for (const route of routes) {
    if (route.handle === "filesystem") {
      file = pathname === "/" ? null : fileFor(pathname);
      if (file) break;
      continue;
    }
    if (route.handle) continue;
    const match = new RegExp(route.src).exec(pathname);
    if (!match) continue;
    Object.assign(headers, route.headers ?? {});
    if (route.continue === true) continue;
    if (route.status === 301) {
      res.writeHead(301, headers);
      res.end();
      return;
    }
    if (!route.dest || route.dest === "/api/index") break;
    const dest = route.dest.replace(
      /\$(\d)/g,
      (_m, i) => match[Number(i)] ?? "",
    );
    const target = fileFor(dest);
    if (route.check === true && !target) {
      pathname = dest;
      continue;
    }
    file = target;
    status = route.status ?? 200;
    break;
  }
  if (!file) {
    res.writeHead(404, { ...headers, "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  res.writeHead(status, {
    ...headers,
    "content-type": TYPES[path.extname(file)] ?? "application/octet-stream",
  });
  res.end(readFileSync(file));
}).listen(port, "127.0.0.1", () => {
  console.log(`page-csp static server on http://127.0.0.1:${port}`);
});
