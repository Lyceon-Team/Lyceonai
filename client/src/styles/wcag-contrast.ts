/**
 * WCAG 2.x contrast arithmetic for the token contrast tests.
 *
 * @spec [student-UI register UI-47 (WCAG AA text contrast); SEO follow-up 2026-10-05 (app tokens
 *       meet AA on public pages)] | @implemented [2026-10-05]
 *
 * plain English: reads the custom properties of one CSS rule, parses #rrggbb / rgba() colours,
 * composites a translucent colour over what it renders on, and returns the WCAG contrast ratio.
 * Moved out of student-tokens.contrast.test.ts unchanged so the app-token test uses the same
 * arithmetic instead of a second copy.
 */
export type Rgba = [number, number, number, number];

/** The `--name: value;` declarations of the first rule whose text starts at `selectorStart`. */
export function cssVarBlock(
  css: string,
  selectorStart: string,
): Record<string, string> {
  const i = css.indexOf(selectorStart);
  if (i === -1) throw new Error(`no rule starting "${selectorStart}"`);
  const body = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

export function parse(c: string): Rgba {
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

/** `top` composited over an opaque `base`, as it renders. */
export function over(top: Rgba, base: Rgba): Rgba {
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

export function ratio(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}
