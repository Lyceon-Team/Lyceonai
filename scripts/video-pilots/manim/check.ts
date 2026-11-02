/**
 * Video pilot (Manim): the voice checks and the comparison table for rendered pilot videos.
 *
 * @spec [owner brief "Video tools pilot" (Karl, 2026-11-02) Part D2, Video 4: "write a short
 *       comparison table: length, words per minute, any transcription-check failures through
 *       scripts/worked-examples/quality.ts"; OpenVoice addendum (Karl, 2026-10-27): the quality
 *       checks (transcription mismatch, clipping, silence)] | @implemented [2026-11-02]
 *
 * plain English:
 *   pnpm exec tsx scripts/video-pilots/manim/check.ts \
 *     --video "af_heart 1.0 (current)=<folder>/voice-compare-af_heart.mp4" --video ...
 * For each video it reads <video without .mp4>.lines.json (written by render.py: every spoken line's
 * text, audio file and the words `hyperframes transcribe` heard) and runs, per line, the same
 * lineQualityProblems the worked examples' CI runs on committed voice (quality.ts: character error
 * rate against the script, clipping, lead/tail/inner silence), the same voice-over-music margin
 * (audio.ts mixProblem), the 30-60 s bounds from voice.json, and the pace with compare-voices.ts
 * wordsPerMinute (heard words over spoken seconds). It prints a Markdown table, one row per video,
 * and every failing line with its reason. Exit 0 for the voice checks: they are a report for Karl,
 * not a gate.
 *
 * D1 (Karl, 2026-11-02): two more columns and one gate.
 *   * The word guard (word-guard.ts): every spoken line and every string the scene set on screen
 *     (the log's on_screen list, captions included) is scanned for the third-party calculator's
 *     name. Any hit is listed with the line key or on-screen index and the run exits 1: by the
 *     owner's ruling that word never ships, so this one IS a gate.
 *   * Timers: a video with on-screen stopwatches logs each one's start, stop and shown value
 *     (graph.py Stopwatch). The shown value must be the floored tenths of stop − start on the video
 *     clock, or the row fails; the column prints what the viewer sees.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  voiceManifestSchema,
  voiceWordsSchema,
} from "../../../packages/shared/src/worked-example-schema";
import { mixProblem, readWav } from "../../worked-examples/audio";
import { wordsPerMinute } from "../../worked-examples/compare-voices";
import { sha256 } from "../../worked-examples/content";
import { loadKit } from "../../worked-examples/kit";
import { lineQualityProblems } from "../../worked-examples/quality";
import { bannedWordHits, formatHit } from "./word-guard";

const linesLogSchema = z.object({
  duration: z.number().positive(),
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
  /** Every string the scene set on screen (layout.py ON_SCREEN), captions included. */
  on_screen: z.array(z.string()).optional(),
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

export type PilotRow = {
  label: string;
  video: string;
  seconds: number;
  wpm: number;
  failures: string[];
  /** Hits of the banned calculator name: any one fails the run. */
  wordHits: string[];
  timers: string[];
};

/** The word guard over a rendered video's log: spoken lines by key, on-screen strings by index. */
export function logWordHits(log: PilotLinesLog): string[] {
  return [
    ...log.lines.flatMap((l) =>
      bannedWordHits(`spoken line "${l.key}"`, l.text),
    ),
    ...(log.on_screen ?? []).flatMap((s, k) =>
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

function probeSeconds(video: string): number {
  const out = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      video,
    ],
    { encoding: "utf8" },
  );
  return Number(out.trim());
}

export function checkVideo(label: string, video: string): PilotRow {
  const kit = loadKit();
  const log = linesLogSchema.parse(
    JSON.parse(readFileSync(video.replace(/\.mp4$/, ".lines.json"), "utf8")),
  );
  const failures: string[] = [];
  const peaks: number[] = [];
  for (const line of log.lines) {
    const audio = readFileSync(line.wav);
    peaks.push(readWav(audio).peakDbfs);
    for (const p of lineQualityProblems(
      line.text,
      line.words,
      audio,
      kit.voice.quality,
      kit.voice.transcript_aliases,
    ))
      failures.push(`${line.key}: ${p}`);
  }
  const mix = mixProblem(
    peaks,
    kit.track.peak_dbfs,
    kit.voice.music_gain,
    kit.voice.min_voice_over_music_db,
  );
  if (mix) failures.push(`mix: ${mix}`);
  const timers = timerRows(log);
  failures.push(...timers.problems);
  const seconds = probeSeconds(video);
  if (seconds < kit.voice.min_seconds || seconds > kit.voice.max_seconds)
    failures.push(
      `length ${seconds.toFixed(1)} s is outside ${kit.voice.min_seconds}-${kit.voice.max_seconds} s`,
    );
  const manifest = voiceManifestSchema.parse({
    voice: "af_heart",
    speaking_rate: 1,
    lines: log.lines.map((l) => ({
      key: l.key,
      text_sha256: sha256(l.text),
      file: basename(l.wav),
      duration: l.duration,
      words: l.words,
    })),
  });
  return {
    label,
    video,
    seconds,
    wpm: wordsPerMinute(manifest),
    failures,
    wordHits: logWordHits(log),
    timers: timers.rows,
  };
}

export function pilotTable(rows: readonly PilotRow[]): string {
  return [
    "| Voice | Video | Length | Pace | Quality-check failures | Calculator-name guard | On-screen timers |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.label} | ${basename(r.video)} | ${r.seconds.toFixed(1)} s | ${Math.round(r.wpm)} wpm | ${r.failures.length === 0 ? "none" : r.failures.join("; ")} | ${r.wordHits.length === 0 ? "pass" : `FAIL: ${r.wordHits.join("; ")}`} | ${r.timers.length === 0 ? "none" : r.timers.join("; ")} |`,
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
  const hits = rows.flatMap((r) =>
    r.wordHits.map((h) => `${basename(r.video)}: ${h}`),
  );
  if (hits.length > 0) {
    process.stderr.write(`${hits.join("\n")}\n`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
