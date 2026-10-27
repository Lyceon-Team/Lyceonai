/**
 * Worked examples, OpenVoice addendum: the quality checks that decide clone vs fallback, the
 * fallback record, the reference guard, the clone not being the default, and CI never touching
 * OpenVoice or Python.
 *
 * @spec [OpenVoice addendum (Karl, 2026-10-27)] | @implemented [2026-10-27]
 *
 * plain English: fixtures are the real committed voice (the fixture example's eight Kokoro lines and
 * the kit's end-card line, with their real transcriptions); the failing cases are built by changing
 * one thing about real input (a different script, full-scale samples, a stretch of silence).
 * scripts/ci/worked-examples.mutations.sh plants one defect per rule against these tests.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  voiceLineSchema,
  voiceManifestSchema,
  type VoiceManifest,
} from "../../packages/shared/src/worked-example-schema";
import { readWavSamples } from "../../scripts/worked-examples/audio";
import { comparisonReport } from "../../scripts/worked-examples/compare-voices";
import { scriptLines } from "../../scripts/worked-examples/composition";
import {
  loadExamples,
  loadVoice,
  voiceProblems,
} from "../../scripts/worked-examples/content";
import { KIT_DIR, ROOT, loadKit } from "../../scripts/worked-examples/kit";
import {
  audioProblems,
  errorRate,
  lineQualityProblems,
  speechWords,
  transcriptProblem,
} from "../../scripts/worked-examples/quality";
import {
  decideLine,
  referenceProblem,
} from "../../scripts/worked-examples/voice";

const CONTENT = join(ROOT, "tests/fixtures/worked-examples/social");
const kit = loadKit();
const q = kit.voice.quality;
const aliases = kit.voice.transcript_aliases;
const [fixture] = loadExamples(CONTENT);
if (!fixture) throw new Error("the fixture tree has no example");
const manifest = loadVoice(CONTENT, fixture.dir);
const wav = (file: string): Uint8Array =>
  readFileSync(join(CONTENT, fixture.dir, "voice", file));
const script = scriptLines(fixture.content, kit.voice.outro_text).filter(
  (s) => s.key !== "outro",
);
const outro = voiceLineSchema.parse(
  JSON.parse(readFileSync(join(ROOT, KIT_DIR, "voice/outro.json"), "utf8")),
);
const outroWav = readFileSync(join(ROOT, KIT_DIR, "voice/outro.wav"));

/** A 16-bit mono WAV of the given samples (-1..1). */
function makeWav(samples: readonly number[], rate = 24000): Uint8Array {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, k) =>
    buf.writeInt16LE(
      Math.max(-32768, Math.min(32767, Math.round(s * 32767))),
      44 + k * 2,
    ),
  );
  return new Uint8Array(buf);
}

/** The real hook line's samples with something changed. */
function hookWith(
  change: (samples: number[], rate: number) => number[],
): Uint8Array {
  const { samples, sampleRate } = readWavSamples(wav("hook.wav"));
  return makeWav(change(Array.from(samples), sampleRate), sampleRate);
}

describe("quality checks pass the real committed voice", () => {
  it("every fixture line and the kit's end-card line say their script, unclipped, without long silence", () => {
    expect(script.length).toBe(8);
    script.forEach((s, k) => {
      const line = manifest.lines[k];
      expect(line?.key).toBe(s.key);
      if (!line) return;
      expect(
        lineQualityProblems(s.text, line.words, wav(line.file), q, aliases),
      ).toEqual([]);
    });
    expect(
      lineQualityProblems(
        kit.voice.outro_text,
        outro.words,
        outroWav,
        q,
        aliases,
      ),
    ).toEqual([]);
  });

  it("numbers, symbols and letter names normalise to the same speech", () => {
    expect(speechWords("Up 25%, then $64 × 1.25")).toEqual([
      "up",
      "twenty",
      "five",
      "percent",
      "then",
      "sixty",
      "four",
      "dollar",
      "time",
      "one",
      "point",
      "two",
      "five",
    ]);
    expect(
      errorRate(
        speechWords("J K is twelve").join(""),
        speechWords("JK is 12").join(""),
      ),
    ).toBe(0);
  });
});

describe("transcription mismatch", () => {
  it("a line that says something other than its script is refused", () => {
    const hook = manifest.lines[0];
    if (!hook) throw new Error("no hook line");
    const other = script.find((s) => s.key === "trap")?.text ?? "";
    expect(transcriptProblem(other, hook.words, q, aliases)).toMatch(
      /^transcription mismatch: character error rate/,
    );
    expect(
      transcriptProblem(script[0]?.text ?? "", hook.words, q, aliases),
    ).toBeNull();
  });

  it("a half-heard line is refused", () => {
    const hook = manifest.lines[0];
    if (!hook) throw new Error("no hook line");
    const half = hook.words.slice(0, Math.floor(hook.words.length / 2));
    expect(transcriptProblem(script[0]?.text ?? "", half, q, aliases)).toMatch(
      /transcription mismatch/,
    );
  });
});

describe("clipping and silence", () => {
  it("a clipped line is refused", () => {
    const clipped = hookWith((s) =>
      s.map((x) => Math.max(-1, Math.min(1, x * 20))),
    );
    expect(audioProblems(clipped, q).join()).toMatch(/^clipping: peak/);
  });

  it("a silent line is refused", () => {
    expect(audioProblems(makeWav(new Array(24000).fill(0)), q)).toEqual([
      "silence: the line is silent",
    ]);
  });

  it("a long silence before, inside or after the speech is refused", () => {
    const pad = (rate: number, s: number): number[] =>
      new Array(Math.round(rate * s)).fill(0);
    expect(
      audioProblems(
        hookWith((s, r) => [...pad(r, 1.5), ...s]),
        q,
      ).join(),
    ).toMatch(/before the first word/);
    expect(
      audioProblems(
        hookWith((s, r) => [...s, ...pad(r, 2)]),
        q,
      ).join(),
    ).toMatch(/after the last word/);
    expect(
      audioProblems(
        hookWith((s, r) => [
          ...s.slice(0, s.length / 2),
          ...pad(r, 2),
          ...s.slice(s.length / 2),
        ]),
        q,
      ).join(),
    ).toMatch(/pause inside the line/);
    expect(audioProblems(wav("hook.wav"), q)).toEqual([]);
  });
});

describe("fallback to the /brag voice", () => {
  it("keeps a clone line only when it was produced and passed every check", () => {
    expect(decideLine({ ok: true, problems: [] })).toEqual({ use: "clone" });
    expect(
      decideLine({
        ok: true,
        problems: ["clipping: peak 0.00 dBFS (at most -0.1)"],
      }),
    ).toEqual({
      use: "fallback",
      reasons: ["clipping: peak 0.00 dBFS (at most -0.1)"],
    });
    expect(decideLine({ ok: false, error: "missing checkpoint" })).toEqual({
      use: "fallback",
      reasons: ["the clone did not produce the line: missing checkpoint"],
    });
  });

  it("a clone batch may carry fallback lines in the fallback voice, each with its reasons", () => {
    const clone: VoiceManifest = {
      voice: "clone",
      lines: manifest.lines.map((l, k) =>
        k === 2
          ? {
              ...l,
              voice: "af_heart",
              fallback_reasons: ["clipping: peak 0.00 dBFS (at most -0.1)"],
            }
          : l,
      ),
    };
    expect(
      voiceProblems(
        fixture.content,
        voiceManifestSchema.parse(clone),
        kit,
        wav,
      ),
    ).toEqual([]);
  });

  it("a fallback line in another voice, or a fallback in a batch already in the fallback voice, is refused", () => {
    const other: VoiceManifest = {
      voice: "clone",
      lines: manifest.lines.map((l, k) =>
        k === 2 ? { ...l, voice: "clone", fallback_reasons: ["x"] } : l,
      ),
    };
    expect(voiceProblems(fixture.content, other, kit, wav).join()).toMatch(
      /fell back to clone, not the fallback voice af_heart/,
    );
    const already: VoiceManifest = {
      voice: "af_heart",
      lines: manifest.lines.map((l, k) =>
        k === 2 ? { ...l, voice: "af_heart", fallback_reasons: ["x"] } : l,
      ),
    };
    expect(voiceProblems(fixture.content, already, kit, wav).join()).toMatch(
      /already in the fallback voice/,
    );
    expect(
      voiceProblems(
        fixture.content,
        { ...manifest, voice: "someone" },
        kit,
        wav,
      ).join(),
    ).toMatch(/not a profile in voice.json/);
  });

  it("a fallback line must say why", () => {
    const line = manifest.lines[0];
    expect(
      voiceLineSchema.safeParse({ ...line, voice: "af_heart" }).success,
    ).toBe(false);
    expect(
      voiceLineSchema.safeParse({
        ...line,
        voice: "af_heart",
        fallback_reasons: ["silence: the line is silent"],
      }).success,
    ).toBe(true);
  });

  it("a committed line that fails the checks fails the content check", () => {
    const silent = (file: string): Uint8Array =>
      file === "step-2.wav" ? makeWav(new Array(24000 * 3).fill(0)) : wav(file);
    expect(
      voiceProblems(fixture.content, manifest, kit, silent).join(),
    ).toMatch(/voice\/step-2\.wav: silence: the line is silent/);
  });
});

describe("the reference recording is never committed", () => {
  const outside = join(mkdtempSync(join(tmpdir(), "we-ref-test-")), "karl.wav");
  writeFileSync(outside, makeWav([0, 0.1, -0.1]));

  it("is read only from an absolute path outside every checkout", () => {
    expect(referenceProblem(undefined, [ROOT])).toMatch(
      /WE_VOICE_REFERENCE is not set/,
    );
    expect(referenceProblem("karl.wav", [ROOT])).toMatch(/absolute path/);
    expect(referenceProblem(join(ROOT, "package.json"), [ROOT])).toMatch(
      /inside .*; keep it outside every repository checkout/,
    );
    expect(referenceProblem(outside, [ROOT])).toBeNull();
  });

  it("git ignores reference recordings and none is tracked", () => {
    for (const path of [
      "content/worked-examples/2026-W45/X/voice-reference/take1.wav",
      "voice/karl.reference.wav",
      "karl.reference.m4a",
    ]) {
      expect(
        spawnSync("git", ["check-ignore", "-q", path], { cwd: ROOT }).status,
        path,
      ).toBe(0);
    }
    const tracked = spawnSync("git", ["ls-files"], {
      cwd: ROOT,
      encoding: "utf8",
    }).stdout.split("\n");
    expect(tracked.length).toBeGreaterThan(100);
    expect(
      tracked.filter((f) =>
        /(^|\/)voice-reference\/|\.reference\.(wav|mp3|m4a|flac)$/i.test(f),
      ),
    ).toEqual([]);
  });
});

describe("the clone is not the default until Karl picks it", () => {
  it("default and fallback are the /brag voice; the clone is a profile only", () => {
    expect(kit.voice.default_profile).toBe("af_heart");
    expect(kit.voice.fallback_profile).toBe("af_heart");
    expect(kit.voice.profiles["af_heart"]?.engine).toBe("kokoro");
    expect(kit.voice.profiles["clone"]?.engine).toBe("openvoice-v2");
  });

  it("the comparison report names each voice and its fallback lines", () => {
    const md = comparisonReport("we-satm2czs1be", [
      { voice: "af_heart", video: "a.mp4", seconds: 44.1, fellBack: [] },
      { voice: "clone", video: "b.mp4", seconds: 45.3, fellBack: ["step-3"] },
    ]);
    expect(md).toContain("| af_heart | a.mp4 | 44.1 s | none |");
    expect(md).toContain("| clone | b.mp4 | 45.3 s | step-3 |");
  });
});

describe("CI never installs OpenVoice or Python", () => {
  const dir = join(ROOT, ".github/workflows");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));

  it("no workflow installs or runs OpenVoice, MeloTTS or the clone script", () => {
    expect(files.length).toBeGreaterThan(5);
    for (const f of files)
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(
        /openvoice|melotts|melo\.api|myshell-ai|clone_line\.py|unidic download/i,
      );
  });

  it("the worked-example workflows set up no Python at all", () => {
    const ours = files.filter((f) => f.startsWith("worked-example-"));
    expect(ours.sort()).toEqual([
      "worked-example-checks.yml",
      "worked-example-daily.yml",
    ]);
    for (const f of ours)
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(
        /setup-python|pip3? install|python3? -m|requirements\.txt/i,
      );
  });
});
