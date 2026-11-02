/**
 * Video pilots: the committed pilot examples pass the worked-example rules, and no pilot script,
 * on-screen line or caption names the third-party graphing calculator.
 *
 * @spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D1; owner ruling (Karl,
 *       2026-11-02): "never use the word 'Desmos' in on-screen text, captions or spoken lines ...
 *       Add a test or a check in check.ts that fails if 'desmos' (case-insensitive) appears in any
 *       pilot script, on-screen line or caption"; worked-example hook rules H1-H6
 *       (shared/worked-examples/rules.ts, SCL-265)] | @implemented [2026-11-02]
 *
 * plain English: the fixtures are the committed pilot sources themselves (every file under
 * video-kit/pilots/ and scripts/video-pilots/manim/pilots/) and their questions from the real seed
 * SQL. The guard is proven to see what it scans first (presence before absence: the two D1 pilots'
 * example and scene module are in the scanned set and are non-empty), then that nothing in it names
 * the calculator, then on the rendered-log path (check.ts logWordHits) that a spoken line and an
 * on-screen string are each caught by themselves. Rendered logs are not committed (renders never
 * are), so that path is exercised on a log built from a committed example's own lines.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workedExampleContentSchema } from "../../packages/shared/src/worked-example-schema";
import { isoWeekCycle } from "../../shared/content/schedule";
import { contentProblems } from "../../shared/worked-examples/rules";
import { scriptLines } from "../../scripts/worked-examples/composition";
import { seedQuestion } from "../../scripts/worked-examples/content";
import { loadKit } from "../../scripts/worked-examples/kit";
import {
  logWordHits,
  timerRows,
  type PilotLinesLog,
} from "../../scripts/video-pilots/manim/check";
import {
  bannedWordHits,
  pilotSourceFiles,
  pilotSourceHits,
} from "../../scripts/video-pilots/manim/word-guard";

const ROOT = join(__dirname, "..", "..");
const D1 = ["SATM2PW20AL", "SATM2XXVNK7"] as const;

function example(
  id: string,
): ReturnType<typeof workedExampleContentSchema.parse> {
  return workedExampleContentSchema.parse(
    JSON.parse(
      readFileSync(
        join(ROOT, "video-kit/pilots/manim", id, "example.json"),
        "utf8",
      ),
    ),
  );
}

describe("video pilots: the calculator-name guard", () => {
  it("scans the D1 pilots' examples and scene modules (presence before absence)", () => {
    const files = pilotSourceFiles(ROOT);
    for (const id of D1) {
      expect(files).toContain(`video-kit/pilots/manim/${id}/example.json`);
      expect(files).toContain(`scripts/video-pilots/manim/pilots/${id}.py`);
      expect(
        readFileSync(
          join(ROOT, "scripts/video-pilots/manim/pilots", `${id}.py`),
          "utf8",
        ).length,
      ).toBeGreaterThan(1000);
    }
  });

  it("no committed pilot script, on-screen line or caption names the calculator", () => {
    expect(pilotSourceHits(ROOT)).toEqual([]);
  });

  it("matches case-insensitively, inside words, and reports the 1-based line", () => {
    const hits = bannedWordHits(
      "f",
      "graph it\nOpen DESMOS now\nmydesmosgraph",
    );
    expect(hits.map((h) => h.line)).toEqual([2, 3]);
    expect(bannedWordHits("f", "the graphing calculator")).toEqual([]);
  });

  it("check.ts catches the name in a spoken line and in an on-screen string, each by itself", () => {
    const kit = loadKit();
    const lines = scriptLines(example("SATM2XXVNK7"), kit.voice.outro_text).map(
      (l, k) => ({
        key: l.key,
        text: l.text,
        wav: `/x/${k}.wav`,
        words: [{ text: "x", start: 0, end: 0.5 }],
        start: k,
        duration: 1,
      }),
    );
    const clean: PilotLinesLog = {
      duration: lines.length,
      lines,
      on_screen: lines.map((l) => l.text),
    };
    expect(clean.lines.length).toBeGreaterThan(5);
    expect(logWordHits(clean)).toEqual([]);
    const spoken = structuredClone(clean);
    const hookLine = spoken.lines[0];
    if (!hookLine) throw new Error("no hook line");
    hookLine.text = `${hookLine.text} Open Desmos.`;
    expect(logWordHits(spoken)).toEqual([
      expect.stringContaining('spoken line "hook":1'),
    ]);
    const shown = structuredClone(clean);
    shown.on_screen = [...(shown.on_screen ?? []), "desmos.com"];
    expect(logWordHits(shown)).toEqual([
      expect.stringContaining(`on-screen string ${lines.length + 1}:1`),
    ]);
  });
});

describe("video pilots: the D1 examples", () => {
  it.each(D1)("%s passes the worked-example rules (H1-H6, key, trap)", (id) => {
    const ex = example(id);
    const found = seedQuestion(id);
    if (!found.ok) throw new Error(found.problem);
    const problems = contentProblems(
      ex,
      found.question,
      isoWeekCycle(ex.post_on),
      {
        [ex.skill_code]: {
          signature_move: ex.signature_move,
          check: ex.check,
          trap: ex.trap.summary,
        },
      },
    );
    expect(problems).toEqual([]);
    expect(ex.answer.letter).toBe(found.question.correct_answer);
  });

  it("a stopwatch must show exactly the floored tenths of its segment", () => {
    const log: PilotLinesLog = {
      duration: 10,
      lines: [
        {
          key: "hook",
          text: "x",
          wav: "/x.wav",
          words: [{ text: "x", start: 0, end: 0.5 }],
          start: 0,
          duration: 1,
        },
      ],
      timers: [
        { label: "By hand", start: 1.0, stop: 13.37, shown: "12.3 s" },
        { label: "Graphing", start: 14.0, stop: 20.0, shown: "6.1 s" },
      ],
    };
    const { rows, problems } = timerRows(log);
    expect(rows).toHaveLength(2);
    expect(problems).toEqual([
      "timer Graphing: shows 6.1 s, but its segment ran 6.0 s",
    ]);
  });
});
