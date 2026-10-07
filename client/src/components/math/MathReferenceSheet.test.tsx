// @vitest-environment jsdom
/**
 * @spec [College Board SAT Math reference sheet (the "Reference" sheet in Bluebook: circle,
 *        rectangle, triangle, Pythagorean theorem, the two special right triangles, box,
 *        cylinder, sphere, cone, pyramid, and the three facts); production QA 2026-10-07 item 2
 *        (Karl: "fix the 30-60-90 triangle")] | @implemented [2026-10-07]
 *
 * plain English: proves the sheet draws what the College Board sheet draws. The figures are
 * checked as geometry, not as markup: the test reads the drawn triangle's vertices, finds which
 * vertex each angle label sits at and which side each length label sits on, and asserts
 *   - each angle label names the angle actually drawn there (within 1.5 degrees);
 *   - the side opposite 30 degrees is x, opposite 60 degrees x√3, the hypotenuse 2x (and for the
 *     45-45-90: s on both legs, s√2 on the hypotenuse);
 *   - the drawn side lengths have the labelled ratios (1 : √3 : 2 and 1 : 1 : √2).
 * The formulas are read back from KaTeX's own TeX annotation, so the test sees the exact source
 * each formula was rendered from.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import MathReferenceSheet from "./MathReferenceSheet";

type Point = { x: number; y: number };

function renderSheet(): HTMLElement {
  render(<MathReferenceSheet open onOpenChange={() => undefined} />);
  return screen.getByTestId("math-reference-sheet");
}

function vertices(svg: Element): Point[] {
  const polygon = svg.querySelector("polygon");
  if (polygon === null) throw new Error("figure has no triangle");
  const points = (polygon.getAttribute("points") ?? "")
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x: x ?? NaN, y: y ?? NaN };
    });
  expect(points).toHaveLength(3);
  return points;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)),
  );
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** The interior angle at vertex `i`, in degrees. */
function angleAt(v: Point[], i: number): number {
  const p = v[i]!;
  const a = v[(i + 1) % 3]!;
  const b = v[(i + 2) % 3]!;
  const cos =
    ((a.x - p.x) * (b.x - p.x) + (a.y - p.y) * (b.y - p.y)) /
    (distance(p, a) * distance(p, b));
  return (Math.acos(cos) * 180) / Math.PI;
}

function labelPoint(text: Element): Point {
  return {
    x: Number(text.getAttribute("x")),
    y: Number(text.getAttribute("y")),
  };
}

/** Index of the vertex an angle label sits at (the nearest one). */
function vertexOf(v: Point[], text: Element): number {
  const p = labelPoint(text);
  const d = v.map((q) => distance(p, q));
  return d.indexOf(Math.min(...d));
}

/** The side (named by its opposite vertex's index) a length label sits on. */
function sideOf(v: Point[], text: Element): number {
  const p = labelPoint(text);
  const d = [0, 1, 2].map((opposite) =>
    distanceToSegment(p, v[(opposite + 1) % 3]!, v[(opposite + 2) % 3]!),
  );
  return d.indexOf(Math.min(...d));
}

function sideLength(v: Point[], opposite: number): number {
  return distance(v[(opposite + 1) % 3]!, v[(opposite + 2) % 3]!);
}

function texts(svg: Element): Map<string, Element[]> {
  const out = new Map<string, Element[]>();
  for (const t of Array.from(svg.querySelectorAll("text"))) {
    const key = (t.textContent ?? "").trim();
    out.set(key, [...(out.get(key) ?? []), t]);
  }
  return out;
}

function one(map: Map<string, Element[]>, key: string): Element {
  const found = map.get(key) ?? [];
  expect(found, `label "${key}"`).toHaveLength(1);
  return found[0]!;
}

function rightAngleVertex(v: Point[]): number {
  const angles = [0, 1, 2].map((i) => angleAt(v, i));
  const i = angles.findIndex((a) => Math.abs(a - 90) < 0.5);
  expect(i, "the figure has a right angle").toBeGreaterThanOrEqual(0);
  return i;
}

describe("MathReferenceSheet: the 30-60-90 triangle", () => {
  it("labels each side by the angle opposite it, on a figure drawn to those angles", () => {
    const sheet = renderSheet();
    const svg = within(sheet).getByRole("img", { name: /30-60-90/ });
    const v = vertices(svg);
    const labels = texts(svg);

    const at30 = vertexOf(v, one(labels, "30°"));
    const at60 = vertexOf(v, one(labels, "60°"));
    const at90 = rightAngleVertex(v);
    expect(new Set([at30, at60, at90]).size).toBe(3);
    // The angle labels name the angles actually drawn.
    expect(Math.abs(angleAt(v, at30) - 30)).toBeLessThan(1.5);
    expect(Math.abs(angleAt(v, at60) - 60)).toBeLessThan(1.5);

    // Opposite 30° is x, opposite 60° is x√3, the hypotenuse is 2x.
    expect(sideOf(v, one(labels, "x"))).toBe(at30);
    expect(sideOf(v, one(labels, "x√3"))).toBe(at60);
    expect(sideOf(v, one(labels, "2x"))).toBe(at90);

    // And the drawing has those lengths: 1 : √3 : 2.
    const x = sideLength(v, at30);
    expect(sideLength(v, at60) / x).toBeCloseTo(Math.sqrt(3), 1);
    expect(sideLength(v, at90) / x).toBeCloseTo(2, 1);
  });
});

describe("MathReferenceSheet: the 45-45-90 triangle", () => {
  it("labels both legs s and the hypotenuse s√2, on an isosceles right triangle", () => {
    const sheet = renderSheet();
    const svg = within(sheet).getByRole("img", { name: /45-45-90/ });
    const v = vertices(svg);
    const labels = texts(svg);

    const at90 = rightAngleVertex(v);
    const fortyFives = (labels.get("45°") ?? []).map((t) => vertexOf(v, t));
    expect(fortyFives).toHaveLength(2);
    expect(new Set([...fortyFives, at90]).size).toBe(3);
    for (const i of fortyFives) {
      expect(Math.abs(angleAt(v, i) - 45)).toBeLessThan(1.5);
    }

    const legs = (labels.get("s") ?? []).map((t) => sideOf(v, t));
    expect(legs.sort()).toEqual([...fortyFives].sort());
    expect(sideOf(v, one(labels, "s√2"))).toBe(at90);

    const s = sideLength(v, fortyFives[0]!);
    expect(sideLength(v, fortyFives[1]!) / s).toBeCloseTo(1, 2);
    expect(sideLength(v, at90) / s).toBeCloseTo(Math.SQRT2, 1);
  });
});

describe("MathReferenceSheet: the formulas", () => {
  it("renders exactly the College Board sheet's formulas and facts", () => {
    const sheet = renderSheet();
    const tex = Array.from(
      sheet.querySelectorAll('annotation[encoding="application/x-tex"]'),
    ).map((a) => (a.textContent ?? "").replace(/\s+/g, ""));
    expect(tex).toEqual(
      [
        "A=\\pir^2", // circle area
        "C=2\\pir", // circumference
        "A=\\ellw", // rectangle
        "A=\\frac{1}{2}bh", // triangle
        "c^2=a^2+b^2", // Pythagorean theorem
        "V=\\ellwh", // box
        "V=\\pir^2h", // cylinder
        "V=\\frac{4}{3}\\pir^3", // sphere
        "V=\\frac{1}{3}\\pir^2h", // cone
        "V=\\frac{1}{3}\\ellwh", // pyramid
        "360", // degrees of arc in a circle
        "2\\pi", // radians of arc in a circle
        "180", // angles of a triangle
      ].map((s) => s.replace(/\s+/g, "")),
    );
  });
});
