/**
 * @spec [Doc-03D_V1.2 §5.1 (golden set), §5.3 (judge calibration), §3.2.1 (baseline and
 *       variance band), §3.1 (tutor act), §8.1 (attribution);
 *       docs/eval/lisa/G0-2_Teaching_Quality_Set_Design.md §4, §5.2; Karl's rulings 2026-10-27:
 *       D3 (Gemini Pro judges gemini-3.5-flash; the judge reports, the code decides,
 *       deterministic checks first), D4 (5 runs per case)] | @implemented [2026-10-27]
 *
 * plain English: the shapes the G0-2 teaching-quality harness reads and writes, and the one
 * function that turns checks into a verdict.
 *  - A rubric (repo-side, per case): Karl's gold, the judge note, LISA must / must not. Every
 *    field is null until Karl writes the golds; a case without them is `unscored`.
 *  - The judge response: what the judge model reports, item by item, with quotes. It never
 *    carries a verdict.
 *  - The run record: one replay of one case, the `record` column of `tutor_eval_runs`.
 *  - `decideTutorEvalVerdict`: the code's verdict from the Class 1 checks and the judge.
 *  - `tutorEvalAgreement`: judge-vs-Karl agreement over graded runs (Doc 03D §5.3).
 *
 * trade-offs:
 *  - An answer leak fails a run even when it is unscored: the leak scan is the platform's
 *    anti-leak invariant, not a teaching-quality judgement, so it does not wait for golds.
 *  - A judge claim the code cannot verify (a "met" or "violated" whose quote is not in LISA's
 *    reply, or an item list that does not match the rubric) makes the run REVIEW_NEEDED, never
 *    PASS: the judge reports, and a report that doesn't check out is not taken on trust.
 *  - The context hash is `provisional` until the canonical `context_hash` lands from the
 *    attribution lane (design §6); provisional and canonical records are never compared.
 */
import { z } from "zod";

/** The set this harness evaluates (design §8, D1: a separate versioned set). */
export const TEACHING_QUALITY_SET_VERSION = "teaching-quality v1";

/** Case ids as the `tutor_eval_cases.case_id` CHECK accepts them. */
export const tutorEvalCaseIdSchema = z
  .string()
  .regex(
    /^[A-Z0-9][A-Z0-9-]*$/,
    "case ids are upper-case letters, digits and hyphens",
  );

export const tutorEvalVerdictSchema = z.enum([
  "pass",
  "fail",
  "review_needed",
  "unscored",
]);
export type TutorEvalVerdict = z.infer<typeof tutorEvalVerdictSchema>;

export const tutorEvalOwnerGradeSchema = z.enum([
  "pass",
  "fail",
  "review_needed",
]);
export type TutorEvalOwnerGrade = z.infer<typeof tutorEvalOwnerGradeSchema>;

/** Karl's rubric for one case. Null fields mean "not written yet" (design §7: held). */
export const tutorEvalRubricSchema = z.object({
  case_id: tutorEvalCaseIdSchema,
  gold_response: z.string().min(1).nullable(),
  judge_note: z.string().min(1).nullable(),
  must: z.array(z.string().min(1)).nullable(),
  must_not: z.array(z.string().min(1)).nullable(),
});
export type TutorEvalRubric = z.infer<typeof tutorEvalRubricSchema>;

/** A rubric the judge can score against: every slot filled. */
export type CompleteTutorEvalRubric = {
  case_id: string;
  gold_response: string;
  judge_note: string;
  must: string[];
  must_not: string[];
};

export function completeRubric(
  rubric: TutorEvalRubric,
): CompleteTutorEvalRubric | null {
  if (
    rubric.gold_response === null ||
    rubric.judge_note === null ||
    rubric.must === null ||
    rubric.must_not === null
  ) {
    return null;
  }
  return {
    case_id: rubric.case_id,
    gold_response: rubric.gold_response,
    judge_note: rubric.judge_note,
    must: rubric.must,
    must_not: rubric.must_not,
  };
}

/** Doc 03D §3.1 tutor acts. */
export const tutorActSchema = z.enum([
  "diagnostic_question",
  "hint",
  "worked_step",
  "explanation",
  "full_solution",
  "affirmation",
  "redirect",
]);

/** What the judge reports (design §4.2). No verdict field, by construction. */
export const tutorEvalJudgeResponseSchema = z
  .object({
    must: z.array(
      z.object({ item: z.string(), met: z.boolean(), quote: z.string() }),
    ),
    must_not: z.array(
      z.object({ item: z.string(), violated: z.boolean(), quote: z.string() }),
    ),
    gold_move: z.enum(["same_move", "partial", "different_move"]),
    tutor_act: tutorActSchema,
    tool_request_addressed: z.boolean(),
  })
  .strict();
export type TutorEvalJudgeResponse = z.infer<
  typeof tutorEvalJudgeResponseSchema
>;

/** Class 1: deterministic checks, run before any model (design §4.1). */
export const tutorEvalClass1Schema = z.object({
  /** `hasAnswerLeak` on the raw reply, pre-submit only (false post-submit). */
  answer_leak: z.boolean(),
  /** The BFF serializer substituted the reply. */
  scan_blocked: z.boolean(),
  /** Every serializer scan class that fired, in scan order. */
  scan_classes: z.array(z.string()),
  /** No mention of Desmos / calculator / graph, and the reply ends in a question. */
  tool_request_unanswered: z.boolean(),
});
export type TutorEvalClass1 = z.infer<typeof tutorEvalClass1Schema>;

const tokenUsageSchema = z.object({
  prompt: z.number().int().nonnegative(),
  cached: z.number().int().nonnegative(),
  /** Billed output: visible output plus thinking. */
  output: z.number().int().nonnegative(),
  thoughts: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});

/** The `record` column of `tutor_eval_runs`: one replay (design §5.2). */
export const tutorEvalRunRecordSchema = z
  .object({
    set_version: z.string().min(1),
    case_id: tutorEvalCaseIdSchema,
    run_index: z.number().int().min(1),
    prompt_version: z.string().min(1),
    context_hash: z.object({
      kind: z.literal("provisional"),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
    model_alias: z.enum(["flash_class", "pro_class"]),
    provider_model: z.string().min(1),
    thinking_budget: z.number().int().nonnegative(),
    temperature: z.number(),
    top_p: z.number(),
    top_k: z.number(),
    max_output_tokens: z.number().int().positive(),
    worker_git_sha: z.string().min(7),
    finish_reason: z.string().nullable(),
    latency_ms: z.number().nonnegative(),
    raw_reply: z.string(),
    visible_reply: z.string(),
    suggested_action: z.string(),
    class1: tutorEvalClass1Schema,
    judge: z
      .object({
        model: z.string().min(1),
        response: tutorEvalJudgeResponseSchema,
        usage: tokenUsageSchema,
      })
      .nullable(),
    /** Why the judge did not run, when it did not. */
    judge_skipped: z.enum(["no_rubric", "leak"]).nullable(),
    verdict: tutorEvalVerdictSchema,
    tutor_usage: tokenUsageSchema,
  })
  .strict();
export type TutorEvalRunRecord = z.infer<typeof tutorEvalRunRecordSchema>;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A judge quote checks out only if it is a non-empty span of the reply. */
function quoteIsInReply(quote: string, reply: string): boolean {
  const q = normalise(quote);
  return q.length > 0 && normalise(reply).includes(q);
}

/**
 * The code's verdict (design §4.2). The judge never decides it.
 *
 * Order: a leak fails; no judge means unscored; a judge report that does not match the rubric
 * or quotes text the reply does not contain is REVIEW_NEEDED; any must unmet, must_not
 * violated, or tool request unaddressed fails; a pass needs all of those clear, a move that is
 * not `different_move`, and no Class 1 tool-request flag (a judge/heuristic disagreement is
 * for Karl to look at).
 */
export function decideTutorEvalVerdict(input: {
  class1: TutorEvalClass1;
  judge: TutorEvalJudgeResponse | null;
  rubric: CompleteTutorEvalRubric | null;
  visibleReply: string;
}): TutorEvalVerdict {
  const { class1, judge, rubric, visibleReply } = input;
  if (class1.answer_leak || class1.scan_classes.includes("answer_leak")) {
    return "fail";
  }
  if (judge === null || rubric === null) return "unscored";

  const itemsMatch =
    judge.must.length === rubric.must.length &&
    judge.must_not.length === rubric.must_not.length;
  if (!itemsMatch) return "review_needed";
  const claimsCheckOut =
    judge.must.every((m) => !m.met || quoteIsInReply(m.quote, visibleReply)) &&
    judge.must_not.every(
      (m) => !m.violated || quoteIsInReply(m.quote, visibleReply),
    );
  if (!claimsCheckOut) return "review_needed";

  if (
    judge.must_not.some((m) => m.violated) ||
    judge.must.some((m) => !m.met) ||
    !judge.tool_request_addressed
  ) {
    return "fail";
  }
  if (judge.gold_move === "different_move" || class1.tool_request_unanswered) {
    return "review_needed";
  }
  return "pass";
}

/** Judge-vs-Karl agreement over the runs Karl has graded (Doc 03D §5.3). */
export type TutorEvalAgreement = {
  /** Runs carrying both a scored verdict and Karl's grade. */
  graded: number;
  agreed: number;
  /** `${verdict}->${owner_grade}` counts, disagreements included. */
  pairs: Record<string, number>;
};

export function tutorEvalAgreement(
  rows: ReadonlyArray<{
    verdict: TutorEvalVerdict;
    owner_grade: TutorEvalOwnerGrade | null;
  }>,
): TutorEvalAgreement {
  const pairs: Record<string, number> = {};
  let graded = 0;
  let agreed = 0;
  for (const row of rows) {
    if (row.owner_grade === null || row.verdict === "unscored") continue;
    graded += 1;
    if (row.verdict === row.owner_grade) agreed += 1;
    const key = `${row.verdict}->${row.owner_grade}`;
    pairs[key] = (pairs[key] ?? 0) + 1;
  }
  return { graded, agreed, pairs };
}
