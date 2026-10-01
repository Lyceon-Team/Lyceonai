/**
 * Post-exam score report and renewal decision — the shapes the database, the job, the two
 * routes and the client all agree on.
 *
 * @spec [Doc-01_V8 §36.4 (the payer is asked "keep or cancel?"), §955 (canceled at period end);
 *        Doc-05C_V1.0 §7.2 (projection snapshots); Doc-05F_V1.0 §7.1 `target_exam_date`;
 *        contracts/notifications.contract.md §2.3, §8.1;
 *        SCL-191; owner rulings 2026-09-30]
 * | @implemented [2026-09-30]
 *
 * plain English: Zod first, types inferred (standards §7.2). Every literal set here mirrors a
 * CHECK constraint in `20261015000000_exam_score_renewal_decision.sql`; the PG contract test
 * asserts the two agree rather than leaving it to review.
 *
 * WHY THE SCORE RULES ARE STATED TWICE, HERE AND AS COLUMN CHECKS. Edge case 7 of the brief:
 * "validate, do not store nonsense into a dataset meant for model validation." The Zod schema
 * is what turns a bad body into a 400 with a readable message; the CHECK is what makes the bad
 * row unrepresentable whatever the caller is. Dropping either leaves the dataset defensible only
 * by convention — and one of them is the one a future backfill script will go around.
 */
import { z } from "zod";
// The occasion key is a plain calendar date in the student's own zone, and `localDateSchema` is
// already the canonical one for exactly that (`calendar/time.ts`): it refuses `2026-02-31`, which
// a `/^\d{4}-\d{2}-\d{2}$/` regex accepts. Consumed rather than re-declared — a second, weaker
// copy of a shared primitive is the divergence CLAUDE.md's unified-code rule exists to prevent,
// and tsc caught the duplicate export the moment it was written (TS2308).
import { localDateSchema } from "./calendar/time.js";

// ── Anchors, decisions ──────────────────────────────────────────────────────

/**
 * What the prompt is anchored on.
 *
 * `exam_date` is a sitting that has happened. `billing_cycle` is the fallback for a student
 * with no usable exam date — owner ruling 2026-09-30 #1, because half of entitled students had
 * no `target_exam_date` and "a student with no exam date must not be silently exempt from the
 * protection this exists to give". On that anchor there is no score to ask for, so only the
 * renewal question is asked.
 */
export const EXAM_RENEWAL_ANCHORS = ["exam_date", "billing_cycle"] as const;
export const examRenewalAnchorSchema = z.enum(EXAM_RENEWAL_ANCHORS);
export type ExamRenewalAnchor = z.infer<typeof examRenewalAnchorSchema>;

/**
 * ONE VOCABULARY FOR ONE CONSEQUENCE. On the exam anchor this is literally the retake answer;
 * on the billing-cycle anchor the question reads "are you still preparing?". Both have the same
 * two consequences — the subscription continues, or it ends at the end of the paid period — and
 * two enums for one consequence would be a second source of truth about the same money.
 */
export const RENEWAL_DECISIONS = ["retaking", "not_retaking"] as const;
export const renewalDecisionSchema = z.enum(RENEWAL_DECISIONS);
export type RenewalDecision = z.infer<typeof renewalDecisionSchema>;

/**
 * Who answered. The split is the guardian model, not a label: "still studying" is a fact about
 * the student and anyone who knows it may tell us; "stop charging me" is a fact about money and
 * only the person being charged may say it. So only a `payer` decision can set
 * `cancel_at_period_end`.
 */
export const RENEWAL_DECIDER_ROLES = ["student", "payer"] as const;
export const renewalDeciderRoleSchema = z.enum(RENEWAL_DECIDER_ROLES);
export type RenewalDeciderRole = z.infer<typeof renewalDeciderRoleSchema>;

/** What was DONE to the subscription, recorded beside what was said. */
export const RENEWAL_ACTIONS = [
  "none",
  "cancel_at_period_end",
  "cancel_cleared",
] as const;
export const renewalActionSchema = z.enum(RENEWAL_ACTIONS);
export type RenewalAction = z.infer<typeof renewalActionSchema>;

/**
 * Three values because "no projection" has two different causes, and a consumer that cannot
 * tell them apart will average both as a zero (owner ruling 2026-09-30 #7).
 */
export const PROJECTION_PAIRING_STATUSES = [
  "snapshot",
  "gated",
  "none",
] as const;
export const projectionPairingStatusSchema = z.enum(
  PROJECTION_PAIRING_STATUSES,
);
export type ProjectionPairingStatus = z.infer<
  typeof projectionPairingStatusSchema
>;

// ── Score scales (Digital SAT) ──────────────────────────────────────────────

export const SECTION_SCORE_MIN = 200;
export const SECTION_SCORE_MAX = 800;
export const TOTAL_SCORE_MIN = 400;
export const TOTAL_SCORE_MAX = 1600;
export const SCORE_STEP = 10;

const sectionScoreSchema = z
  .number()
  .int()
  .min(SECTION_SCORE_MIN)
  .max(SECTION_SCORE_MAX)
  .refine((v) => v % SCORE_STEP === 0, {
    message: `Section scores are reported in steps of ${SCORE_STEP}`,
  });

const totalScoreSchema = z
  .number()
  .int()
  .min(TOTAL_SCORE_MIN)
  .max(TOTAL_SCORE_MAX)
  .refine((v) => v % SCORE_STEP === 0, {
    message: `Total scores are reported in steps of ${SCORE_STEP}`,
  });

/**
 * The student's reported real SAT scores.
 *
 * THE SUM REFINEMENT IS NOT REDUNDANT WITH THE RANGES. A student can type 700 and 700 with a
 * total of 1500 and every field is individually legal; the pair is what is wrong. Refusing it is
 * edge case 7's second half ("or sections not summing") and the reason this is a `superRefine`
 * on the object rather than three independent field rules.
 *
 * `.strict()` because this body reaches a table that exists to be analysed: an unexpected key is
 * a caller that believes something about this endpoint that is not true, and accepting it
 * silently is how a field nobody reads ends up in a dataset.
 */
export const examScoreReportSubmitSchema = z
  .object({
    occasion_key: localDateSchema,
    total_score: totalScoreSchema,
    rw_score: sectionScoreSchema,
    math_score: sectionScoreSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.total_score !== value.rw_score + value.math_score) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total_score"],
        message:
          "The total must equal Reading and Writing plus Math — the Digital SAT total is their sum.",
      });
    }
  });
export type ExamScoreReportSubmit = z.infer<typeof examScoreReportSubmitSchema>;

/**
 * The renewal answer.
 *
 * `confirm` exists because §5 of the brief requires it: "No → confirm, then
 * `cancel_at_period_end: true`". An unconfirmed `not_retaking` is refused rather than acted on,
 * so ending a subscription always takes two deliberate steps. `retaking` needs no confirmation —
 * it changes nothing about the money.
 *
 * `new_target_exam_date` is only meaningful from the student, and only on the exam anchor. A
 * guardian may say their student is retaking (money); they may not set the date (learning
 * state), which is what Doc 01 §38.2's view-only rule means. The route enforces that; the schema
 * only says the field is optional.
 */
export const renewalDecisionSubmitSchema = z
  .object({
    occasion_key: localDateSchema,
    decision: renewalDecisionSchema,
    confirm: z.boolean().optional(),
    new_target_exam_date: localDateSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "not_retaking" && value.confirm !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["confirm"],
        message:
          "Ending the subscription needs an explicit confirmation on the same request.",
      });
    }
    if (value.decision === "not_retaking" && value.new_target_exam_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["new_target_exam_date"],
        message:
          "A new exam date and 'not retaking' are contradictory; send one or the other.",
      });
    }
  });
export type RenewalDecisionSubmit = z.infer<typeof renewalDecisionSubmitSchema>;

// ── Read model (the surface) ────────────────────────────────────────────────

export const projectionPairingSchema = z
  .object({
    section: z.enum(["M", "RW"]),
    projection_status: projectionPairingStatusSchema,
    snapshot_id: z.number().int().nullable(),
    snapshot_at: z.string().nullable(),
    projected_score_mid: z.number().int().nullable(),
    projected_score_low: z.number().int().nullable(),
    projected_score_high: z.number().int().nullable(),
  })
  .strict();
export type ProjectionPairing = z.infer<typeof projectionPairingSchema>;

export const examScoreReportViewSchema = z
  .object({
    report_id: z.string().uuid(),
    occasion_key: localDateSchema,
    total_score: z.number().int(),
    rw_score: z.number().int(),
    math_score: z.number().int(),
    reported_at: z.string(),
    projections: z.array(projectionPairingSchema),
  })
  .strict();
export type ExamScoreReportView = z.infer<typeof examScoreReportViewSchema>;

/**
 * What the surface is asking about right now, or `null` when nothing is pending.
 *
 * `decision` is the LATEST answer for this occasion, so a student who changed their mind sees
 * their current answer rather than their first one (edge case 5's last-write-wins, applied to
 * the read as well as the write).
 */
export const renewalPromptViewSchema = z
  .object({
    anchor: examRenewalAnchorSchema,
    occasion_key: localDateSchema,
    prompted_at: z.string(),
    /** The viewer's authority over this occasion: a payer may end the subscription. */
    viewer_role: renewalDeciderRoleSchema,
    decision: renewalDecisionSchema.nullable(),
    report: examScoreReportViewSchema.nullable(),
  })
  .strict();
export type RenewalPromptView = z.infer<typeof renewalPromptViewSchema>;
