/**
 * Practice engine RESPONSE contract — the shape review must not drift from.
 *
 * @spec [Doc-02B_V4 §14; owner ruling 2026-09-21 (A14); brief R3 §4] | @implemented [2026-09-21]
 *
 * plain English: Zod schemas describing exactly what practice's create, state, next,
 * answer and skip routes return. Review's equivalents must satisfy the same schemas.
 * expected outcome: R4 can point practice's existing loop component at the review
 * endpoints without forking it, because a field renamed on either side fails CI here
 * rather than in the browser.
 *
 * HOW THIS STAYS HONEST. A hand-written "this is what practice returns" schema is
 * worth nothing if practice moves and the schema doesn't. So the A14 test pins it at
 * BOTH ends:
 *   - practice's own live response is parsed with `.strict()`, so a field added,
 *     removed or renamed in practice-canonical.ts fails this schema immediately;
 *   - review's response is parsed WITHOUT `.strict()`, so review may add fields
 *     (`queueEntryId`, and whatever R4 needs) but may not drop or rename one.
 * The asymmetry is the rule "review may only add fields", expressed as code.
 *
 * trade-offs: practice cannot change a response field without updating this file in
 * the same PR. That is the intended cost — an unannounced change is exactly the drift
 * this exists to catch. edge cases: `correct_answer` and `explanation` are pinned to
 * `null` in the pre-submit DTO, not merely optional, so the anti-leak invariant is
 * part of the shape rather than a separate assertion.
 */

import { z } from "zod";

/** Per-session opaque option token. The canonical A-D letter never leaves the server. */
export const studentSafeOptionSchema = z.object({
  id: z.string(),
  text: z.string(),
});

/** getSessionStats() — practice-canonical.ts:1134. */
export const sessionStatsSchema = z.object({
  correct: z.number(),
  incorrect: z.number(),
  skipped: z.number(),
  total: z.number(),
  streak: z.number(),
});

/**
 * toStudentSafeQuestionDTO() — practice-canonical.ts:753.
 * `correct_answer` and `explanation` are z.null(), not nullable: a pre-submit payload
 * that carries either one is a leak, and this schema refuses it (Coding Standards §5.2).
 */
export const studentSafeQuestionSchema = z.object({
  sessionItemId: z.string(),
  stem: z.string(),
  passage: z.string().nullable(),
  assets: z.unknown().nullable(),
  section: z.string(),
  questionType: z.enum(["multiple_choice", "grid_in"]),
  itemType: z.enum(["mcq", "grid_in"]),
  inputMode: z.enum(["choice", "numeric_entry"]),
  options: z.array(studentSafeOptionSchema),
  difficulty: z.union([z.string(), z.number(), z.null()]),
  correct_answer: z.null(),
  explanation: z.null(),
});

/** POST /sessions — practice-canonical.ts:2346. */
export const engineCreateSessionResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  userId: z.string(),
  mode: z.string().nullable(),
  state: z.string(),
  replayed: z.boolean(),
  clientInstanceId: z.string(),
  targetQuestionCount: z.number(),
  calculatorState: z.unknown().nullable(),
});

/** GET /sessions/:sessionId/state — practice-canonical.ts:2634. */
export const engineSessionStateResponseSchema = z.object({
  sessionId: z.string(),
  section: z.string().nullable(),
  mode: z.string().nullable(),
  state: z.string(),
  currentOrdinal: z.number(),
  answeredCount: z.number(),
  skippedCount: z.number(),
  completedCount: z.number(),
  targetQuestionCount: z.number(),
  calculatorState: z.unknown().nullable(),
  lastServedUnansweredItem: z
    .object({ sessionItemId: z.string(), ordinal: z.number() })
    .nullable(),
  clientInstanceId: z.string().nullable(),
  readOnly: z.boolean(),
});

/**
 * GET /sessions/:sessionId/next — practice-canonical.ts:2084 (serve) and :1958 (resume).
 * `currentIndex` is optional because only the option-heal branch at :1934 emits it;
 * the two ordinary branches do not. Modelling it as required would make this schema
 * describe a response practice does not actually send.
 */
export const engineNextItemResponseSchema = z.object({
  sessionId: z.string(),
  sessionItemId: z.string(),
  ordinal: z.number(),
  state: z.string(),
  calculatorState: z.unknown().nullable(),
  question: studentSafeQuestionSchema,
  stats: sessionStatsSchema,
  totalQuestions: z.number(),
  currentIndex: z.number().optional(),
});

/**
 * POST /answer — practice-canonical.ts:3691 (terminal) and :3271/:3373/:3469 (replays).
 * MCQ carries `correctOptionId`, grid-in carries `correctAnswer`; exactly one is
 * present, which is why both are optional here and the discriminating assertion lives
 * in the A2 test. `idempotentRetried` appears only on a replay.
 */
export const engineAnswerResponseSchema = z.object({
  sessionId: z.string(),
  sessionItemId: z.string(),
  isCorrect: z.boolean(),
  mode: z.enum(["multiple_choice", "grid_in"]),
  correctOptionId: z.string().nullable().optional(),
  correctAnswer: z.string().nullable().optional(),
  explanation: z.string().nullable(),
  feedback: z.string(),
  stats: sessionStatsSchema,
  state: z.string().optional(),
  idempotentRetried: z.boolean().optional(),
});

/** POST /sessions/:sessionId/skip — practice-canonical.ts:3939. */
export const engineSkipResponseSchema = z.object({
  sessionId: z.string(),
  sessionItemId: z.string(),
  skipped: z.boolean(),
  mode: z.enum(["multiple_choice", "grid_in"]),
  feedback: z.string(),
  stats: sessionStatsSchema,
  state: z.string().optional(),
  idempotentRetried: z.boolean().optional(),
});

export type EngineCreateSessionResponse = z.infer<
  typeof engineCreateSessionResponseSchema
>;
export type EngineSessionStateResponse = z.infer<
  typeof engineSessionStateResponseSchema
>;
export type EngineNextItemResponse = z.infer<
  typeof engineNextItemResponseSchema
>;
export type EngineAnswerResponse = z.infer<typeof engineAnswerResponseSchema>;
export type EngineSkipResponse = z.infer<typeof engineSkipResponseSchema>;

/**
 * The five shapes A14 checks, keyed by the route they belong to. Kept as one table so
 * the test iterates it rather than listing schemas by hand — a schema added here is
 * covered without touching the test.
 */
export const ENGINE_RESPONSE_SCHEMAS = {
  create: engineCreateSessionResponseSchema,
  state: engineSessionStateResponseSchema,
  next: engineNextItemResponseSchema,
  answer: engineAnswerResponseSchema,
  skip: engineSkipResponseSchema,
} as const;

export type EngineResponseRoute = keyof typeof ENGINE_RESPONSE_SCHEMAS;
