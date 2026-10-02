/**
 * F-58: the production CSP allows exactly one inline script, by hash.
 *
 * @spec [student-UI register §8 F-58, owner ruling (Karl) 2026-10-02; UI-47] | @implemented
 *        [2026-10-02]
 *
 * plain English:
 *   1. client/index.html has one inline script, the theme boot, and its sha256 is the constant
 *      the policy carries. Editing the script without updating THEME_BOOT_SCRIPT_HASH fails here;
 *      adding any other inline script fails here.
 *   2. The production policy's script-src is our origin plus that hash: no 'unsafe-inline', no
 *      'unsafe-eval'.
 *   3. The header Express sends in production is that policy, read off a real response.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  THEME_BOOT_SCRIPT_HASH,
  buildCspDirectives,
  securityHeadersMiddleware,
  serializeCsp,
} from "../../server/middleware/security-headers";

const INDEX_HTML = readFileSync(
  path.resolve(__dirname, "../../client/index.html"),
  "utf8",
);

function inlineScripts(html: string): Array<{ tag: string; body: string }> {
  return [...html.matchAll(/(<script\b[^>]*>)([\s\S]*?)<\/script>/gi)]
    .filter((m) => !/\bsrc\s*=/i.test(m[1]!))
    .map((m) => ({ tag: m[1]!, body: m[2]! }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("F-58: inline scripts are allowed by hash only", () => {
  it("the only inline script is the theme boot, and its sha256 is the pinned hash", () => {
    const inline = inlineScripts(INDEX_HTML);
    expect(inline.map((s) => s.tag)).toEqual([
      '<script id="lyceon-theme-boot">',
    ]);
    const digest = createHash("sha256")
      .update(inline[0]!.body)
      .digest("base64");
    expect(`sha256-${digest}`).toBe(THEME_BOOT_SCRIPT_HASH);
  });

  it("production script-src is 'self' plus that hash, with no unsafe allowance", () => {
    const scriptSrc = buildCspDirectives(true).scriptSrc;
    expect(scriptSrc).toEqual(["'self'", `'${THEME_BOOT_SCRIPT_HASH}'`]);
    expect(scriptSrc.join(" ")).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it("Express sends that policy in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = express();
    app.use(securityHeadersMiddleware());
    app.get("/x", (_req, res) => res.json({ ok: true }));
    const res = await request(app).get("/x");
    const header = res.headers["content-security-policy"];
    expect(header).toBe(serializeCsp(buildCspDirectives(true)));
    expect(header).toContain(`script-src 'self' '${THEME_BOOT_SCRIPT_HASH}'`);
    expect(header).not.toMatch(/script-src[^;]*unsafe-inline/);
  });
});
