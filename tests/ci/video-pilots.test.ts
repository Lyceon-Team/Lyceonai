/**
 * Video pilots: the committed pilot scripts follow Karl's script and voice rules, and the checks
 * the rendered videos must pass catch what they claim to.
 *
 * @spec [Karl's script and voice rulings for every pilot video (2026-11-02, SCL-267): no burned-in
 *       captions; the voice never reads the on-screen text (S1/S2, shared/worked-examples/rules.ts);
 *       the flow ending "Follow, there's one of these every day."; the end card "Lyceon SAT Prep",
 *       no lyceon.ai; am_michael; "Lyceon" through spokenBrandName; every video 1080×1920, 30 fps,
 *       with audio; owner brief "Video tools pilot" (Karl, 2026-11-02) D2, D3 and D1; owner ruling
 *       (Karl, 2026-11-02): "never use the word 'Desmos' in on-screen text, captions or spoken
 *       lines ... Add a test or a check in check.ts that fails if 'desmos' (case-insensitive)
 *       appears in any pilot script, on-screen line or caption"; D1 Video 2: honest timers on the
 *       video clock] | @implemented [2026-11-02]
 *
 * plain English: the fixtures are the committed pilot examples, their questions from the real seed
 * SQL, the kit's real end-card template and voice.json. Rendered videos and their logs are never
 * committed, so the rendered-log checks (check.ts) run on a log built from a committed example's
 * own spoken lines and its own on-screen texts (rules.ts onScreenTexts), proven non-trivial first.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { workedExampleContentSchema } from "../../packages/shared/src/worked-example-schema";
import { isoWeekCycle } from "../../shared/content/schedule";
import {
  contentProblems,
  onScreenTexts,
  spokenTexts,
} from "../../shared/worked-examples/rules";
import { scriptLines } from "../../scripts/worked-examples/composition";
import { seedQuestion } from "../../scripts/worked-examples/content";
import { loadKit } from "../../scripts/worked-examples/kit";
import {
  formatProblems,
  logWordHits,
  probeSchema,
  screenEchoProblems,
  timerRows,
  type PilotLinesLog,
} from "../../scripts/video-pilots/manim/check";
import {
  bannedWordHits,
  pilotSourceFiles,
  pilotSourceHits,
} from "../../scripts/video-pilots/manim/word-guard";
import { endCardText } from "../../scripts/video-pilots/manim/prepare";
import {
  engineFingerprint,
  parseChatterboxEvents,
  rawCacheName,
} from "../../scripts/video-pilots/voice-lines";
import { spokenBrandName } from "../../scripts/worked-examples/voice";

const ROOT = join(__dirname, "..", "..");
const D1 = ["SATM2PW20AL", "SATM2XXVNK7"] as const;
const PILOT_DIR = join(ROOT, "video-kit/pilots/manim");
const kit = loadKit();

function pilotIds(): string[] {
  return readdirSync(PILOT_DIR).sort();
}

function example(
  id: string,
): ReturnType<typeof workedExampleContentSchema.parse> {
  return workedExampleContentSchema.parse(
    JSON.parse(readFileSync(join(PILOT_DIR, id, "example.json"), "utf8")),
  );
}

function question(id: string): Parameters<typeof contentProblems>[1] {
  const found = seedQuestion(id);
  if (!found.ok) throw new Error(found.problem);
  return found.question;
}

describe("video pilots: the committed scripts follow the 2026-11-02 rules", () => {
  it("D2 and both D1 pilots are committed (presence before the rules are applied to every pilot)", () => {
    expect(pilotIds()).toEqual(["SATM2BVZSMV", ...D1].sort());
  });

  it.each(pilotIds())(
    "%s passes the worked-example rules, S1 and S2 included",
    (id) => {
      const ex = example(id);
      const q = question(id);
      expect(
        contentProblems(ex, q, isoWeekCycle(ex.post_on), {
          [ex.skill_code]: {
            signature_move: ex.signature_move,
            check: ex.check,
            trap: ex.trap.summary,
          },
        }),
      ).toEqual([]);
    },
  );

  it.each(pilotIds())(
    "%s ends on the ruled call to action and speaks no web address",
    (id) => {
      const lines = scriptLines(example(id), kit.voice.outro_text);
      expect(lines.map((l) => l.key)[0]).toBe("hook");
      expect(lines.at(-1)).toEqual({
        key: "outro",
        text: "Follow, there's one of these every day.",
      });
      for (const l of lines) expect(l.text).not.toMatch(/lyceon\.ai|dot ai/i);
    },
  );
});

describe("video pilots: the end card", () => {
  it("reads the kit's own end-card template: Lyceon SAT Prep, no lyceon.ai", () => {
    const card = endCardText(kit.templates["end-card"]);
    expect(card).toEqual({
      follow: "Follow for daily SAT questions",
      brand: "Lyceon SAT Prep",
    });
    expect(JSON.stringify(card)).not.toMatch(/lyceon\.ai/i);
  });

  it("refuses a template missing either line", () => {
    expect(() =>
      endCardText('<div class="follow">Follow for daily SAT questions</div>'),
    ).toThrow(/brand-name/);
  });
});

describe("video pilots: check.ts", () => {
  const ex = example("SATM2BVZSMV");
  const q = question("SATM2BVZSMV");
  const words = [{ text: "x", start: 0, end: 0.5 }];
  const log = (spoken: { key: string; text: string }[]): PilotLinesLog => ({
    duration: 40,
    engine: "kokoro",
    lines: spoken.map((s, k) => ({
      key: s.key,
      text: s.text,
      wav: `/x/${s.key}.wav`,
      words,
      start: k * 4,
      duration: 3,
    })),
    on_screen: onScreenTexts(ex, q).map((s) => s.text),
  });

  it("S1 on the drawn screen: the committed D2 script never reads it", () => {
    const l = log(spokenTexts(ex));
    expect(l.lines.length).toBeGreaterThanOrEqual(8);
    expect(l.on_screen.join(" ").split(" ").length).toBeGreaterThan(40);
    expect(screenEchoProblems(l)).toEqual([]);
  });

  it("S1 on the drawn screen: a spoken line that reads the stem is caught by itself", () => {
    const l = log([...spokenTexts(ex), { key: "step-9", text: q.stem }]);
    const found = screenEchoProblems(l);
    expect(found.length).toBeGreaterThan(0);
    expect(
      found.every((p) => p.startsWith("S1 reads the screen: spoken step-9 ")),
    ).toBe(true);
  });

  const good = probeSchema.parse({
    streams: [
      {
        codec_type: "video",
        width: 1080,
        height: 1920,
        avg_frame_rate: "30/1",
      },
      { codec_type: "audio" },
    ],
    format: { duration: "45.0" },
  });

  it("format: 1080×1920 at 30 fps with audio passes", () => {
    expect(formatProblems(good)).toEqual([]);
  });

  it("format: each wrong property fails on its own", () => {
    const v = good.streams[0];
    if (!v) throw new Error("no video stream");
    expect(
      formatProblems({
        ...good,
        streams: [{ ...v, width: 720, height: 1280 }, { codec_type: "audio" }],
      }),
    ).toEqual(["format: 720×1280, not 1080×1920"]);
    // Each dimension alone: a fixture that changes both cannot prove either comparison bites.
    expect(
      formatProblems({
        ...good,
        streams: [{ ...v, width: 1920, height: 1920 }, { codec_type: "audio" }],
      }),
    ).toEqual(["format: 1920×1920, not 1080×1920"]);
    expect(
      formatProblems({
        ...good,
        streams: [{ ...v, width: 1080, height: 1080 }, { codec_type: "audio" }],
      }),
    ).toEqual(["format: 1080×1080, not 1080×1920"]);
    expect(
      formatProblems({
        ...good,
        streams: [{ ...v, avg_frame_rate: "25/1" }, { codec_type: "audio" }],
      }),
    ).toEqual(["format: 25.00 fps, not 30"]);
    expect(formatProblems({ ...good, streams: [v] })).toEqual([
      "format: no audio stream",
    ]);
  });
});

describe("video pilots: voice-lines.ts", () => {
  it("each engine is given its own respelling of the brand, from voice.ts's one table", () => {
    expect(spokenBrandName("Lyceon SAT Prep.", "chatterbox")).toBe(
      "Lie-see-on SAT Prep.",
    );
    expect(spokenBrandName("Lyceon SAT Prep.", "kokoro")).toBe(
      "Lysee-ahn SAT Prep.",
    );
  });

  it("kokoro speaks in voice.json's default profile, am_michael", () => {
    expect(kit.voice.default_profile).toBe("am_michael");
    expect(engineFingerprint(kit, "kokoro")).toContain(" am_michael ");
  });

  it("the raw-audio cache key changes with the spoken text and with the engine's settings", () => {
    const a = rawCacheName("hook", "f1", "Go.");
    expect(a).toMatch(/^hook-[0-9a-f]{16}\.wav$/);
    expect(rawCacheName("hook", "f1", "Go.")).toBe(a);
    expect(rawCacheName("hook", "f1", "Go!")).not.toBe(a);
    expect(rawCacheName("hook", "f2", "Go.")).not.toBe(a);
    expect(engineFingerprint(kit, "chatterbox")).not.toBe(
      engineFingerprint(kit, "kokoro"),
    );
  });

  it("Chatterbox's stdout is its JSON events and nothing else", () => {
    const ok = [
      '{"event": "loaded", "seconds": 59.6}',
      '{"event": "line", "index": 0, "wall_seconds": 33.7, "audio_seconds": 2.9, "raw_peak": 0.97, "scaled_to_full_scale": false}',
    ].join("\n");
    expect(parseChatterboxEvents(ok).map((e) => e.event)).toEqual([
      "loaded",
      "line",
    ]);
    expect(() => parseChatterboxEvents(`${ok}\nThink you can`)).toThrow();
  });
});

describe("video pilots: the calculator-name guard (D1)", () => {
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

  it("no committed pilot script or on-screen line names the calculator", () => {
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
      engine: "kokoro",
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
    shown.on_screen = [...shown.on_screen, "desmos.com"];
    expect(logWordHits(shown)).toEqual([
      expect.stringContaining(`on-screen string ${lines.length + 1}:1`),
    ]);
  });
});

describe("video pilots: the D1 stopwatches", () => {
  it("a stopwatch must show exactly the floored tenths of its segment", () => {
    const log: PilotLinesLog = {
      duration: 10,
      engine: "kokoro",
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
      on_screen: ["By hand", "Graphing"],
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
