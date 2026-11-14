/**
 * The drawn figure: its checks against the question (F1-F3), its strokes, its timing in the
 * composition, and the notepad and layout around it.
 *
 * @spec [Karl's rulings 2026-11-11, "Weekly video pipeline v2" item 7: "the opening scene draws the
 *       figure (triangle, cylinder, cone, circle, graph) stroke by stroke in the notepad style,
 *       with the question's labels, and the solution builds on that same drawing. CPU only."]
 *       | @implemented [2026-11-11]
 *
 * plain English: the fixture tree's geometry example (SATM2C6PXLX, a cone removed from a cylinder,
 * voiced and committed like any example) is built through the real buildComposition, and the
 * assertions read what comes back. Presence first: the figure, its strokes and its beats exist
 * before anything is said about their absence or order.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  voiceLineSchema,
  workedExampleFigureSchema,
  type WorkedExampleFigure,
} from "../../packages/shared/src/worked-example-schema";
import { figureProblems } from "../../shared/worked-examples/figure-rules";
import {
  buildComposition,
  safeArea,
} from "../../scripts/worked-examples/composition";
import {
  exampleProblems,
  loadExamples,
  loadVoice,
  seedQuestion,
} from "../../scripts/worked-examples/content";
import {
  FIGURE_BOTTOM,
  FIGURE_GAP,
  FIGURE_TOP,
  OPEN_DRAW_START,
  hiddenOffset,
  layoutFigure,
} from "../../scripts/worked-examples/figure";
import { KIT_DIR, ROOT, loadKit } from "../../scripts/worked-examples/kit";
import {
  figureOverlapProblems,
  type Box,
} from "../../scripts/worked-examples/layout-check";

const CONTENT = join(ROOT, "tests/fixtures/worked-examples/social");
const kit = loadKit();
const examples = loadExamples(CONTENT);
const geo = examples.find((e) => e.content.question_id === "SATM2C6PXLX");
if (!geo) throw new Error("the fixture tree has no geometry example");
const plain = examples.find((e) => e.content.question_id === "SATM2CZS1BE");
if (!plain) throw new Error("the fixture tree has no percentages example");
const seeded = seedQuestion(geo.content.question_id);
if (!seeded.ok) throw new Error(seeded.problem);
const question = seeded.question;
const figure = geo.content.figure;
if (!figure) throw new Error("the geometry example has no figure");
const BOX = figure.box;
const outro = voiceLineSchema.parse(
  JSON.parse(readFileSync(join(ROOT, KIT_DIR, "voice/outro.json"), "utf8")),
);
const voice = loadVoice(CONTENT, geo.dir);
const comp = buildComposition({
  example: geo.content,
  question,
  voice: voice.lines,
  outro,
  kit,
});
const layout = layoutFigure(figure, safeArea());
const start = (key: string): number => {
  const l = comp.voice.find((v) => v.key === key);
  if (!l) throw new Error(`no voice line ${key}`);
  return l.start;
};

function withShapes(
  shapes: WorkedExampleFigure["shapes"],
): WorkedExampleFigure {
  return { box: BOX, shapes };
}

describe("the drawn figure (Karl, 2026-11-11)", () => {
  it("the fixture's geometry example passes every rule, its figure included", () => {
    expect(figure.shapes.map((s) => s.kind)).toEqual([
      "cylinder",
      "segment",
      "label",
      "label",
      "cone",
    ]);
    expect(exampleProblems(CONTENT, geo, kit).problems).toEqual([]);
    expect(figureProblems(figure, geo.content.steps.length, question)).toEqual(
      [],
    );
  });

  it("the content check reports a figure's problems (an opening label giving the key away)", () => {
    const spoiled = {
      ...geo,
      content: {
        ...geo.content,
        figure: withShapes([
          ...figure.shapes,
          { kind: "label", text: "640π", at: [0, 8] },
        ]),
      },
    };
    expect(exampleProblems(CONTENT, spoiled, kit).problems).toEqual([
      expect.stringMatching(/F3 figure label 6 "640π" shows 640/),
    ]);
  });

  it("F1 refuses a shape outside the box; F2 a step the example does not have", () => {
    expect(
      figureProblems(
        withShapes([{ kind: "circle", center: [0, 0], r: 20 }]),
        3,
        question,
      ),
    ).toEqual([expect.stringMatching(/^F1 figure shape 1 \(circle\)/)]);
    expect(
      figureProblems(
        withShapes([
          { kind: "segment", from: [0, 0], to: [8, 0], when: "step-4" },
        ]),
        3,
        question,
      ),
    ).toEqual([
      "F2 figure shape 1 (segment) is drawn at step-4, but the example has 3 steps",
    ]);
  });

  it("F3: the opening shows only numbers the question gives, never a choice's", () => {
    // 8 and 15 are in the stem; 960 is the cylinder's volume (step 1); 640 is choice A, the key.
    const label = (text: string, when?: "open" | "step-1") =>
      withShapes([
        {
          kind: "label",
          text,
          at: [0, 0],
          ...(when ? { when } : {}),
        },
      ]);
    expect(figureProblems(label("r = 8"), 3, question)).toEqual([]);
    expect(figureProblems(label("960π"), 3, question)).toEqual([
      expect.stringMatching(/^F3 figure label 1 "960π" shows 960/),
    ]);
    expect(figureProblems(label("640"), 3, question)).toEqual([
      expect.stringMatching(/^F3 figure label 1 "640" shows 640/),
    ]);
    expect(figureProblems(label("960π", "step-1"), 3, question)).toEqual([]);
  });

  it("the schema refuses a long label, an unknown shape and a reversed range", () => {
    const ok = workedExampleFigureSchema.safeParse(figure);
    expect(ok.success).toBe(true);
    const bad = (shape: unknown) =>
      workedExampleFigureSchema.safeParse({ box: figure.box, shapes: [shape] })
        .success;
    expect(
      bad({ kind: "label", text: "a label far too long", at: [0, 0] }),
    ).toBe(false);
    expect(bad({ kind: "sphere", center: [0, 0], r: 1 })).toBe(false);
    expect(
      workedExampleFigureSchema.safeParse({
        box: { x: [5, -5], y: [0, 1] },
        shapes: [{ kind: "axes" }],
      }).success,
    ).toBe(false);
  });

  it("each shape becomes its strokes: a cylinder 5 (one dashed), a cone 4 (one dashed), all inside the figure band", () => {
    const strokes = layout.items.filter((i) => i.type === "stroke");
    const labels = layout.items.filter((i) => i.type === "label");
    expect(strokes.map((s) => [s.when, s.dashed])).toEqual([
      ["open", false],
      ["open", false],
      ["open", false],
      ["open", false],
      ["open", true],
      ["open", false],
      ["step-2", false],
      ["step-2", true],
      ["step-2", false],
      ["step-2", false],
    ]);
    expect(labels.map((l) => l.type === "label" && l.text)).toEqual([
      "8",
      "15",
    ]);
    const safe = safeArea();
    for (const s of strokes) {
      expect(s.length).toBeGreaterThan(0);
      if (s.type !== "stroke") continue;
      const nums = [...s.d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) =>
        Number(m[0]),
      );
      expect(nums.length).toBeGreaterThan(3);
      for (let k = 0; k + 1 < nums.length; k += 2) {
        const [x, y] = [nums[k] ?? NaN, nums[k + 1] ?? NaN];
        expect(x).toBeGreaterThanOrEqual(safe.left);
        expect(x).toBeLessThanOrEqual(safe.right);
        expect(y).toBeGreaterThanOrEqual(FIGURE_TOP);
        expect(y).toBeLessThanOrEqual(FIGURE_BOTTOM);
      }
    }
  });

  it("the opening draws the figure stroke by stroke after the hook is up and before the first step; the cone comes with step 2", () => {
    expect(comp.figure.length).toBe(layout.items.length);
    const open = comp.figure.filter((b) => b.when === "open");
    const cone = comp.figure.filter((b) => b.when === "step-2");
    expect(open.length).toBe(8);
    expect(cone.length).toBe(4);
    expect(open[0]?.start).toBe(OPEN_DRAW_START);
    expect(OPEN_DRAW_START).toBeGreaterThan(0.5);
    open.forEach((b, k) => {
      expect(b.end).toBeGreaterThan(b.start);
      if (k > 0) expect(b.start).toBeGreaterThanOrEqual(open[k - 1]?.end ?? 0);
    });
    expect(open.at(-1)?.end ?? 99).toBeLessThanOrEqual(start("step-1"));
    const write2 = comp.writes.find((w) => w.key === "step-2");
    expect(cone[0]?.start).toBe(write2?.end);
    expect(cone.at(-1)?.end ?? 99).toBeLessThanOrEqual(start("step-3"));
  });

  it("the figure stays from 0:00 to the end card, every stroke hidden until its tween, one tween each", () => {
    const section = /<section id="figure"[^>]*>/.exec(comp.html)?.[0] ?? "";
    expect(section).toContain('data-start="0"');
    expect(section).toContain(`data-duration="${start("outro")}"`);
    for (const item of layout.items) {
      const tweens = comp.html.match(
        new RegExp(`tl\\.fromTo\\("#${item.id}"`, "g"),
      );
      expect(tweens?.length, item.id).toBe(1);
      if (item.type !== "stroke") continue;
      const path =
        new RegExp(`<path id="${item.id}"[^>]*>`).exec(comp.html)?.[0] ?? "";
      expect(path).not.toBe("");
      if (item.dashed) expect(path).toContain('opacity="0"');
      else {
        // Offset past the full length: a round cap would otherwise paint a dot at the start.
        expect(hiddenOffset(item.length)).toBeGreaterThan(item.length);
        expect(path).toContain(
          `stroke-dashoffset="${hiddenOffset(item.length)}"`,
        );
      }
    }
  });

  it("with a figure the notepad stops above it; without one nothing changes", () => {
    const rows = [
      ...comp.html.matchAll(
        /<div class="hand[^"]*" style="top:(\d+)px; font-size:(\d+)px">/g,
      ),
    ].map((m) => Number(m[1]) + Number(m[2]));
    expect(rows.length).toBeGreaterThan(5);
    for (const bottom of rows)
      expect(bottom).toBeLessThanOrEqual(FIGURE_TOP - FIGURE_GAP);
    expect(comp.html).toContain(`bottom(e) <= ${FIGURE_TOP - FIGURE_GAP});`);
    const bare = buildComposition({
      example: plain.content,
      question: (() => {
        const q = seedQuestion(plain.content.question_id);
        if (!q.ok) throw new Error(q.problem);
        return q.question;
      })(),
      voice: loadVoice(CONTENT, plain.dir).lines,
      outro,
      kit,
    });
    expect(bare.figure).toEqual([]);
    expect(bare.html).not.toContain('id="figure"');
    expect(bare.html).toContain("bottom(e) <= 1530);");
  });

  it("the layout check refuses a figure crossing the scenes' text, and passes one clear of it", () => {
    const box = (what: string, y: number, bottom: number): Box => ({
      what,
      x: 100,
      y,
      right: 800,
      bottom,
    });
    const fig = [box("#figure .fig-stroke[0]", 1100, 1500)];
    expect(
      figureOverlapProblems(fig, [box("#work .hand[3]", 980, 1068)]),
    ).toEqual([]);
    expect(
      figureOverlapProblems(fig, [box("#work .hand[3]", 1050, 1140)]),
    ).toEqual([
      expect.stringMatching(
        /^#figure \.fig-stroke\[0\] at y 1100\.\.1500 overlaps #work \.hand\[3\]/,
      ),
    ]);
  });
});
