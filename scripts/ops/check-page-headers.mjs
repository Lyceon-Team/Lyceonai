#!/usr/bin/env node
/**
 * Check a live deployment's page responses for the headers vercel.json sets (register §8 F-59).
 *
 * @spec [student-UI register §8 F-59, owner ruling (Karl) 2026-10-02: "a page response from the
 *        preview shows the headers"; production proof after deploy for /, /dashboard,
 *        /practice] | @implemented [2026-10-02]
 *
 * plain English: reads the expected headers from vercel.json's header route (so there is one
 * source), requests each path from the given origin with curl, and prints each response's
 * status and security headers. Exits 1 if any header is missing or differs, naming it.
 *
 * usage:
 *   node scripts/ops/check-page-headers.mjs https://lyceon.ai / /dashboard /practice
 * A preview behind Vercel Authentication needs a share token (Vercel MCP
 * get_access_to_vercel_url); pass the token, never a cookie:
 *   VERCEL_SHARE=<token> node scripts/ops/check-page-headers.mjs https://<preview>.vercel.app /
 *
 * Read-only: GET requests for public pages; no sign-in, no cookies of a user.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const vercel = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
const headerRoute = vercel.routes.find((r) => r.headers && r.continue === true);
if (!headerRoute) {
  console.error("vercel.json has no header route");
  process.exit(1);
}
const expected = headerRoute.headers;

const [origin, ...argPaths] = process.argv.slice(2);
if (!origin) {
  console.error("usage: check-page-headers.mjs <origin> [path ...]");
  process.exit(2);
}
const paths = argPaths.length > 0 ? argPaths : ["/"];
const share = process.env.VERCEL_SHARE ?? "";

const jarDir = mkdtempSync(path.join(tmpdir(), "page-headers-"));
const jar = path.join(jarDir, "jar");
let failures = 0;
try {
  if (share) {
    // The share link sets the bypass cookie; nothing else is stored in the jar.
    execFileSync("curl", [
      "-sS",
      "-o",
      "/dev/null",
      "-c",
      jar,
      `${origin}/?_vercel_share=${encodeURIComponent(share)}`,
    ]);
  }
  for (const p of paths) {
    const raw = execFileSync(
      "curl",
      [
        "-sS",
        "-o",
        "/dev/null",
        "-D",
        "-",
        ...(share ? ["-b", jar] : []),
        `${origin}${p}`,
      ],
      { encoding: "utf8" },
    );
    // With a proxy, curl prints the CONNECT response first; the last block is the page's.
    const blocks = raw.trim().split(/\r?\n\r?\n/);
    const block = blocks[blocks.length - 1] ?? "";
    const [statusLine, ...lines] = block.split(/\r?\n/);
    const got = {};
    for (const line of lines) {
      const i = line.indexOf(":");
      if (i > 0)
        got[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    console.log(`${p}  ${statusLine}`);
    for (const [name, value] of Object.entries(expected)) {
      const actual = got[name.toLowerCase()];
      const ok = actual === value;
      if (!ok) failures += 1;
      console.log(
        `  ${ok ? "ok  " : "FAIL"} ${name}: ${actual ?? "(missing)"}`,
      );
    }
  }
} finally {
  rmSync(jarDir, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`${failures} header(s) missing or different`);
  process.exit(1);
}
console.log("all headers present");
