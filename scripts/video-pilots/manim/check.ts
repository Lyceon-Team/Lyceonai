/**
 * Video pilot (Manim): the checks every rendered pilot video must pass, and their table.
 *
 * @spec [Karl's script and voice rulings for every pilot video (2026-11-02, SCL-267): 2 "The voice
 *       never reads the on-screen text verbatim. Apply rules S1/S2 from
 *       shared/worked-examples/rules.ts in prepare.ts/check.ts"; 7 loudness "around −14 LUFS, true
 *       peak ≤ −1 dB"; the checks for every video: 1080×1920, 30 fps, 30-60 s, audio, every voice
 *       line passing scripts/worked-examples/quality.ts, S1/S2; OpenVoice addendum (Karl,
 *       2026-10-27): the quality checks (transcription mismatch, clipping, silence)]
 *       | @implemented [2026-11-02, the SCL-267 checks 2026-11-02]
 *
 * plain English:
 *   pnpm exec tsx scripts/video-pilots/manim/check.ts \
 *     --video "D2 am_michael=<folder>/d2-manim-am_michael.mp4" --video "D3 chatterbox=<...>.mp4"
 * For each video it reads <video without .mp4>.lines.json (written by render.py: every spoken
 * line's text, normalised audio and the words `hyperframes transcribe` heard, and every string the
 * scene set on screen) and fails the video on any of:
 *   * format: not 1080×1920, not 30 fps, or no audio stream (ffprobe);
 *   * length outside voice.json's 30-60 s;
 *   * a line failing lineQualityProblems (quality.ts, the worked examples' own checks: character
 *     error rate against the script, clipping, lead/tail/inner silence);
 *   * the voice-over-music margin (audio.ts mixProblem);
 *   * S1 on what was drawn: a spoken line sharing VERBATIM_RUN_WORDS (6) consecutive words with any
 *     string the scene set on screen (rules.ts sharedRun, the same normalisation as S1 at prepare
 *     time, which only sees the example's own text; this sees labels too). S2 (the spoken hook is
 *     not the hook line) is enforced by prepare.ts, which refuses the example before it is voiced.
 * It also measures the finished video's loudness with the worked examples' own loudnorm pass
 * (voice.ts loudnessMeasureArgs, parseLoudnorm) and prints integrated LUFS and true peak. That
 * column is a report: the ruled target applies to each voice line, which normalisation meets,
 * and the music bed sits under it. Exit 1 when any video fails.
 *
 * D1 (Karl, 2026-11-02): one more gate and one more column.
 *   * The word guard (word-guard.ts): every spoken line and every string the scene set on screen
 *     (the log's on_screen list) is scanned for the third-party calculator's name. Any hit is
 *     listed with the line key or on-screen index and fails the video: by the owner's ruling that
 *     word never ships.
 *   * Timers: a video with on-screen stopwatches logs each one's start, stop and shown value
 *     (graph.py Stopwatch). The shown value must be the floored tenths of stop − start on the video
 *     clock, or the video fails; the column prints what the viewer sees.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { voiceWordsSchema } from "../../../packages/shared/src/worked-example-schema";
import { sharedRun } from "../../../shared/worked-examples/rules";
import { mixProblem, readWav } from "../../worked-examples/audio";
import { loadKit } from "../../worked-examples/kit";
import { lineQualityProblems } from "../../worked-examples/quality";
import { bannedWordHits, formatHit } from "./word-guard";
import {
  loudnessMeasureArgs,
  parseLoudnorm,
} from "../../worked-examples/voice";

export const linesLogSchema = z.object({
  duration: z.number().positive(),
  engine: z.string().min(1),
  lines: z
    .array(
      z.object({
        key: z.string().min(1),
        text: z.string().min(1),
        wav: z.string().endsWith(".wav"),
        words: voiceWordsSchema,
        start: z.number().min(0),
        duration: z.number().positive(),
      }),
    )
    .min(1),
  /** Every string the scene set on screen (scene.py ON_SCREEN). */
  on_screen: z.array(z.string()).min(1),
  /** The on-screen stopwatches, if the video has any (graph.py Stopwatch.stop). */
  timers: z
    .array(
      z.object({
        label: z.string().min(1),
        start: z.number().min(0),
        stop: z.number().min(0),
        shown: z.string().regex(/^\d+\.\d s$/),
      }),
    )
    .optional(),
});
export type PilotLinesLog = z.infer<typeof linesLogSchema>;

/** The picture every pilot video must have (owner brief "Video tools pilot", every video). */
export const PILOT_FORMAT = { width: 1080, height: 1920, fps: 30 } as const;

export const probeSchema = z.object({
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      avg_frame_rate: z.string().optional(),
    }),
  ),
  format: z.object({ duration: z.string() }),
});
export type Probe = z.infer<typeof probeSchema>;

/** "30/1" → 30; "0/0" or garbage → NaN. */
function rate(fraction: string | undefined): number {
  const [n, d] = (fraction ?? "").split("/").map(Number);
  return n !== undefined && d !== undefined && d !== 0 ? n / d : Number.NaN;
}

/** Format problems: size, frame rate, an audio stream. */
export function formatProblems(probe: Probe): string[] {
  const out: string[] = [];
  const video = probe.streams.find((s) => s.codec_type === "video");
  if (!video) return ["format: no video stream"];
  if (
    video.width !== PILOT_FORMAT.width ||
    video.height !== PILOT_FORMAT.height
  )
    out.push(
      `format: ${video.width ?? "?"}×${video.height ?? "?"}, not ${PILOT_FORMAT.width}×${PILOT_FORMAT.height}`,
    );
  const fps = rate(video.avg_frame_rate);
  if (Math.abs(fps - PILOT_FORMAT.fps) > 0.01)
    out.push(
      `format: ${Number.isNaN(fps) ? "unknown" : fps.toFixed(2)} fps, not ${PILOT_FORMAT.fps}`,
    );
  if (!probe.streams.some((s) => s.codec_type === "audio"))
    out.push("format: no audio stream");
  return out;
}

/** S1 against the rendered screen: each spoken line against each string the scene drew. */
export function screenEchoProblems(log: PilotLinesLog): string[] {
  const out: string[] = [];
  for (const line of log.lines)
    for (const shown of log.on_screen) {
      const run = sharedRun(line.text, shown);
      if (run !== null)
        out.push(
          `S1 reads the screen: spoken ${line.key} repeats "${run}" from on-screen "${shown}"`,
        );
    }
  return out;
}

/** The word guard over a rendered video's log: spoken lines by key, on-screen strings by index. */
export function logWordHits(log: PilotLinesLog): string[] {
  return [
    ...log.lines.flatMap((l) =>
      bannedWordHits(`spoken line "${l.key}"`, l.text),
    ),
    ...log.on_screen.flatMap((s, k) =>
      bannedWordHits(`on-screen string ${k + 1}`, s),
    ),
  ].map(formatHit);
}

/** Each stopwatch as the viewer sees it, or why its shown value is not its measured segment. */
export function timerRows(log: PilotLinesLog): {
  rows: string[];
  problems: string[];
} {
  const rows: string[] = [];
  const problems: string[] = [];
  for (const t of log.timers ?? []) {
    const tenths = Math.floor((t.stop - t.start) * 10 + 1e-9);
    const expected = `${Math.floor(tenths / 10)}.${tenths % 10} s`;
    rows.push(
      `${t.label} ${t.shown} (${t.start.toFixed(2)}-${t.stop.toFixed(2)} s)`,
    );
    if (t.shown !== expected)
      problems.push(
        `timer ${t.label}: shows ${t.shown}, but its segment ran ${expected}`,
      );
  }
  return { rows, problems };
}

export type PilotRow = {
  label: string;
  video: string;
  engine: string;
  seconds: number;
  lufs: number;
  truePeak: number;
  failures: string[];
  timers: string[];
};

function probe(video: string): Probe {
  return probeSchema.parse(
    JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=codec_type,width,height,avg_frame_rate:format=duration",
          "-of",
          "json",
          video,
        ],
        { encoding: "utf8" },
      ),
    ),
  );
}

/** The finished video's integrated loudness and true peak, by voice.ts's own measuring pass. */
function loudness(
  video: string,
  target: ReturnType<typeof loadKit>["voice"]["loudness"],
): { lufs: number; truePeak: number } {
  const run = spawnSync("ffmpeg", loudnessMeasureArgs(video, target), {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`ffmpeg loudnorm exited ${run.status}`);
  const m = parseLoudnorm(run.stderr);
  if (!m) throw new Error(`${video} measured silent`);
  return { lufs: Number(m.input_i), truePeak: Number(m.input_tp) };
}

export function checkVideo(label: string, video: string): PilotRow {
  const kit = loadKit();
  const log = linesLogSchema.parse(
    JSON.parse(readFileSync(video.replace(/\.mp4$/, ".lines.json"), "utf8")),
  );
  const p = probe(video);
  const failures: string[] = [...formatProblems(p)];
  const seconds = Number(p.format.duration);
  if (seconds < kit.voice.min_seconds || seconds > kit.voice.max_seconds)
    failures.push(
      `length ${seconds.toFixed(1)} s is outside ${kit.voice.min_seconds}-${kit.voice.max_seconds} s`,
    );
  const peaks: number[] = [];
  for (const line of log.lines) {
    const audio = readFileSync(line.wav);
    peaks.push(readWav(audio).peakDbfs);
    for (const problem of lineQualityProblems(
      line.text,
      line.words,
      audio,
      kit.voice.quality,
      kit.voice.transcript_aliases,
    ))
      failures.push(`${line.key}: ${problem}`);
  }
  const mix = mixProblem(
    peaks,
    kit.track.peak_dbfs,
    kit.voice.music_gain,
    kit.voice.min_voice_over_music_db,
  );
  if (mix) failures.push(`mix: ${mix}`);
  failures.push(...screenEchoProblems(log));
  failures.push(...logWordHits(log));
  const timers = timerRows(log);
  failures.push(...timers.problems);
  const l = loudness(video, kit.voice.loudness);
  return {
    label,
    video,
    engine: log.engine,
    seconds,
    lufs: l.lufs,
    truePeak: l.truePeak,
    failures,
    timers: timers.rows,
  };
}

export function pilotTable(rows: readonly PilotRow[]): string {
  return [
    "| Video | File | Engine | Length | Loudness | True peak | On-screen timers | Failures |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.label} | ${basename(r.video)} | ${r.engine} | ${r.seconds.toFixed(1)} s | ${r.lufs.toFixed(1)} LUFS | ${r.truePeak.toFixed(1)} dBTP | ${r.timers.length === 0 ? "none" : r.timers.join("; ")} | ${r.failures.length === 0 ? "none" : r.failures.join("; ")} |`,
    ),
  ].join("\n");
}

function main(): void {
  const args = process.argv.slice(2);
  const rows: PilotRow[] = [];
  for (let k = 0; k < args.length; k++) {
    if (args[k] !== "--video") continue;
    const spec = args[k + 1] ?? "";
    const at = spec.lastIndexOf("=");
    if (at <= 0)
      throw new Error(`--video takes "<label>=<path.mp4>", not "${spec}"`);
    rows.push(checkVideo(spec.slice(0, at), resolve(spec.slice(at + 1))));
  }
  if (rows.length === 0)
    throw new Error(
      'usage: check.ts --video "<label>=<path.mp4>" [--video ...]',
    );
  process.stdout.write(`${pilotTable(rows)}\n`);
  if (rows.some((r) => r.failures.length > 0)) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
