/**
 * The drawn figure's checks against its example and question (F1-F3), and the one sampling of a
 * graph that both the checks and the renderer read.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 7: the opening scene draws the
 *       figure "with the question's labels, and the solution builds on that same drawing"; the
 *       anti-spoiler reading of it: the opening shows what the question gives, the work adds the
 *       rest] | @implemented [2026-11-11]
 *
 * plain English: pure.
 *   F1: every shape lies inside the figure's box (a shape outside it would be scaled off the
 *       figure area or squash the rest).
 *   F2: a shape drawn at "step-N" names a step the example has.
 *   F3: a label drawn in the opening shows no number the question's stem or passage does not
 *       give: the figure must not hand over the answer, or a step's result, before the work.
 *       Numbers are compared as written ("8", "15", "2.5"); the choices are NOT read, because one
 *       of them is the answer.
 * edge cases: labels added at a step or the answer are free (they are the work); a figure with
 * no labels passes F3.
 */
import { plainMathText } from "../qotd/plain-math";
import type {
  WorkedExampleFigure,
  WorkedExampleFigureShape,
} from "../../packages/shared/src/worked-example-schema";
import type { HookQuestion } from "./rules";

/** Points per graph: enough for a smooth parabola at the figure's size. */
export const GRAPH_SAMPLES = 41;

/** y = a·x² + b·x + c sampled over x, in the box's units. */
export function graphPoints(
  shape: Extract<WorkedExampleFigureShape, { kind: "graph" }>,
): [number, number][] {
  const [x0, x1] = shape.x;
  const out: [number, number][] = [];
  for (let k = 0; k < GRAPH_SAMPLES; k++) {
    const x = x0 + ((x1 - x0) * k) / (GRAPH_SAMPLES - 1);
    out.push([x, shape.a * x * x + shape.b * x + shape.c]);
  }
  return out;
}

/** The extreme points a shape reaches, in the box's units (for F1). */
export function shapeExtent(
  shape: WorkedExampleFigureShape,
  box: WorkedExampleFigure["box"],
): [number, number][] {
  switch (shape.kind) {
    case "segment":
      return [shape.from, shape.to];
    case "polygon":
    case "polyline":
      return shape.points;
    case "circle": {
      const [x, y] = shape.center;
      return [
        [x - shape.r, y - shape.r],
        [x + shape.r, y + shape.r],
      ];
    }
    case "right_angle":
      return [shape.vertex, shape.a, shape.b];
    case "cylinder": {
      const [x, y] = shape.base;
      return [
        [x - shape.r, y - shape.ry],
        [x + shape.r, y + shape.h + shape.ry],
      ];
    }
    case "cone": {
      const [x, y] = shape.base;
      return [
        [x - shape.r, y - shape.ry],
        [x + shape.r, y + shape.h],
      ];
    }
    case "axes":
      // The axes run along x = 0 and y = 0: the origin must be in the box.
      return [
        [0, 0],
        [box.x[0], 0],
        [box.x[1], 0],
        [0, box.y[0]],
        [0, box.y[1]],
      ];
    case "graph":
      return graphPoints(shape);
    case "label":
      return [shape.at];
  }
}

function numbers(text: string): string[] {
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
}

/** F1-F3 for an example's figure. */
export function figureProblems(
  figure: WorkedExampleFigure,
  stepCount: number,
  q: Pick<HookQuestion, "stem" | "passage">,
): string[] {
  const out: string[] = [];
  const { box } = figure;
  const eps = 1e-9;
  figure.shapes.forEach((s, k) => {
    const name = `figure shape ${k + 1} (${s.kind})`;
    const outside = shapeExtent(s, box).find(
      ([x, y]) =>
        x < box.x[0] - eps ||
        x > box.x[1] + eps ||
        y < box.y[0] - eps ||
        y > box.y[1] + eps,
    );
    if (outside)
      out.push(
        `F1 ${name} reaches (${outside[0]}, ${outside[1]}), outside the box x ${box.x[0]}..${box.x[1]}, y ${box.y[0]}..${box.y[1]}`,
      );
    const when = s.when ?? "open";
    const step = /^step-(\d)$/.exec(when);
    if (step && Number(step[1]) > stepCount)
      out.push(
        `F2 ${name} is drawn at ${when}, but the example has ${stepCount} steps`,
      );
  });
  const given = new Set(numbers(plainMathText(`${q.passage ?? ""} ${q.stem}`)));
  figure.shapes.forEach((s, k) => {
    if (s.kind !== "label" || (s.when ?? "open") !== "open") return;
    for (const n of numbers(s.text))
      if (!given.has(n))
        out.push(
          `F3 figure label ${k + 1} "${s.text}" shows ${n} in the opening, which the question does not give; draw it at the step that works it out`,
        );
  });
  return out;
}
