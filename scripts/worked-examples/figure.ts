/**
 * Draws a worked example's figure: SVG strokes and handwritten labels under the notepad, each
 * written on in turn, stroke by stroke.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 7: "SVG stroke animation in
 *       HyperFrames, approved. For geometry and graph questions, the opening scene draws the
 *       figure (triangle, cylinder, cone, circle, graph) stroke by stroke in the notepad style,
 *       with the question's labels, and the solution builds on that same drawing. CPU only. The
 *       Manim pilot stays reference only."] | @implemented [2026-11-11]
 *
 * plain English: pure. The figure's box (the question's units, y up) is scaled uniformly and
 * centred into the band at the bottom of the safe area (FIGURE_TOP..FIGURE_BOTTOM), so a circle
 * stays round. Every shape becomes one or more strokes: one SVG path each, in the ink colour,
 * round caps. A cylinder is its top ellipse, two sides, the base's front half, then its back half
 * dashed; a cone is the base (front, then the back dashed) and its two slant sides; axes carry
 * arrowheads; a right-angle mark is a fixed-size square corner. A solid stroke carries its exact
 * length, so it is drawn on as a stroke-dashoffset from just past that length to 0 (no runtime
 * measuring; hiddenOffset). A dashed (hidden) edge already uses the dash pattern, so it fades in
 * over its slot instead. Labels are Caveat handwriting, centred on their point, written on with
 * the notepad's ink wipe.
 *
 * Timing (figureBeats): the items drawn at one moment are drawn one after another in the order
 * the figure lists them, sharing that moment's window: the opening (from OPEN_DRAW_START, after
 * the hook is up, to just before the first step), a step (after its notepad line is written,
 * until the next line starts) or the answer (after the circle).
 *
 * trade-off: no shading, fills or curved arrows: the notepad style is line drawing, and a short
 * list of shapes keeps each figure checkable (F1-F3, shared/worked-examples/figure-rules.ts).
 */
import type {
  WorkedExampleFigure,
  WorkedExampleFigureShape,
  WorkedExampleFigureWhen,
} from "../../packages/shared/src/worked-example-schema";
import { graphPoints } from "../../shared/worked-examples/figure-rules";
import { escapeHtml } from "./kit";

/** The figure's band: under the notepad, down to the notepad's bottom edge. */
export const FIGURE_TOP = 1090;
export const FIGURE_BOTTOM = 1530;
/** Room kept inside the band for labels at the box's edges. */
export const FIGURE_PAD = 40;
/** The notepad stops this far above the figure. */
export const FIGURE_GAP = 20;
export const FIGURE_STROKE_PX = 6;
export const FIGURE_LABEL_PX = 56;
const RIGHT_ANGLE_PX = 26;
const ARROW_PX = 22;
const DASH_PX = 16;
const DASH_GAP_PX = 12;
/** Points per full turn of an ellipse. */
const ELLIPSE_STEPS = 64;
/** The opening's first stroke starts after the hook is on screen (0.5 s, the brief's limit). */
export const OPEN_DRAW_START = 0.6;
const ITEM_MIN = 0.25;
const ITEM_MAX = 0.9;

type Pt = [number, number];
type Stroke = { subpaths: Pt[][]; dashed: boolean };

export type FigureItem =
  | {
      type: "stroke";
      id: string;
      when: WorkedExampleFigureWhen;
      d: string;
      length: number;
      dashed: boolean;
    }
  | {
      type: "label";
      id: string;
      when: WorkedExampleFigureWhen;
      text: string;
      x: number;
      y: number;
    };

export type FigureLayout = { items: FigureItem[] };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Seconds, rounded as the composition rounds its timings. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Maps the box (y up) into the band (px, y down), uniform scale, centred. */
export function figureMapper(
  box: WorkedExampleFigure["box"],
  band: { left: number; right: number; top: number; bottom: number },
): { at: (p: Pt) => Pt; scale: number } {
  const w = band.right - band.left - 2 * FIGURE_PAD;
  const h = band.bottom - band.top - 2 * FIGURE_PAD;
  const bw = box.x[1] - box.x[0];
  const bh = box.y[1] - box.y[0];
  const scale = Math.min(w / bw, h / bh);
  const ox = band.left + FIGURE_PAD + (w - bw * scale) / 2;
  const oy = band.top + FIGURE_PAD + (h - bh * scale) / 2;
  return {
    scale,
    at: ([x, y]) => [ox + (x - box.x[0]) * scale, oy + (box.y[1] - y) * scale],
  };
}

/** An ellipse arc in px (y down): angle 0 at the right, 90° at the bottom (the front). */
function arc(
  c: Pt,
  rx: number,
  ry: number,
  fromDeg: number,
  toDeg: number,
): Pt[] {
  const n = Math.max(
    2,
    Math.ceil((Math.abs(toDeg - fromDeg) / 360) * ELLIPSE_STEPS),
  );
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = ((fromDeg + ((toDeg - fromDeg) * k) / n) * Math.PI) / 180;
    out.push([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)]);
  }
  return out;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * A solid stroke is hidden by offsetting its one dash past the path's start. With round caps a
 * dash offset by exactly its length still paints a dot at the start, so it is pushed one pixel
 * further, and the gap is longer than the path so the next dash never shows.
 */
export function hiddenOffset(length: number): number {
  return round2(length + 1);
}
function hiddenGap(length: number): number {
  return round2(length + 2);
}

/** One shape's strokes in px, in drawing order. Labels are not strokes. */
export function shapeStrokes(
  shape: WorkedExampleFigureShape,
  box: WorkedExampleFigure["box"],
  map: { at: (p: Pt) => Pt; scale: number },
): Stroke[] {
  const at = map.at;
  const solid = (pts: Pt[]): Stroke => ({ subpaths: [pts], dashed: false });
  const dashed = (pts: Pt[]): Stroke => ({ subpaths: [pts], dashed: true });
  switch (shape.kind) {
    case "segment": {
      const pts = [at(shape.from), at(shape.to)];
      return [shape.dashed ? dashed(pts) : solid(pts)];
    }
    case "polygon": {
      const pts = shape.points.map(at);
      const first = pts[0];
      return [solid(first ? [...pts, first] : pts)];
    }
    case "polyline":
      return [solid(shape.points.map(at))];
    case "circle":
      return [
        solid(
          arc(
            at(shape.center),
            shape.r * map.scale,
            shape.r * map.scale,
            -90,
            270,
          ),
        ),
      ];
    case "right_angle": {
      const v = at(shape.vertex);
      const unit = (p: Pt): Pt => {
        const d = dist(v, p) || 1;
        return [(p[0] - v[0]) / d, (p[1] - v[1]) / d];
      };
      const ua = unit(at(shape.a));
      const ub = unit(at(shape.b));
      const s = RIGHT_ANGLE_PX;
      return [
        solid([
          [v[0] + ua[0] * s, v[1] + ua[1] * s],
          [v[0] + (ua[0] + ub[0]) * s, v[1] + (ua[1] + ub[1]) * s],
          [v[0] + ub[0] * s, v[1] + ub[1] * s],
        ]),
      ];
    }
    case "cylinder": {
      const [bx, by] = shape.base;
      const rx = shape.r * map.scale;
      const ry = shape.ry * map.scale;
      const base = at([bx, by]);
      const top = at([bx, by + shape.h]);
      return [
        solid(arc(top, rx, ry, 180, 540)),
        solid([at([bx - shape.r, by + shape.h]), at([bx - shape.r, by])]),
        solid([at([bx + shape.r, by + shape.h]), at([bx + shape.r, by])]),
        solid(arc(base, rx, ry, 180, 0)),
        dashed(arc(base, rx, ry, 180, 360)),
      ];
    }
    case "cone": {
      const [bx, by] = shape.base;
      const rx = shape.r * map.scale;
      const ry = shape.ry * map.scale;
      const base = at([bx, by]);
      const apex = at([bx, by + shape.h]);
      return [
        solid(arc(base, rx, ry, 180, 0)),
        dashed(arc(base, rx, ry, 180, 360)),
        solid([at([bx - shape.r, by]), apex]),
        solid([apex, at([bx + shape.r, by])]),
      ];
    }
    case "axes": {
      const x0 = at([box.x[0], 0]);
      const x1 = at([box.x[1], 0]);
      const y0 = at([0, box.y[0]]);
      const y1 = at([0, box.y[1]]);
      const a = ARROW_PX;
      return [
        {
          subpaths: [
            [x0, x1],
            [[x1[0] - a, x1[1] - a / 2], x1, [x1[0] - a, x1[1] + a / 2]],
          ],
          dashed: false,
        },
        {
          subpaths: [
            [y0, y1],
            [[y1[0] - a / 2, y1[1] + a], y1, [y1[0] + a / 2, y1[1] + a]],
          ],
          dashed: false,
        },
      ];
    }
    case "graph":
      return [solid(graphPoints(shape).map(at))];
    case "label":
      return [];
  }
}

function strokeLength(s: Stroke): number {
  let n = 0;
  for (const sub of s.subpaths)
    for (let k = 1; k < sub.length; k++)
      n += dist(sub[k - 1] as Pt, sub[k] as Pt);
  return n;
}

function pathD(s: Stroke): string {
  return s.subpaths
    .map((sub) =>
      sub
        .map((p, k) => `${k === 0 ? "M" : "L"}${round2(p[0])} ${round2(p[1])}`)
        .join(" "),
    )
    .join(" ");
}

/** The figure's strokes and labels in px, in drawing order. */
export function layoutFigure(
  figure: WorkedExampleFigure,
  band: { left: number; right: number },
): FigureLayout {
  const map = figureMapper(figure.box, {
    left: band.left,
    right: band.right,
    top: FIGURE_TOP,
    bottom: FIGURE_BOTTOM,
  });
  const items: FigureItem[] = [];
  let strokes = 0;
  let labels = 0;
  for (const shape of figure.shapes) {
    const when = shape.when ?? "open";
    if (shape.kind === "label") {
      const [x, y] = map.at(shape.at);
      items.push({
        type: "label",
        id: `fig-l${++labels}`,
        when,
        text: shape.text,
        x: round2(x),
        y: round2(y),
      });
      continue;
    }
    for (const s of shapeStrokes(shape, figure.box, map))
      items.push({
        type: "stroke",
        id: `fig-s${++strokes}`,
        when,
        d: pathD(s),
        length: round2(strokeLength(s)),
        dashed: s.dashed,
      });
  }
  return { items };
}

export type FigureBeat = {
  id: string;
  when: WorkedExampleFigureWhen;
  start: number;
  end: number;
};

/** Each item's draw window: one after another inside its moment's window. */
export function figureBeats(
  layout: FigureLayout,
  windows: Partial<
    Record<WorkedExampleFigureWhen, { start: number; end: number }>
  >,
): FigureBeat[] {
  const out: FigureBeat[] = [];
  const groups = new Map<WorkedExampleFigureWhen, FigureItem[]>();
  for (const item of layout.items)
    groups.set(item.when, [...(groups.get(item.when) ?? []), item]);
  for (const [when, items] of groups) {
    const w = windows[when];
    if (!w) throw new Error(`the figure draws at ${when}, which has no window`);
    const each = Math.min(
      ITEM_MAX,
      Math.max(ITEM_MIN, (w.end - w.start) / items.length),
    );
    items.forEach((item, k) => {
      // Both ends from the same grid, so one item ends exactly where the next begins.
      out.push({
        id: item.id,
        when,
        start: round3(w.start + k * each),
        end: round3(w.start + (k + 1) * each),
      });
    });
  }
  return out;
}

/** The figure's markup: one full-frame SVG of strokes (hidden until drawn), then the labels. */
export function figureHtml(layout: FigureLayout): string {
  const paths = layout.items
    .filter((i) => i.type === "stroke")
    .map((s) =>
      s.dashed
        ? `<path id="${s.id}" class="fig-stroke" d="${s.d}" stroke-dasharray="${DASH_PX} ${DASH_GAP_PX}" opacity="0" />`
        : `<path id="${s.id}" class="fig-stroke" d="${s.d}" stroke-dasharray="${s.length} ${hiddenGap(s.length)}" stroke-dashoffset="${hiddenOffset(s.length)}" />`,
    )
    .join("\n");
  const labels = layout.items
    .filter((i) => i.type === "label")
    .map(
      (l) =>
        `<div class="fig-label" style="left:${l.x}px; top:${l.y}px; font-size:${FIGURE_LABEL_PX}px"><span id="${l.id}" class="ink">${escapeHtml(l.text)}</span></div>`,
    )
    .join("\n");
  return `<svg class="figure" width="1080" height="1920" viewBox="0 0 1080 1920" stroke-width="${FIGURE_STROKE_PX}">\n${paths}\n</svg>\n${labels}`;
}

/** The figure's tweens for the composition's timeline. */
export function figureTweens(
  layout: FigureLayout,
  beats: readonly FigureBeat[],
): string {
  const byId = new Map(layout.items.map((i) => [i.id, i]));
  return beats
    .map((b) => {
      const item = byId.get(b.id);
      if (!item) throw new Error(`no figure item ${b.id}`);
      const d = round3(b.end - b.start);
      if (item.type === "stroke")
        return item.dashed
          ? `tl.fromTo("#${b.id}", { opacity: 0 }, { opacity: 1, duration: ${d}, ease: "none" }, ${b.start});`
          : `tl.fromTo("#${b.id}", { strokeDashoffset: ${hiddenOffset(item.length)} }, { strokeDashoffset: 0, duration: ${d}, ease: "none" }, ${b.start});`;
      return `tl.fromTo("#${b.id}", { clipPath: "inset(-20% 100% -20% 0%)" }, { clipPath: "inset(-20% 0% -20% 0%)", duration: ${d}, ease: "none" }, ${b.start});`;
    })
    .join("\n");
}
