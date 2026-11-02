/**
 * The finished-mix limiter: a rendered video's audio (voice and music bed together) limited to a
 * true peak of at most -1 dBTP, and the check that refuses a video above it.
 *
 * @spec [SCL-270, Karl's ruling 2026-11-02: "Final limiter: yes. Add a true-peak limiter
 *       (≤ −1 dBTP) on the finished mix in every pipeline: worked examples, breakdowns and the
 *       D pilots."; SCL-267 (the per-line loudness step this sits after)]
 *       | @implemented [2026-11-02]
 *
 * plain English:
 *   pnpm exec tsx scripts/worked-examples/final-mix.ts <rendered.mp4> <finished.mp4>
 * Every pipeline that renders a video calls this one function (limitFinishedMix) or this CLI on
 * the video as rendered, before its checks; nothing copies the ffmpeg arguments. Why a pass on
 * the MP4: Hyperframes mixes the voice lines and the music bed inside `render`, so no code here
 * owns a mix step to put the limiter in, and the pilots mix with their own ffmpeg call. The video
 * stream is copied untouched; the audio is re-encoded once (AAC, voice.json `final_mix`).
 * How: the audio is upsampled 4× (TRUE_PEAK_OVERSAMPLE), limited there by alimiter with auto-level
 * off and its look-ahead delay compensated, then resampled back to its own rate. alimiter limits
 * samples; at 4× the samples follow the reconstructed waveform, so the limit holds for true peak
 * (a 12 kHz tone whose 48 kHz samples sat 3 dB under its true peak came out at +0.4 dBTP limited
 * at 48 kHz, -1.1 dBTP limited at 4×; measured 2026-11-02). The limit starts LIMITER_HEADROOM_DB
 * (0.5 dB) under the ceiling, as the line limiter does. The AAC encoder can still overshoot, so
 * the result is measured (voice.ts's loudnorm measuring pass, which reports true peak) and, while
 * it is over the ceiling, limited again from the rendered input with the headroom raised by the
 * overshoot plus FINAL_MIX_STEP_DB, at most FINAL_MIX_MAX_ATTEMPTS times; then it refuses. A
 * render already under the ceiling still passes through the limiter (one code path, no branch to
 * forget). Integrated loudness is left alone: the lines are normalised (SCL-267) and the limiter
 * only touches peaks. Logs carry loudness numbers only.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { loadKit, type Kit, type VoiceSettings } from "./kit";
import {
  LIMITER_HEADROOM_DB,
  alimiterLimit,
  loudnessMeasureArgs,
  parseLoudnorm,
} from "./voice";

export type FinalMixSettings = VoiceSettings["final_mix"];

/** Limiting at 4× the sample rate is what makes a sample limiter a true-peak limiter. */
export const TRUE_PEAK_OVERSAMPLE = 4;
/** How many times the mix is limited before an overshoot is refused. */
export const FINAL_MIX_MAX_ATTEMPTS = 3;
/** Extra headroom, past the measured overshoot, for each further attempt. */
export const FINAL_MIX_STEP_DB = 0.1;

/** A finished mix's integrated loudness (LUFS) and true peak (dBTP). */
export type MixMeasure = { integratedLufs: number; truePeakDbtp: number };

/** The ffmpeg arguments for one limiting pass: video copied, audio limited at 4× and re-encoded. */
export function finalMixLimitArgs(
  input: string,
  output: string,
  limit: number,
  sampleRate: number,
  settings: FinalMixSettings,
): string[] {
  return [
    "-hide_banner",
    "-nostats",
    "-y",
    "-i",
    input,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-af",
    `aresample=${sampleRate * TRUE_PEAK_OVERSAMPLE},alimiter=limit=${limit}:level=disabled:latency=1,aresample=${sampleRate}`,
    "-c:a",
    "aac",
    "-b:a",
    `${settings.aac_bitrate_kbps}k`,
    "-movflags",
    "+faststart",
    output,
  ];
}

/** Why a finished mix may not ship, or null: no measurable audio, or a true peak over the ceiling. */
export function finalMixProblem(
  measured: MixMeasure | null,
  settings: FinalMixSettings,
): string | null {
  if (measured === null)
    return "the finished mix has no measurable audio (true peak unknown)";
  return measured.truePeakDbtp <= settings.max_true_peak_dbtp
    ? null
    : `the finished mix peaks at ${measured.truePeakDbtp.toFixed(2)} dBTP; at most ${settings.max_true_peak_dbtp} dBTP (true peak)`;
}

/** After one limiting pass: done, limit again with more headroom, or refuse. */
export type LimitStep =
  | { kind: "done" }
  | { kind: "again"; headroomDb: number }
  | { kind: "refused"; reason: string };

export function afterLimiting(
  measured: MixMeasure | null,
  settings: FinalMixSettings,
  headroomDb: number,
  attempt: number,
): LimitStep {
  const problem = finalMixProblem(measured, settings);
  if (problem === null) return { kind: "done" };
  if (measured === null || attempt >= FINAL_MIX_MAX_ATTEMPTS)
    return {
      kind: "refused",
      reason: `${problem} after ${attempt} limiting pass${attempt === 1 ? "" : "es"}`,
    };
  const overshoot = measured.truePeakDbtp - settings.max_true_peak_dbtp;
  return {
    kind: "again",
    headroomDb:
      Math.round((headroomDb + overshoot + FINAL_MIX_STEP_DB) * 100) / 100,
  };
}

/** Integrated loudness and true peak of a file's audio, by voice.ts's loudnorm measuring pass. */
export function measureMix(file: string, kit: Kit): MixMeasure | null {
  const run = spawnSync(
    "ffmpeg",
    loudnessMeasureArgs(file, kit.voice.loudness),
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (run.status !== 0)
    throw new Error(`ffmpeg loudnorm (measure) exited ${run.status}`);
  const m = parseLoudnorm(run.stderr);
  return m === null
    ? null
    : { integratedLufs: Number(m.input_i), truePeakDbtp: Number(m.input_tp) };
}

const probeSchema = z.object({
  streams: z.array(
    z.object({ codec_type: z.string(), sample_rate: z.string().optional() }),
  ),
});

/** The sample rate of a file's first audio stream; throws when it has none. */
export function audioSampleRate(file: string): number {
  const probe = probeSchema.parse(
    JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,sample_rate",
          "-of",
          "json",
          file,
        ],
        { encoding: "utf8" },
      ),
    ),
  );
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  const rate = Number(audio?.sample_rate);
  if (!audio || !Number.isInteger(rate) || rate <= 0)
    throw new Error(`${file} has no audio stream to limit`);
  return rate;
}

export type FinalMixResult = {
  before: MixMeasure | null;
  after: MixMeasure;
  passes: number;
  limit: number;
};

/**
 * Limits the finished mix of `input` (an MP4 as rendered) into `output`. Throws, leaving nothing
 * usable at `output`, when the mix cannot be brought to the ceiling.
 */
export function limitFinishedMix(
  input: string,
  output: string,
  kit: Kit,
): FinalMixResult {
  if (resolve(input) === resolve(output))
    throw new Error(
      "final-mix: the output must not overwrite the rendered input",
    );
  const settings = kit.voice.final_mix;
  const sampleRate = audioSampleRate(input);
  const before = measureMix(input, kit);
  let headroomDb = LIMITER_HEADROOM_DB;
  for (let attempt = 1; ; attempt++) {
    const limit = alimiterLimit(settings.max_true_peak_dbtp, headroomDb);
    const run = spawnSync(
      "ffmpeg",
      finalMixLimitArgs(input, output, limit, sampleRate, settings),
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    if (run.status !== 0)
      throw new Error(`ffmpeg final-mix limiter exited ${run.status}`);
    const after = measureMix(output, kit);
    const step = afterLimiting(after, settings, headroomDb, attempt);
    if (step.kind === "again") {
      headroomDb = step.headroomDb;
      continue;
    }
    if (step.kind === "done" && after !== null)
      return { before, after, passes: attempt, limit };
    rmSync(output, { force: true });
    throw new Error(
      `final-mix: ${step.kind === "refused" ? step.reason : "no measurement"}`,
    );
  }
}

/** The check every pipeline's MP4 check runs on the finished video. */
export function finishedMixProblems(file: string, kit: Kit): string[] {
  const problem = finalMixProblem(measureMix(file, kit), kit.voice.final_mix);
  return problem === null ? [] : [problem];
}

function fmt(m: MixMeasure | null): string {
  return m === null
    ? "no measurable audio"
    : `${m.integratedLufs.toFixed(1)} LUFS, ${m.truePeakDbtp.toFixed(2)} dBTP`;
}

function main(): void {
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
    throw new Error("usage: final-mix.ts <rendered.mp4> <finished.mp4>");
  if (!existsSync(input)) throw new Error(`final-mix: no such file ${input}`);
  const r = limitFinishedMix(input, output, loadKit());
  process.stdout.write(
    `final-mix: ${fmt(r.before)} -> ${fmt(r.after)} (limit ${r.limit} at ${TRUE_PEAK_OVERSAMPLE}x, ${r.passes} pass${r.passes === 1 ? "" : "es"})\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (err: unknown) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
