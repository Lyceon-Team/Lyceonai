/**
 * @spec [SEO follow-up 2026-10-05: grey secondary text meets WCAG AA on the cream background
 *        (Lighthouse color-contrast); student-UI register UI-47 for the method] |
 *       @implemented [2026-10-05]
 *
 * plain English: reads the real app tokens in index.css (`:root` light, `.dark` dark) and checks
 * `--muted-foreground`, the grey secondary text every public page uses, and `--foreground` against
 * every surface they sit on, at WCAG AA for body text (4.5:1). `bg-secondary/50` (the homepage
 * trust strip) is the secondary colour at half opacity over the page background.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssVarBlock, over, parse, ratio, type Rgba } from "./wcag-contrast";

const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf8");

const SETS = {
  light: cssVarBlock(css, ":root {"),
  dark: cssVarBlock(css, ".dark {"),
};

const TEXT = ["muted-foreground", "foreground"] as const;
const SURFACES = [
  "background",
  "card",
  "secondary",
  "muted",
  "secondary/50",
] as const;

function surface(set: Record<string, string>, name: string): Rgba {
  const page = parse(set["background"]!);
  if (name === "secondary/50") {
    const s = parse(set["secondary"]!);
    return over([s[0], s[1], s[2], 0.5], page);
  }
  return over(parse(set[name]!), page);
}

describe.each(Object.entries(SETS))(
  "%s app tokens: WCAG AA text contrast",
  (_name, set) => {
    it("parsed the tokens this test reads (presence first)", () => {
      for (const t of [...TEXT, "background", "card", "secondary", "muted"]) {
        expect(set[t], `--${t}`).toBeDefined();
      }
    });

    for (const text of TEXT) {
      it.each(SURFACES)(`${text} on %s is at least 4.5:1`, (bgName) => {
        const bg = surface(set, bgName);
        const fg = over(parse(set[text]!), bg);
        const r = ratio(fg, bg);
        expect(
          r,
          `${text} on ${bgName} = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  },
);
