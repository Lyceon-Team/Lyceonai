/**
 * @spec [SCL-145 (code-point offsets); E7b owner ruling 5 (maths left whole)]
 * @implemented [2026-09-25]
 */
import { describe, expect, it } from "vitest";
import {
  addHighlight,
  buildPassageSegments,
  normalizeHighlights,
  removeHighlights,
  snapRange,
} from "./passage";

describe("passage segments", () => {
  it("offsets are code points, not UTF-16 units", () => {
    const p = "😀 kelp forests";
    // code points: 😀=0, ' '=1, k=2 ... "kelp" = [2, 6)
    const segs = buildPassageSegments(p, [{ start: 2, end: 6 }]);
    const hi = segs.filter((s) => s.highlighted);
    expect(hi).toEqual([{ kind: "text", start: 2, end: 6, text: "kelp", highlighted: true }]);
    expect(segs.map((s) => ("text" in s ? s.text : s.source)).join("")).toBe(p);
  });

  it("maths is an atom: a selection inside a formula snaps to its edges", () => {
    const p = "The area is $x^2 + 1$ square units.";
    const f0 = p.indexOf("$");
    const f1 = p.lastIndexOf("$") + 1;
    expect(snapRange(p, f0 + 3, f1 + 4)).toEqual({ start: f0, end: f1 + 4 });
    expect(snapRange(p, 4, f0 + 2)).toEqual({ start: 4, end: f1 });
    const segs = buildPassageSegments(p, [{ start: 4, end: f1 }]);
    const math = segs.find((s) => s.kind === "math")!;
    expect(math).toMatchObject({ start: f0, end: f1, highlighted: true, source: "$x^2 + 1$" });
  });

  it("an escaped dollar is two source characters and one atom", () => {
    const p = "It costs \\$5 today";
    const segs = buildPassageSegments(p, []);
    expect(segs.find((s) => s.kind === "escape")).toMatchObject({ start: 9, end: 11, text: "$" });
    expect(snapRange(p, 10, 12)).toEqual({ start: 9, end: 12 });
  });

  it("adding merges overlaps; removing drops what the range touches; the cap holds", () => {
    const p = "abcdefghijklmnopqrstuvwxyz";
    let h = normalizeHighlights([{ start: 5, end: 8 }, { start: 1, end: 3 }]);
    const added = addHighlight(p, h, 2, 6);
    expect(added).toEqual({ ok: true, highlights: [{ start: 1, end: 8 }] });
    h = [{ start: 1, end: 3 }, { start: 10, end: 12 }];
    expect(removeHighlights(h, 11, 11)).toEqual([{ start: 1, end: 3 }]);
    const many = Array.from({ length: 64 }, (_, i) => ({ start: i * 3, end: i * 3 + 1 }));
    const long = "x".repeat(400);
    expect(addHighlight(long, many, 300, 302)).toEqual({ ok: false, reason: "limit" });
    expect(addHighlight(long, [], 5, 5)).toEqual({ ok: false, reason: "empty" });
  });
});
