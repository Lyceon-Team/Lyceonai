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

const css = readFileSync(path.resolve(__dirname, "student-tokens.css"), "utf8");

function block(selectorStart: string): Record<string, string> {
  const i = css.indexOf(selectorStart);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

const SETS = {
  light: block(".lyc,"),
  dark: block(':root[data-theme="dark"] .lyc:not'),
};

type Rgba = [number, number, number, number];

function parse(c: string): Rgba {
  const hex = c.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = c.match(
    /^rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)$/,
  );
  if (rgba)
    return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`unparsed colour ${c}`);
}

function over(top: Rgba, base: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + base[0] * (1 - a),
    top[1] * a + base[1] * (1 - a),
    top[2] * a + base[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

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
  // UI-46 shared primitives (@implemented 2026-10-03): the outline and quiet buttons, tab labels
  // and headings are --ink-strong on every surface they sit on (a hovered button on --hover,
  // the EmptyState on --sheet, the warning Notice and a Sheet on --margin); the info Notice is
  // --ink on --chip and the success Notice --ok on --paper, both already listed.
  ["ink-strong", "sheet"],
  ["ink-strong", "hover"],
  ["ink-strong", "margin"],
  ["ink-strong", "chip"],
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
