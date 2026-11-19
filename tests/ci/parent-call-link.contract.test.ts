/**
 * Book a call: one constant, read by every placement, a plain outbound link in a new tab.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §4, §6 ("Call link: every placement reads the one constant")] | @implemented
 *        [2026-11-19]
 *
 * plain English: the Calendly URL is spelled out in exactly one file
 * (packages/shared/src/support-contact.ts). Each placement — the guardian home with no
 * student, and the guardian account menu — links to PARENT_CALL_URL with target="_blank" and
 * rel="noopener noreferrer". No Calendly script or embed is loaded anywhere.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PARENT_CALL_URL } from "../../packages/shared/src/support-contact";

const ROOT = process.cwd();
const PLACEMENTS = [
  "client/src/features/guardian/GuardianHome.tsx",
  "client/src/components/layout/GuardianShell.tsx",
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) continue;
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|js|mjs|html)$/.test(name)) out.push(full);
  }
  return out;
}

describe("the parent call link", () => {
  it("is the brief's URL, defined once", () => {
    expect(PARENT_CALL_URL).toBe(
      "https://calendly.com/amingwa-lyceon/lyceon-for-parents-15-minute-call",
    );
    const spelled = ["client", "server", "packages/shared/src", "shared"]
      .flatMap((d) => sourceFiles(path.join(ROOT, d)))
      .filter((f) => readFileSync(f, "utf8").includes("calendly.com"))
      .map((f) => path.relative(ROOT, f));
    expect(spelled).toEqual(["packages/shared/src/support-contact.ts"]);
  });

  it.each(PLACEMENTS)(
    "%s links to PARENT_CALL_URL in a new tab, with no opener",
    (file) => {
      const src = readFileSync(path.join(ROOT, file), "utf8");
      expect(src).toMatch(
        /import \{ PARENT_CALL_URL \} from "@lyceon\/shared\/support-contact";/,
      );
      const at = src.indexOf("href={PARENT_CALL_URL}");
      expect(at).toBeGreaterThan(-1);
      const anchor = src.slice(at, src.indexOf(">", at));
      expect(anchor).toContain('target="_blank"');
      expect(anchor).toContain('rel="noopener noreferrer"');
    },
  );

  it("no Calendly script or embed is loaded", () => {
    // client/ includes client/index.html, the one HTML shell every page loads.
    const loaders = sourceFiles(path.join(ROOT, "client")).filter((f) =>
      /assets\.calendly\.com|calendly-inline-widget|Calendly\.init/.test(
        readFileSync(f, "utf8"),
      ),
    );
    expect(loaders).toEqual([]);
  });
});
