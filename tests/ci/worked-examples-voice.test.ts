/**
 * Worked examples, OpenVoice addendum: the quality checks that decide clone vs fallback, the
 * fallback record, the reference guard, the clone not being the default, and CI never touching
 * OpenVoice or Python.
 *
 * @spec [OpenVoice addendum (Karl, 2026-10-27); SCL-267 (Karl's rulings 2026-11-02, later the same
 *       day): the default and fallback voice am_michael (af_heart kept for the W45 batch),
 *       "Lyceon" said "lye-see-on", loudness normalisation with a peak limiter on every line;
 *       SCL-270 (Karl's ruling 2026-11-02): a true-peak limiter (at most -1 dBTP) on the finished
 *       mix] | @implemented [2026-10-27, SCL-267 2026-11-02, SCL-270 2026-11-02]
 *
 * plain English: fixtures are the real committed voice (the fixture example's eight am_michael lines and
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
  workedExamplePostSchema,
  type VoiceManifest,
} from "../../packages/shared/src/worked-example-schema";
import { readWavSamples } from "../../scripts/worked-examples/audio";
import {
  comparisonReport,
  kitAtRate,
  parseVoiceSpec,
  wordsPerMinute,
} from "../../scripts/worked-examples/compare-voices";
import { scriptLines } from "../../scripts/worked-examples/composition";
import {
  loadExamples,
  loadVoice,
  voiceProblems,
} from "../../scripts/worked-examples/content";
import {
  KIT_DIR,
  ROOT,
  loadKit,
  voiceSettingsSchema,
} from "../../scripts/worked-examples/kit";
import {
  audioProblems,
  errorRate,
  lineQualityProblems,
  speechWords,
  transcriptProblem,
} from "../../scripts/worked-examples/quality";
import {
  FINAL_MIX_MAX_ATTEMPTS,
  TRUE_PEAK_OVERSAMPLE,
  afterLimiting,
  finalMixLimitArgs,
  finalMixProblem,
  measureMix,
} from "../../scripts/worked-examples/final-mix";
import {
  BRAND_RESPELLING,
  BRAND_RESPELLINGS,
  LIMITER_HEADROOM_DB,
  PAD_MIN_SECONDS,
  alimiterLimit,
  decideLine,
  keepsEarlierVoicing,
  kokoroTtsArgs,
  limiterCeiling,
  loudnessApplyArgs,
  loudnessMeasureArgs,
  parseLoudnorm,
  referenceProblem,
  spokenBrandName,
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
              voice: "am_michael",
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
      /fell back to clone, not the fallback voice am_michael/,
    );
    const already: VoiceManifest = {
      voice: "am_michael",
      lines: manifest.lines.map((l, k) =>
        k === 2 ? { ...l, voice: "am_michael", fallback_reasons: ["x"] } : l,
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
  // SCL-267 (Karl's ruling 2026-11-02): default and fallback am_michael; af_heart stays defined
  // so the W45 manifests voiced in it still validate.
  it("default and fallback are am_michael; af_heart stays a profile; the clone is a profile only", () => {
    expect(kit.voice.default_profile).toBe("am_michael");
    expect(kit.voice.fallback_profile).toBe("am_michael");
    expect(kit.voice.profiles["am_michael"]).toMatchObject({
      engine: "kokoro",
      kokoro_voice: "am_michael",
      speaking_rate: 1,
    });
    expect(kit.voice.profiles["af_heart"]?.engine).toBe("kokoro");
    expect(kit.voice.profiles["clone"]?.engine).toBe("openvoice-v2");
    expect(manifest.voice).toBe("am_michael");
    expect(
      voiceProblems(
        fixture.content,
        { ...manifest, voice: "af_heart" },
        kit,
        wav,
      ),
    ).toEqual([]);
  });

  it("the comparison report names each voice and its fallback lines", () => {
    const md = comparisonReport("we-satm2czs1be", [
      {
        voice: "af_heart",
        video: "a.mp4",
        seconds: 44.1,
        wpm: 171.4,
        fellBack: [],
      },
      {
        voice: "clone",
        video: "b.mp4",
        seconds: 45.3,
        wpm: 158.6,
        fellBack: ["step-3"],
      },
    ]);
    expect(md).toContain("| af_heart | a.mp4 | 44.1 s | 171 wpm | none |");
    expect(md).toContain("| clone | b.mp4 | 45.3 s | 159 wpm | step-3 |");
  });
});

describe("speaking rate", () => {
  it("every profile has one, and both voices are at their natural 1.0 until Karl picks", () => {
    for (const p of Object.values(kit.voice.profiles))
      expect(p.speaking_rate).toBeTypeOf("number");
    expect(kit.voice.profiles["af_heart"]?.speaking_rate).toBe(1);
    expect(kit.voice.profiles["am_michael"]?.speaking_rate).toBe(1);
    expect(kit.voice.profiles["clone"]?.speaking_rate).toBe(1);
  });

  it("reaches the kokoro voice as hyperframes tts -s", () => {
    const p = kit.voice.profiles["am_michael"];
    if (p?.engine !== "kokoro") throw new Error("am_michael is not kokoro");
    const args = kokoroTtsArgs({ ...p, speaking_rate: 1.1 }, "Hi.", "/x/a.wav");
    expect(args[args.indexOf("-s") + 1]).toBe("1.1");
  });

  it("a rate change re-voices the batch; an older manifest counts as 1.0", () => {
    const m = manifest;
    expect(keepsEarlierVoicing(m, m.voice, 1)).toBe(true);
    expect(keepsEarlierVoicing(m, m.voice, 1.1)).toBe(false);
    expect(
      keepsEarlierVoicing({ ...m, speaking_rate: 1.1 }, m.voice, 1.1),
    ).toBe(true);
    expect(keepsEarlierVoicing(m, "clone", 1)).toBe(false);
    expect(keepsEarlierVoicing(null, m.voice, 1)).toBe(false);
  });

  it("the comparison renders a profile at another rate without touching voice.json", () => {
    expect(parseVoiceSpec("clone")).toEqual({
      profile: "clone",
      rate: null,
      label: "clone",
    });
    expect(parseVoiceSpec("clone@1.1")).toEqual({
      profile: "clone",
      rate: 1.1,
      label: "clone-1.10x",
    });
    expect(() => parseVoiceSpec("clone@3")).toThrow(/outside/);
    expect(() => parseVoiceSpec("clone@")).toThrow();
    const faster = kitAtRate(kit, parseVoiceSpec("clone@1.1"));
    expect(faster.voice.profiles["clone"]?.speaking_rate).toBe(1.1);
    expect(kit.voice.profiles["clone"]?.speaking_rate).toBe(1);
  });

  it("pace is words per minute of speech", () => {
    const m = manifest;
    const words = m.lines.reduce((n, l) => n + l.words.length, 0);
    const seconds = m.lines.reduce((n, l) => n + l.duration, 0);
    expect(wordsPerMinute(m)).toBeCloseTo((words / seconds) * 60, 6);
    expect(wordsPerMinute(m)).toBeGreaterThan(100);
  });
});

// SCL-267 (Karl's ruling 2026-11-02): "Lyceon" is said "lye-see-on" (/ˈlaɪsiɑn/). hyperframes tts
// does not read misaki's inline markup (tested 2026-11-02: "[Lyceon](/lˈIsiˌɑn/)" was spoken as
// "lysian, slash L-stress…"), so the engine is given a respelling.
describe("pronunciation of Lyceon", () => {
  it("authors write Lyceon; the engine is given the respelling, everywhere it appears", () => {
    expect(BRAND_RESPELLING).toBe("Lysee-ahn");
    expect(spokenBrandName("This is Lyceon SAT Prep. LYCEON, lyceon.")).toBe(
      "This is Lysee-ahn SAT Prep. Lysee-ahn, Lysee-ahn.",
    );
    expect(spokenBrandName("Lyceonic is not the brand")).toBe(
      "Lyceonic is not the brand",
    );
    const p = kit.voice.profiles["am_michael"];
    if (p?.engine !== "kokoro") throw new Error("am_michael is not kokoro");
    expect(kokoroTtsArgs(p, "Follow Lyceon.", "/x/a.wav")[1]).toBe(
      "Follow Lysee-ahn.",
    );
  });

  // Owner brief "Video tools pilot" D3 (Karl, 2026-11-02): Chatterbox hears the plain spelling as
  // "Lycian", so it is given "Lie-see-on", from the same table and the same function.
  it("each engine gets its own respelling from the one table; kokoro stays the default", () => {
    expect(BRAND_RESPELLINGS).toEqual({
      kokoro: "Lysee-ahn",
      chatterbox: "Lie-see-on",
    });
    expect(spokenBrandName("Lyceon SAT Prep.", "chatterbox")).toBe(
      "Lie-see-on SAT Prep.",
    );
    expect(spokenBrandName("Lyceon SAT Prep.", "kokoro")).toBe(
      "Lysee-ahn SAT Prep.",
    );
    expect(spokenBrandName("Lyceon SAT Prep.")).toBe(
      spokenBrandName("Lyceon SAT Prep.", "kokoro"),
    );
  });

  it("what the transcriber hears for it is mapped back, so the quality check passes", () => {
    for (const heard of ["Lycian", "Lycion", "lysian"])
      expect(speechWords(`This is ${heard} SAT Prep.`, aliases)).toEqual(
        speechWords("This is Lyceon SAT Prep."),
      );
  });
});

// SCL-267 (Karl's ruling 2026-11-02): loudness normalisation with a peak limiter on every voiced
// line, about -14 LUFS integrated, true peak at most -1 dBTP, two-pass loudnorm plus alimiter.
describe("loudness normalisation", () => {
  const target = kit.voice.loudness;
  const measured = {
    input_i: "-23.91",
    input_tp: "-3.17",
    input_lra: "4.20",
    input_thresh: "-34.10",
    target_offset: "0.35",
  };

  it("voice.json asks for -14 LUFS and -1 dBTP; the limiter sits 0.5 dB under the ceiling", () => {
    expect(target).toEqual({
      integrated_lufs: -14,
      true_peak_dbtp: -1,
      loudness_range_lu: 11,
    });
    expect(limiterCeiling(target)).toBe(0.841);
  });

  it("pass 1 measures with loudnorm and writes nothing", () => {
    expect(loudnessMeasureArgs("/x/in.wav", target)).toEqual([
      "-hide_banner",
      "-nostats",
      "-i",
      "/x/in.wav",
      "-af",
      "loudnorm=I=-14:TP=-1:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ]);
  });

  it("pass 2 pads, applies the measured loudnorm, trims back, then limits, as 16-bit mono at the line's rate", () => {
    expect(
      loudnessApplyArgs(
        "/x/in.wav",
        "/x/out.wav",
        target,
        measured,
        24000,
        2.176,
      ),
    ).toEqual([
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      "/x/in.wav",
      "-af",
      `apad=whole_dur=${PAD_MIN_SECONDS},loudnorm=I=-14:TP=-1:LRA=11:measured_I=-23.91:measured_TP=-3.17:measured_LRA=4.20:measured_thresh=-34.10:offset=0.35:linear=true:print_format=summary,atrim=end=2.176,alimiter=limit=0.841:level=disabled`,
      "-ar",
      "24000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      "/x/out.wav",
    ]);
    const long = loudnessApplyArgs("/a", "/b", target, measured, 24000, 8.235);
    expect(long[6]).toMatch(/^apad=whole_dur=8\.8,.*,atrim=end=8\.235,/);
    const silent = loudnessApplyArgs("/a", "/b", target, null, 24000, 3);
    expect(silent[6]).toBe(
      "apad=whole_dur=3.5,loudnorm=I=-14:TP=-1:LRA=11:print_format=summary,atrim=end=3,alimiter=limit=0.841:level=disabled",
    );
  });

  it("reads loudnorm's measurement, and none from a silent line", () => {
    const stderr = `[Parsed_loudnorm_0 @ 0x1]\n{\n\t"input_i" : "-23.91",\n\t"input_tp" : "-3.17",\n\t"input_lra" : "4.20",\n\t"input_thresh" : "-34.10",\n\t"output_i" : "-14.20",\n\t"target_offset" : "0.35"\n}\n`;
    expect(parseLoudnorm(stderr)).toEqual(measured);
    expect(
      parseLoudnorm(
        stderr.replace('"-23.91"', '"-inf"').replace('"-3.17"', '"-inf"'),
      ),
    ).toBeNull();
    expect(() => parseLoudnorm("no json here")).toThrow(/no measurement/);
  });

  it("every committed line was normalised: peaks under -1 dBFS, none clipped, all clear of the music", () => {
    for (const l of manifest.lines) {
      const peak = readWavSamples(wav(l.file)).peakDbfs;
      expect(peak, l.key).toBeLessThanOrEqual(-1);
      expect(peak, l.key).toBeGreaterThan(-3);
    }
    expect(readWavSamples(outroWav).peakDbfs).toBeLessThanOrEqual(-1);
  });
});

// SCL-270 (Karl's ruling 2026-11-02): "a true-peak limiter (≤ −1 dBTP) on the finished mix in
// every pipeline". final-mix.ts limits the rendered video's audio at 4× oversampling, measures it,
// and the daily job's MP4 check refuses a finished mix above -1 dBTP.
describe("the final-mix true-peak limiter", () => {
  const fm = kit.voice.final_mix;

  it("voice.json caps the finished mix at -1 dBTP; the first pass limits 0.5 dB under it", () => {
    expect(fm).toEqual({ max_true_peak_dbtp: -1, aac_bitrate_kbps: 192 });
    expect(alimiterLimit(fm.max_true_peak_dbtp, LIMITER_HEADROOM_DB)).toBe(
      0.841,
    );
    expect(limiterCeiling(kit.voice.loudness)).toBe(0.841);
  });

  it("voice.json may not raise the ceiling above -1 dBTP", () => {
    const raised = voiceSettingsSchema.safeParse({
      ...kit.voice,
      final_mix: { ...fm, max_true_peak_dbtp: -0.5 },
    });
    expect(raised.success).toBe(false);
    expect(
      voiceSettingsSchema.safeParse({
        ...kit.voice,
        final_mix: { ...fm, max_true_peak_dbtp: -1.5 },
      }).success,
    ).toBe(true);
  });

  it("limits at 4× the sample rate, video copied, audio re-encoded once", () => {
    expect(TRUE_PEAK_OVERSAMPLE).toBe(4);
    expect(
      finalMixLimitArgs("/x/render.mp4", "/x/final.mp4", 0.841, 48000, fm),
    ).toEqual([
      "-hide_banner",
      "-nostats",
      "-y",
      "-i",
      "/x/render.mp4",
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c:v",
      "copy",
      "-af",
      "aresample=192000,alimiter=limit=0.841:level=disabled:latency=1,aresample=48000",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "/x/final.mp4",
    ]);
  });

  it("refuses a finished mix over -1 dBTP or with no measurable audio, and passes one at or under it", () => {
    expect(
      finalMixProblem({ integratedLufs: -12, truePeakDbtp: -0.9 }, fm),
    ).toMatch(/peaks at -0\.90 dBTP; at most -1 dBTP \(true peak\)/);
    expect(
      finalMixProblem({ integratedLufs: -12, truePeakDbtp: -1 }, fm),
    ).toBeNull();
    expect(
      finalMixProblem({ integratedLufs: -12, truePeakDbtp: -1.35 }, fm),
    ).toBeNull();
    expect(finalMixProblem(null, fm)).toMatch(/no measurable audio/);
  });

  it("an encoder overshoot is limited again with that much more headroom, then refused", () => {
    const at = (tp: number) => ({ integratedLufs: -12, truePeakDbtp: tp });
    expect(afterLimiting(at(-1.1), fm, 0.5, 1)).toEqual({ kind: "done" });
    expect(afterLimiting(at(-0.8), fm, 0.5, 1)).toEqual({
      kind: "again",
      headroomDb: 0.8,
    });
    expect(afterLimiting(at(-0.95), fm, 0.8, 2)).toEqual({
      kind: "again",
      headroomDb: 0.95,
    });
    const last = afterLimiting(at(-0.95), fm, 0.95, FINAL_MIX_MAX_ATTEMPTS);
    expect(last.kind).toBe("refused");
    expect(afterLimiting(null, fm, 0.5, 1).kind).toBe("refused");
  });

  it("the daily job renders, limits, then checks, uploads and posts only the limited video", () => {
    const yml = readFileSync(
      join(ROOT, ".github/workflows/worked-example-daily.yml"),
      "utf8",
    );
    const render = yml.indexOf(
      'render --quality delivery --output "$GITHUB_WORKSPACE/$OUT/render/$id.mp4"',
    );
    const limit = yml.indexOf(
      'pnpm exec tsx scripts/worked-examples/final-mix.ts "$OUT/render/$id.mp4" "$OUT/$id.mp4"',
    );
    const layout = yml.indexOf("scripts/worked-examples/layout-check.ts");
    const verify = yml.indexOf("scripts/worked-examples/daily.ts verify");
    const upload = yml.indexOf("${{ env.OUT }}/*.mp4");
    for (const [name, at] of Object.entries({
      render,
      limit,
      layout,
      verify,
      upload,
    }))
      expect(at, name).toBeGreaterThan(-1);
    expect(render).toBeLessThan(limit);
    expect(limit).toBeLessThan(layout);
    expect(limit).toBeLessThan(verify);
    expect(verify).toBeLessThan(upload);
    // The daily job renders once; the weekly job (SCL-277) renders once per date, below.
    expect(
      yml.match(
        /render --quality delivery --output "\$GITHUB_WORKSPACE\/\$OUT\//g,
      ),
    ).toHaveLength(1);
  });

  it("the weekly job renders, limits, then checks each date, and uploads only after every check (SCL-277)", () => {
    const yml = readFileSync(
      join(ROOT, ".github/workflows/worked-example-daily.yml"),
      "utf8",
    );
    const weekly = yml.slice(yml.indexOf("\n  weekly:"));
    const at = (s: string): number => weekly.indexOf(s);
    const render = at(
      'render --quality delivery --output "$GITHUB_WORKSPACE/$WOUT/$d/render/$id.mp4"',
    );
    const limit = at(
      'final-mix.ts "$WOUT/$d/render/$id.mp4" "$WOUT/$d/$id.mp4"',
    );
    const layout = at('layout-check.ts "$WOUT/$d/composition"');
    const verify = at('daily.ts verify --out "$WOUT/$d"');
    const upload = at("weekly.ts upload --out");
    for (const [name, i] of Object.entries({
      render,
      limit,
      layout,
      verify,
      upload,
    }))
      expect(i, name).toBeGreaterThan(-1);
    expect(render).toBeLessThan(limit);
    expect(limit).toBeLessThan(layout);
    expect(layout).toBeLessThan(verify);
    expect(verify).toBeLessThan(upload);
    expect(weekly.match(/render --quality delivery --output/g)).toHaveLength(1);
  });

  // A real round trip through ffmpeg: the daily job's own select, verify and final-mix commands
  // on a video whose 48 kHz samples sit 3 dB under its true peak (a 12 kHz tone at phase π/4),
  // the case a sample limiter misses. Needs ffmpeg (the daily job and the mutation harness
  // install it); skipped without it.
  const HAVE_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;
  it.skipIf(!HAVE_FFMPEG)(
    "verify refuses an unlimited intersample-peak mix; after final-mix.ts it is at most -1 dBTP and passes",
    () => {
      const out = mkdtempSync(join(tmpdir(), "we-final-mix-"));
      const tsx = (args: string[]) =>
        spawnSync("pnpm", ["exec", "tsx", ...args], {
          cwd: ROOT,
          encoding: "utf8",
        });
      const select = tsx([
        "scripts/worked-examples/daily.ts",
        "select",
        "--content",
        CONTENT,
        "--out",
        out,
        "--dry-run",
        "--date",
        fixture.content.post_on,
      ]);
      expect(select.status, select.stderr).toBe(0);
      const post = workedExamplePostSchema.parse(
        JSON.parse(readFileSync(join(out, "post.json"), "utf8")),
      );
      const meta: unknown = JSON.parse(
        readFileSync(join(out, "composition", "meta.json"), "utf8"),
      );
      const duration =
        typeof meta === "object" &&
        meta !== null &&
        "duration" in meta &&
        typeof meta.duration === "number"
          ? meta.duration
          : NaN;
      expect(duration).toBeGreaterThan(30);
      const rendered = join(out, "render.mp4");
      const tone = "0.99*sin(2*PI*12000*t+PI/4)";
      const make = spawnSync(
        "ffmpeg",
        [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          `color=c=white:s=1080x1920:r=1:d=${duration}`,
          "-f",
          "lavfi",
          "-i",
          `aevalsrc=${tone}|${tone}:s=48000:d=${duration}`,
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          rendered,
        ],
        { encoding: "utf8" },
      );
      expect(make.status, make.stderr).toBe(0);
      const before = measureMix(rendered, kit);
      expect(before?.truePeakDbtp).toBeGreaterThan(-1);

      // Unlimited, as rendered: the MP4 check refuses it on true peak.
      writeFileSync(join(out, post.video), readFileSync(rendered));
      const refused = tsx([
        "scripts/worked-examples/daily.ts",
        "verify",
        "--out",
        out,
      ]);
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toMatch(
        /the finished mix peaks at -?\d+\.\d\d dBTP; at most -1 dBTP/,
      );

      // Limited by the one shared function's CLI: at most -1 dBTP, and the MP4 check passes.
      const limited = tsx([
        "scripts/worked-examples/final-mix.ts",
        rendered,
        join(out, post.video),
      ]);
      expect(limited.status, limited.stderr).toBe(0);
      // A true-peak limiter gets there in one pass at the first limit (0.5 dB under). Limited at
      // the sample rate, the samples never reach 0.841, so only the retries rescue it, at a limit
      // near 0.61: 2.8 dB more limiting than the mix needs (measured 2026-11-02).
      expect(limited.stdout).toMatch(/\(limit 0\.841 at \d+x, 1 pass\)/);
      const after = measureMix(join(out, post.video), kit);
      expect(after).not.toBeNull();
      expect(after?.truePeakDbtp).toBeLessThanOrEqual(-1);
      const passed = tsx([
        "scripts/worked-examples/daily.ts",
        "verify",
        "--out",
        out,
      ]);
      expect(passed.status, passed.stderr).toBe(0);
      expect(passed.stdout).toMatch(/verify: .* OK/);
    },
    180_000,
  );
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
