/**
 * @spec [student-UI register UI-47: "every text/background pair passes WCAG AA contrast in both"
 *        themes; DESIGN.md §1] | @implemented [2026-10-02]
 *
 * plain English: reads the real student-tokens.css, takes the light and the dark set, and checks
 * every text colour against the background it is designed to sit on at WCAG AA for body text
 * (4.5:1). Translucent backgrounds (the dark level and category tints) are composited over the
 * page colour first, which is how they render.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cssVarBlock, over, parse, ratio } from "./wcag-contrast";

const css = readFileSync(path.resolve(__dirname, "student-tokens.css"), "utf8");

function block(selectorStart: string): Record<string, string> {
  return cssVarBlock(css, selectorStart);
}

const SETS = {
  light: block(".lyc,"),
  dark: block(':root[data-theme="dark"] .lyc:not'),
};

/** [text token, background token]. */
const PAIRS: Array<[string, string]> = [
  ["ink", "paper"],
  ["ink-strong", "paper"],
  ["muted", "paper"],
  ["ink", "margin"],
  ["muted", "margin"],
  ["ink", "sheet"],
  ["muted", "sheet"],
  ["ink", "chip"],
  ["ink", "hover"],
  ["primary-ink", "primary-bg"],
  ["rail-ink", "rail"],
  ["rail-on-ink", "rail-on-bg"],
  ["danger", "danger-bg"],
  ["danger", "paper"],
  ["ok", "paper"],
  ...[0, 1, 2, 3, 4].map((n): [string, string] => [`lv${n}-ink`, `lv${n}-bg`]),
  ...["math", "rw", "review", "test"].map((c): [string, string] => [
    `cat-${c}-ink`,
    `cat-${c}-bg`,
  ]),
];

describe.each(Object.entries(SETS))(
  "%s theme: WCAG AA text contrast",
  (_name, set) => {
    it("parsed the full token set", () => {
      expect(Object.keys(set).length).toBe(59);
    });

    it.each(PAIRS)("%s on %s is at least 4.5:1", (fgName, bgName) => {
      const paper = parse(set["paper"]!);
      const bg = over(parse(set[bgName]!), paper);
      const fg = over(parse(set[fgName]!), bg);
      const r = ratio(fg, bg);
      expect(
        r,
        `${fgName} on ${bgName} = ${r.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  },
);
