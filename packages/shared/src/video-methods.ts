/**
 * @spec [Doc-03D_V1.2 §6.7 (metadata schema) as amended by the video method SCL; owner brief
 *       "Video retrieval: method tags", Karl 2026-10-27 (Step 0 ruled: methods {desmos,
 *       algebraic}, backsolve only if three approved videos carry it (four did), format {worked_example, formula, lesson, strategy}, a versioned keyword map
 *       in runtime config, no model call)] | @implemented [2026-10-27]
 *
 * plain English: THE one definition of how a video (or a curriculum chunk) solves a question,
 * and of what shape a video takes. Consumed by the tagging script (the prompt quotes the
 * definitions and tests below), the review file's parser, the server's retrieval and the CI
 * gates that check the SQL CHECK lists against these arrays, so the vocabulary cannot drift
 * between the database, the tagger and the runtime.
 *
 *  - `VIDEO_METHODS`: grounded in how SAT math questions are solved. Kept small: a value is in
 *    only when at least three approved videos actually carry it (the tagging record is in
 *    docs/plans/lisa-video-library/README.md). Reading and Writing videos carry no method.
 *  - `VIDEO_FORMATS`: `worked_example` and `strategy` are `curriculum_chunks.content_type`
 *    values, spelt the same so the two pipelines share them; `lesson` and `formula` are new
 *    because `content_type`'s other values name a medium (`textbook`, `video_transcript`).
 *  - `VIDEO_FORMAT_PRIORITY`: the retrieval's format order (Karl, 2026-10-27): formula,
 *    worked_example, lesson, strategy. Formula shorts first, so a request with no method keeps
 *    today's quick formula videos ahead of 20- and 58-minute ones.
 *  - `detectRequestedMethod`: the student's message → the method asked for, or null.
 *    Deterministic: normalised text, whole-word phrase match, the longest matching phrase wins
 *    (so "without desmos" is algebraic, not desmos); two methods tied on length → null.
 *
 * Edge cases: an empty or punctuation-only message → null. Matching is on the CURRENT message
 * only; an earlier turn's request does not carry over.
 */
import { z } from "zod";

export const VIDEO_METHODS = ["desmos", "algebraic", "backsolve"] as const;
export const videoMethodSchema = z.enum(VIDEO_METHODS);
export type VideoMethod = z.infer<typeof videoMethodSchema>;

export const VIDEO_FORMATS = [
  "worked_example",
  "formula",
  "lesson",
  "strategy",
] as const;
export const videoFormatSchema = z.enum(VIDEO_FORMATS);
export type VideoFormat = z.infer<typeof videoFormatSchema>;
/** The retrieval's format order; the SQL ranking uses exactly this array. */
export const VIDEO_FORMAT_PRIORITY: readonly VideoFormat[] = [
  "formula",
  "worked_example",
  "lesson",
  "strategy",
];

/** One line each: what the value means, and the test for applying it. */
export const VIDEO_METHOD_DEFINITIONS: Readonly<
  Record<VideoMethod, { means: string; test: string }>
> = {
  desmos: {
    means:
      "Solves by entering the problem into the Desmos graphing calculator and reading the answer from the graph, a table or a command.",
    test: "The answer comes from something typed into Desmos and read back. Desmos used only to check work done by hand does not count.",
  },
  algebraic: {
    means:
      "Solves by hand: rewriting, substituting into a formula, or reasoning symbolically.",
    test: "The answer comes from written steps or a formula applied by hand, with no calculator output deciding it.",
  },
  backsolve: {
    means:
      "Solves by trying the answer choices, or numbers it picks, in the question.",
    test: "The video substitutes the given choices or chosen test numbers into the question to find or eliminate the answer.",
  },
};

export const VIDEO_FORMAT_DEFINITIONS: Readonly<
  Record<VideoFormat, { means: string; test: string }>
> = {
  worked_example: {
    means:
      "Most of the runtime solves specific SAT questions from start to finish.",
    test: "The video is organised around particular questions, each worked through to its answer.",
  },
  formula: {
    means:
      "States one formula or rule and how to use it, in about two minutes or less, without working a full question.",
    test: "A single formula or rule is the subject, and no complete question is solved.",
  },
  lesson: {
    means:
      "Teaches a skill or a tool technique in general; its examples serve the technique.",
    test: "The video is organised around a topic or technique, not around particular questions or a list of tips.",
  },
  strategy: {
    means: "Test-taking tips and shortcuts that apply across questions.",
    test: "The video is a list of tips, tricks or hacks rather than one technique taught in depth.",
  },
};

// ── The keyword map (tutor_context_runtime_config.video_method_keywords) ─────

const phraseSchema = z
  .string()
  .min(1)
  .max(60)
  .refine((p) => normaliseForMatch(p) === ` ${p} `, {
    message:
      "a phrase must already be normalised: lowercase words separated by single spaces",
  });

export const videoMethodKeywordMapSchema = z
  .object({
    version: z.number().int().positive(),
    methods: z.record(videoMethodSchema, z.array(phraseSchema).min(1).max(40)),
  })
  .strict();
export type VideoMethodKeywordMap = z.infer<typeof videoMethodKeywordMapSchema>;

/**
 * Lowercase (NFKC), every run of non-letters/digits becomes one space, padded with a space at
 * each end so a phrase matches only on whole words (" graph it " is not in " graphite ").
 */
export function normaliseForMatch(text: string): string {
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return words === "" ? " " : ` ${words} `;
}

/** Pure and deterministic: the same message and map always give the same answer. */
export function detectRequestedMethod(
  message: string,
  map: VideoMethodKeywordMap,
): VideoMethod | null {
  const haystack = normaliseForMatch(message);
  let best: { method: VideoMethod; length: number } | null = null;
  let tied = false;
  for (const method of VIDEO_METHODS) {
    for (const phrase of map.methods[method] ?? []) {
      if (!haystack.includes(` ${phrase} `)) continue;
      if (best === null || phrase.length > best.length) {
        best = { method, length: phrase.length };
        tied = false;
      } else if (phrase.length === best.length && best.method !== method) {
        tied = true;
      }
    }
  }
  return best === null || tied ? null : best.method;
}
