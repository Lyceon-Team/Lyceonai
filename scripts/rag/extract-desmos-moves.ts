/**
 * @spec [Karl's brief 2026-10-27, "The Desmos playbook", step 1; R-14 (Karl 2026-10-15: Gemini
 *       reads the video; transcripts are blocked)] | @implemented [2026-10-27]
 *
 * plain English: Gemini watches each approved Desmos video once, end to end, and reports every
 * Desmos move it teaches: the SAT question type, the exact input sequence, what the student is
 * told to look at on the graph and how the instructor explains reading it, the pitfalls the
 * instructor warns about, and the video's explanation style. Everything is in Lyceon's own
 * words; the model is told not to quote the instructor. Typed Desmos input is not instructor
 * text and is kept exact.
 *
 * The video set: every approved row (`approve = yes`) in
 * docs/plans/lisa-video-library/video-tags-review.csv whose source or title names Desmos (the
 * 22 Tutorllini lessons and 7 others).
 *
 * Output: `scripts/rag/.cache/desmos-playbook/<video_id>.json` (gitignored), one per video, with
 * its token usage. A video already extracted with the same EXTRACT_VERSION is skipped, so a run
 * resumes where it stopped.
 *
 * Cost cap: before each call the script adds that call's worst-case estimate to the spend so
 * far (measured, cached runs included) and stops before crossing `--cap-usd` (default $10).
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/extract-desmos-moves.ts [--only <id>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  GENERATION_MODEL_DEFAULT,
  assertProxied,
  generateJson,
  priceOf,
  usageSchema,
  type Usage,
  ZERO_USAGE,
  addUsage,
} from "./vertex";

export const EXTRACT_VERSION = "desmos-moves-v1";
const REVIEW_CSV = resolve(
  "docs/plans/lisa-video-library/video-tags-review.csv",
);
const OUT_DIR = resolve("scripts/rag/.cache/desmos-playbook");
/** Measured on the tier-1 whole-video calls (2026-10-15): ~92 prompt tokens per second. */
const PROMPT_TOKENS_PER_SECOND_ESTIMATE = 110;
const OUTPUT_TOKENS_ESTIMATE = 16_000;

export const EXTRACT_SYSTEM = `You study one SAT math video that teaches the Desmos graphing calculator, built into the digital SAT. Watch the whole video, using what is typed and shown on screen as well as what is said.

Report every distinct Desmos move the video teaches. A move is one way of using Desmos for one kind of SAT question (for example: solving an equation by graphing both sides, finding a system's solution, reading a vertex). A video can teach several; one worked example of an already-reported move adds nothing new unless it shows a new input, a new reading or a new pitfall.

For each move:
- question_type: the SAT question type it answers, in plain words (for example "how many solutions does this system have").
- input_sequence: the exact steps in order: what is typed in Desmos (copy the expression exactly as typed, in Desmos syntax), and what is clicked, dragged or toggled. One step per entry.
- look_at: what the student is told to look at on the graph or in the expression list.
- reading: how the instructor explains turning what is seen into the answer: which coordinate, why, and any conversion.
- pitfalls: every warning the instructor gives about this move: a mistake, a misreading, a setting, a case where the move fails. Empty if none.
- start and end: the clock times of the move's first and last moment in the video, as "M:SS".

Then, for the whole video:
- explanation_style: two or three sentences on how the instructor teaches (pace, order, what is said before typing, how the answer is checked).
- covers_interpretation: true if the instructor explains what the graph means (why a feature is the answer), not only which button to press.

Write everything except typed Desmos input in your own words. Never quote the instructor; do not reproduce any sentence the instructor says. If a step is not visible or audible, do not invent it: leave it out.`;

const clock = z.string().regex(/^\d{1,2}:\d{2}(?::\d{2})?$/);
export const extractSchema = z.object({
  moves: z
    .array(
      z.object({
        question_type: z.string().min(1),
        input_sequence: z.array(z.string().min(1)).min(1),
        look_at: z.string().min(1),
        reading: z.string().min(1),
        pitfalls: z.array(z.string().min(1)),
        start: clock,
        end: clock,
      }),
    )
    .min(1),
  explanation_style: z.string().min(1),
  covers_interpretation: z.boolean(),
});
export type DesmosExtract = z.infer<typeof extractSchema>;

const extractResponseSchema = {
  type: "OBJECT",
  properties: {
    moves: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          question_type: { type: "STRING" },
          input_sequence: { type: "ARRAY", items: { type: "STRING" } },
          look_at: { type: "STRING" },
          reading: { type: "STRING" },
          pitfalls: { type: "ARRAY", items: { type: "STRING" } },
          start: { type: "STRING" },
          end: { type: "STRING" },
        },
        required: [
          "question_type",
          "input_sequence",
          "look_at",
          "reading",
          "pitfalls",
          "start",
          "end",
        ],
      },
    },
    explanation_style: { type: "STRING" },
    covers_interpretation: { type: "BOOLEAN" },
  },
  required: ["moves", "explanation_style", "covers_interpretation"],
} as const;

const cachedSchema = z.object({
  extract_version: z.literal(EXTRACT_VERSION),
  model: z.string(),
  video_id: z.string(),
  title: z.string(),
  source: z.string(),
  duration_seconds: z.number(),
  clips: z.number().int().positive().optional(),
  extract: extractSchema,
  usage: usageSchema,
});

type VideoRow = {
  video_id: string;
  title: string;
  source: string;
  duration_seconds: number;
};

/** Minimal RFC 4180 CSV reader: quoted fields, doubled quotes, commas inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function approvedDesmosVideos(csvText: string): VideoRow[] {
  const [header, ...rows] = parseCsv(csvText);
  if (!header) throw new Error("review CSV is empty");
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`review CSV has no ${name} column`);
    return i;
  };
  const [approve, id, title, source, duration] = [
    col("approve"),
    col("video_id"),
    col("title"),
    col("source"),
    col("duration_s"),
  ];
  return rows
    .filter((r) => r[approve]?.trim().toLowerCase() === "yes")
    .filter((r) => /desmos/i.test(`${r[source] ?? ""} ${r[title] ?? ""}`))
    .map((r) => ({
      video_id: r[id] ?? "",
      title: r[title] ?? "",
      source: r[source] ?? "",
      duration_seconds: Number(r[duration]),
    }));
}

/** A video over 15 minutes is read in 10-minute clips: whole-video calls on the 22-minute lesson
 * failed six times running with a proxy 502 (2026-10-27). */
const WHOLE_VIDEO_MAX_SECONDS = 900;
const CLIP_SECONDS = 600;
export function clipsOf(duration: number): Array<[number, number]> {
  if (duration <= WHOLE_VIDEO_MAX_SECONDS) return [[0, duration]];
  const clips: Array<[number, number]> = [];
  for (let start = 0; start < duration; start += CLIP_SECONDS) {
    clips.push([start, Math.min(duration, start + CLIP_SECONDS)]);
  }
  return clips;
}

function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function estimateUsd(model: string, seconds: number): number {
  const p = priceOf(model);
  return (
    (seconds * PROMPT_TOKENS_PER_SECOND_ESTIMATE * p.input +
      OUTPUT_TOKENS_ESTIMATE * clipsOf(seconds).length * p.output) /
    1_000_000
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      only: { type: "string" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      "cap-usd": { type: "string", default: "10" },
    },
  });
  const cap = Number(values["cap-usd"]);
  const model = values.model;
  assertProxied();
  mkdirSync(OUT_DIR, { recursive: true });

  const videos = approvedDesmosVideos(readFileSync(REVIEW_CSV, "utf8")).filter(
    (v) => values.only === undefined || v.video_id === values.only,
  );
  let spent = 0;
  const todo: VideoRow[] = [];
  for (const v of videos) {
    const path = resolve(OUT_DIR, `${v.video_id}.json`);
    const cached = existsSync(path)
      ? cachedSchema.safeParse(JSON.parse(readFileSync(path, "utf8")))
      : null;
    if (cached?.success && cached.data.model === model)
      spent += cached.data.usage.usd;
    else todo.push(v);
  }
  process.stdout.write(
    `${videos.length} videos; ${videos.length - todo.length} cached ($${spent.toFixed(4)}); ${todo.length} to extract; cap $${cap}\n`,
  );

  const failed: string[] = [];
  for (const v of todo) {
    const estimate = estimateUsd(model, v.duration_seconds);
    if (spent + estimate > cap) {
      process.stdout.write(
        `stopping before ${v.video_id}: $${spent.toFixed(4)} spent + $${estimate.toFixed(4)} estimate would pass the $${cap} cap\n`,
      );
      break;
    }
    let usage: Usage = ZERO_USAGE;
    try {
      const parts: DesmosExtract[] = [];
      for (const [start, end] of clipsOf(v.duration_seconds)) {
        parts.push(
          await generateJson({
            step: `desmos-moves ${v.video_id} ${clockOf(start)}-${clockOf(end)}`,
            model,
            system: EXTRACT_SYSTEM,
            video: { videoId: v.video_id, start, end },
            user:
              `Video title: ${v.title}\nThe video is ${clockOf(v.duration_seconds)} long.` +
              (start === 0 && end === v.duration_seconds
                ? ""
                : ` You are watching the part from ${clockOf(start)} to ${clockOf(end)}; report only the moves taught in this part.`),
            responseSchema: extractResponseSchema,
            schema: extractSchema,
            onUsage: (u) => {
              usage = addUsage(usage, u);
            },
          }),
        );
      }
      const extract: DesmosExtract = {
        moves: parts.flatMap((p) => p.moves),
        explanation_style: parts.map((p) => p.explanation_style).join(" "),
        covers_interpretation: parts.some((p) => p.covers_interpretation),
      };
      writeFileSync(
        resolve(OUT_DIR, `${v.video_id}.json`),
        `${JSON.stringify({ extract_version: EXTRACT_VERSION, model, ...v, clips: parts.length, extract, usage }, null, 2)}\n`,
      );
      process.stdout.write(
        `${v.video_id}: ${parts.length} clip(s), ${extract.moves.length} move(s); ${usage.prompt} in / ${usage.output} out; $${usage.usd.toFixed(4)}; total $${(spent + usage.usd).toFixed(4)}\n`,
      );
    } catch (err: unknown) {
      // Logged and counted, never silent: the run exits non-zero when any video failed. The
      // usage of clips that did succeed is still counted toward the spend.
      failed.push(v.video_id);
      process.stdout.write(
        `${v.video_id}: FAILED (${err instanceof Error ? err.message : String(err)}); $${usage.usd.toFixed(4)} spent on it\n`,
      );
    }
    spent += usage.usd;
  }
  process.stdout.write(`measured spend: $${spent.toFixed(4)}\n`);
  if (failed.length > 0) {
    process.stdout.write(`failed: ${failed.join(", ")}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith("extract-desmos-moves.ts")) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
