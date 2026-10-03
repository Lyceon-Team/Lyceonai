/**
 * Grep guard: the mastery components draw with tokens only, in both themes.
 *
 * @spec [student-UI register UI-00e (the pill colours become the level-ramp tokens), UI-40
 *       (no raw hex outside the token files; nothing below 14px), UI-42; DESIGN.md §1 ("No raw
 *       hex in components"; "Nothing below 14px anywhere")] | @implemented [2026-10-03]
 *
 * plain English: reads every non-test source file in `client/src/components/mastery/` and
 * fails on (1) a hex colour literal, (2) a Tailwind palette colour class (`amber-100`,
 * `bg-sky-900` …) — colour must come from a token, which is what makes the dark theme work —
 * and (3) a text size under 14px. It also checks that every `lyc` token class the files use
 * exists in tailwind.config.ts: a mistyped token class compiles to nothing and draws no colour,
 * which no other check would notice.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import tailwindConfig from "../../../../tailwind.config";

const DIR = __dirname;

/**
 * Code only: block and line comments are removed first, so a PR reference ("#1003") or a
 * pattern written in prose ("`bg-lyc-lvN-bg`") is not read as a class or a colour. The `[^:]`
 * keeps a URL's `//` from being taken for a comment.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FILES = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({
    name: f,
    src: code(readFileSync(path.join(DIR, f), "utf8")),
  }));

const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1,5})?\b/;
const PALETTE =
  /\b(?:bg|text|border|fill|stroke|ring|from|to|via)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const SMALL_TEXT = /\btext-(?:xs|\[(?:[0-9]|1[0-3])(?:\.\d+)?px\])(?![\w-])/;

function lycKeys(group: "colors" | "fontSize" | "fontFamily"): Set<string> {
  const ext = tailwindConfig.theme?.extend as
    | Record<string, Record<string, unknown>>
    | undefined;
  const table = ext?.[group] ?? {};
  if (group === "colors") {
    const lyc = table["lyc"];
    return new Set(
      lyc !== null && typeof lyc === "object" ? Object.keys(lyc) : [],
    );
  }
  return new Set(
    Object.keys(table)
      .filter((k) => k.startsWith("lyc-"))
      .map((k) => k.slice(4)),
  );
}

describe("mastery components use tokens only", () => {
  it("found the component sources (presence before absence)", () => {
    const names = FILES.map((f) => f.name);
    for (const want of [
      "LevelPill.tsx",
      "MasteryMeter.tsx",
      "MasteryRow.tsx",
      "LockedMasteryCard.tsx",
      "DomainGrid.tsx",
    ])
      expect(names).toContain(want);
  });

  it.each(FILES.map((f) => [f.name, f.src] as const))(
    "%s: no hex, no palette colour class, nothing under 14px",
    (_name, src) => {
      expect(src).not.toMatch(HEX);
      expect(src).not.toMatch(PALETTE);
      expect(src).not.toMatch(SMALL_TEXT);
    },
  );

  it("every lyc token class names a token tailwind.config.ts defines", () => {
    const colors = lycKeys("colors");
    const sizes = lycKeys("fontSize");
    const families = lycKeys("fontFamily");
    expect(colors.has("lv0-fill")).toBe(true);
    let seen = 0;
    for (const { name, src } of FILES) {
      for (const m of src.matchAll(
        /\b(bg|text|border|font)-lyc-([a-z0-9-]+)/g,
      )) {
        seen += 1;
        const kind = m[1] ?? "";
        const token = m[2] ?? "";
        const ok =
          kind === "font"
            ? families.has(token)
            : kind === "text"
              ? colors.has(token) || sizes.has(token)
              : colors.has(token);
        expect(ok, `${name}: ${kind}-lyc-${token}`).toBe(true);
      }
    }
    expect(seen).toBeGreaterThan(20);
  });
});
