/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md F13; owner-approved homepage design 2026-10-05
 *        (cream #FBF6EC, cards #F6EFE1, navy #11304B); method as app-tokens.contrast.test.ts] |
 *       @implemented [2026-10-05]
 *
 * plain English: reads the real `.home-palette` block in index.css and checks every text colour
 * the homepage uses against every surface it sits on, at WCAG AA for body text (4.5:1). The
 * footer pair is the cream text on the navy footer band.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssVarBlock, over, parse, ratio } from "./wcag-contrast";

const css = readFileSync(path.resolve(__dirname, "../index.css"), "utf8");
const set = cssVarBlock(css, ".home-palette {");

const PAIRS: readonly (readonly [string, string])[] = [
  ["foreground", "background"],
  ["foreground", "card"],
  ["muted-foreground", "background"],
  ["muted-foreground", "card"],
  ["home-caption", "background"],
  ["home-caption", "card"],
  ["home-eyebrow", "background"],
  ["primary-foreground", "primary"],
  ["home-footer-text", "foreground"],
  ["home-footer-muted", "foreground"],
];

describe("homepage palette: WCAG AA text contrast", () => {
  it("parsed every token this test reads (presence first)", () => {
    for (const name of new Set(PAIRS.flat())) {
      expect(set[name], `--${name}`).toBeDefined();
    }
  });

  it.each(PAIRS)("%s on %s is at least 4.5:1", (text, surface) => {
    const bg = parse(set[surface] ?? "");
    const fg = over(parse(set[text] ?? ""), bg);
    const r = ratio(fg, bg);
    expect(
      r,
      `${text} on ${surface} = ${r.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(4.5);
  });
});
