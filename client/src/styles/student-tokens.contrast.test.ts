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

/**
 * The light set is two blocks since UI-42 (2026-10-03): the level ramp and its two neutrals
 * moved to a block that also matches `:root`, so the shared `LevelPill` and mastery meter keep
 * their colours outside the `.lyc` root (the guardian Dashboard). Merged, it is the same 59.
 */
const RAMP_BLOCK =
  ':root,\n.lyc,\n:root[data-theme="dark"] .lyc[data-theme-lock="light"] {';

const SETS = {
  light: { ...block(".lyc,"), ...block(RAMP_BLOCK) },
  dark: block(':root[data-theme="dark"] .lyc:not'),
};

describe("the level ramp resolves outside the student root", () => {
  it("declares every --lv token, --seg-empty and --rule-strong on :root, in the light values", () => {
    expect(css).toContain(RAMP_BLOCK);
    const ramp = block(RAMP_BLOCK);
    const names = [
      "rule-strong",
      "seg-empty",
      ...[0, 1, 2, 3, 4].flatMap((n) =>
        ["fill", "bg", "ink", "bd"].map((t) => `lv${n}-${t}`),
      ),
    ];
    expect(Object.keys(ramp).sort()).toEqual([...names].sort());
    // UI-00e: the light pill colours are the Tailwind 100/900/200 shades the pill used before.
    expect([ramp["lv0-bg"], ramp["lv0-ink"], ramp["lv0-bd"]]).toEqual([
      "#fef3c7",
      "#78350f",
      "#fde68a",
    ]);
    expect([ramp["lv4-bg"], ramp["lv4-ink"], ramp["lv4-bd"]]).toEqual([
      "#d1fae5",
      "#064e3b",
      "#a7f3d0",
    ]);
  });

  it("the dark set still overrides every ramp token inside .lyc", () => {
    for (const name of Object.keys(block(RAMP_BLOCK))) {
      expect(SETS.dark[name], name).toBeDefined();
    }
  });
});

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

/**
 * F-63 (owner ruling, Karl, 2026-10-03): the focus ring meets 3:1 (WCAG 2.2 SC 1.4.11) against
 * every surface it is drawn over, in both themes. `--focus` is read from the CSS file above, never
 * copied here.
 *
 * WHICH BACKGROUNDS. The ring is `outline: 3px solid var(--focus); outline-offset: 2px`, so it is
 * drawn OUTSIDE the focused control, over the surface the control sits on. Those surfaces are the
 * page and panel colours (--paper, --margin), cards and dialogs (--sheet), chips and info notices
 * (--chip), hovered rows and buttons (--hover), the rail and the tab bar (--rail), and the tinted
 * notice and category cards (--danger-bg, --cat-*-bg; translucent ones composited over --paper,
 * as they render). Not in the set: --primary-bg and --rail-on-bg are the fills OF a focused
 * control (the primary button, the active rail item), which the offset ring surrounds rather than
 * sits on; text and line tokens (--ink*, --muted, --rule*, --tick, --step, --lock, --lv*-ink) are
 * not surfaces; --scrim only ever sits behind a dialog, whose controls are on --sheet.
 */
const FOCUS_SURFACES = [
  "paper",
  "margin",
  "sheet",
  "chip",
  "hover",
  "rail",
  "danger-bg",
  "cat-math-bg",
  "cat-rw-bg",
  "cat-review-bg",
  "cat-test-bg",
] as const;

describe.each(Object.entries(SETS))(
  "%s theme: the focus ring (F-63)",
  (_name, set) => {
    it("the focus rule draws --focus, and --focus is in the set (presence)", () => {
      expect(css).toMatch(/outline:\s*3px solid var\(--focus\)/);
      expect(set["focus"]).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it.each(FOCUS_SURFACES)("--focus on %s is at least 3:1", (bgName) => {
      const paper = parse(set["paper"]!);
      const bg = over(parse(set[bgName]!), paper);
      const fg = parse(set["focus"]!);
      const r = ratio(fg, bg);
      expect(
        r,
        `focus ${set["focus"]} on ${bgName} = ${r.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    });
  },
);
