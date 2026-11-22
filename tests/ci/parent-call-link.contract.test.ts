/**
 * The parent "Book a call" link: one constant, read by every placement, always a plain link.
 *
 * @spec [owner ruling 2026-11-21 (counsel-approved) 8; packages/shared/src/external-links.ts;
 *        SCL-283 (Calendly in the Privacy Policy)] | @implemented [2026-11-22]
 *
 * plain English: the Calendly URL is defined exactly once, every placement imports the constant
 * (the guardian home's no-student state and the guardian account menu, ruling 8), each opens in a
 * new tab with rel="noopener noreferrer", and nothing on the site embeds or loads Calendly: no
 * other file names the URL, and the page CSP allows no Calendly host.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PARENT_CALL_LABEL,
  PARENT_CALL_URL,
} from "../../packages/shared/src/external-links";

const ROOT = path.resolve(__dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

const PLACEMENTS = [
  "client/src/features/guardian/GuardianHome.tsx",
  "client/src/components/layout/GuardianShell.tsx",
];

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), {
    withFileTypes: true,
  })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(rel, out);
    } else if (/\.(ts|tsx|js|mjs|json|html)$/.test(entry.name)) {
      out.push(rel);
    }
  }
}

describe("the parent call link (ruling 8)", () => {
  it("is the one ruled URL, with the ruled label", () => {
    expect(PARENT_CALL_URL).toBe(
      "https://calendly.com/amingwa-lyceon/lyceon-for-parents-15-minute-call",
    );
    expect(PARENT_CALL_LABEL).toBe("Book a call");
  });

  it("every placement reads the constant and opens a plain link in a new tab", () => {
    for (const file of PLACEMENTS) {
      const text = read(file);
      expect(text, file).toContain('from "@lyceon/shared/external-links"');
      expect(text, file).toContain("href={PARENT_CALL_URL}");
      const at = text.indexOf("href={PARENT_CALL_URL}");
      const anchor = text.slice(
        text.lastIndexOf("<a", at),
        text.indexOf(">", at),
      );
      expect(anchor, file).toContain('target="_blank"');
      expect(anchor, file).toContain('rel="noopener noreferrer"');
    }
  });

  it("no other file names the URL, and nothing embeds Calendly", () => {
    const files: string[] = [];
    for (const dir of [
      "client/src",
      "server",
      "packages/shared/src",
      "shared",
    ]) {
      walk(dir, files);
    }
    const naming = files.filter((f) => read(f).includes("calendly.com"));
    expect(naming).toEqual([
      path.join("packages/shared/src/external-links.ts"),
    ]);
    for (const f of files) {
      expect(read(f), f).not.toMatch(
        /assets\.calendly\.com|calendly\.com\/assets|<iframe[^>]*calendly/i,
      );
    }
  });

  it("the page CSP allows no Calendly host (a plain link needs none)", () => {
    expect(read("vercel.json")).not.toMatch(/calendly/i);
    expect(read("client/index.html")).not.toMatch(/calendly/i);
  });
});
