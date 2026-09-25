/**
 * Full-length exam — score report (Doc 04C) and forms listing contracts.
 *
 * @spec [Doc-04C_V1.0, §5.1 (ReportState), §8.1 (scored), §9.1 (partial), §10.2
 *        (failed), §11.2 (payload-by-state matrix), §11.3 (one serializer per state),
 *        §11.4 (not_completed), §11.5 (scoring_pending), §11.5b (unavailable),
 *        §11.7 (redaction), §15.1 (disclosure block), §16.1 (/report, /report/status),
 *        §16.8 (envelope)]
 *       [Doc-04A_V2.2 §16 as amended by SCL-147 (GET /api/tests/forms); Doc-04C §16.3]
 *       [Doc-04B_V4.3 §17.1 (disclosure text: served from score_disclosure_versions)]
 * @implemented [2026-09-25]
 *
 * plain English: every report payload is a `.strict()` object per state, so a
 * serializer that adds a field (a decomposition count, the module path, a failure
 * code) fails the parse instead of reaching a student. The disclosure text is NOT
 * here: 04C §15.1 makes it payload data, read from score_disclosure_versions.
 *
 * trade-offs: `voided` is in the state enum (04C §5.1) but has no payload schema:
 * no voiding workflow exists (04C §11.6, MVP-reserved), so nothing can produce it.
 */
import { z } from "zod";
import {
  examModeSchema,
  examSectionSchema,
  examSectionStateSchema,
  examSessionStateSchema,
} from "./exam-runtime-schema";

// ── §5.1 ────────────────────────────────────────────────────────────────────

export const examReportStateSchema = z.enum([
  "not_completed",
  "scoring_pending",
  "scored",
  "partial_scored",
  "failed_requires_review",
  "voided",
  "unavailable",
]);
export type ExamReportState = z.infer<typeof examReportStateSchema>;

// ── §5.3 derivation (pure) ──────────────────────────────────────────────────

export type ReportStateInputs = {
  sessionState: z.infer<typeof examSessionStateSchema>;
  scoreTotalPresent: boolean;
  scorePartialPresent: boolean;
  failurePresent: boolean;
  accessGranted: boolean;
};

/**
 * @spec [Doc-04C §5.3] | @implemented [2026-09-25]
 * plain English: the canonical report-state derivation, as a pure function, for an
 * access check that already ruled out `never_existed` (the caller answers a bare 403
 * for that). One definition serves the report and the forms listing. `voided` is
 * unreachable: no voiding record exists in MVP (§5.3 simplification).
 */
export function deriveReportState(inputs: ReportStateInputs): ExamReportState {
  if (!inputs.accessGranted) return "unavailable";
  switch (inputs.sessionState) {
    case "created":
    case "active":
    case "section_break":
    case "abandoned_final":
      return "not_completed";
    case "completed":
      if (inputs.scoreTotalPresent) return "scored";
      return inputs.failurePresent
        ? "failed_requires_review"
        : "scoring_pending";
    case "partial_scored_abandoned":
      if (inputs.scorePartialPresent) return "partial_scored";
      return inputs.failurePresent
        ? "failed_requires_review"
        : "scoring_pending";
  }
}

// ── §15.1 disclosure block (values come from score_disclosure_versions) ────────

export const examDisclosureSchema = z
  .object({
    disclosure_version: z.string().min(1),
    summary: z.string().min(1),
    full_text_url: z.string().min(1),
  })
  .strict();

const reportBase = {
  session_id: z.string().uuid(),
  test_form_id: z.string().uuid(),
  test_form_name: z.string(),
};

// ── §11.4 ───────────────────────────────────────────────────────────────────

export const examReportNotCompletedSchema = z
  .object({
    report_state: z.literal("not_completed"),
    ...reportBase,
    session_state: z.enum([
      "created",
      "active",
      "section_break",
      "abandoned_final",
    ]),
    resumable: z.boolean(),
    review_unlocked: z.literal(false),
  })
  .strict();

// ── §11.5 ───────────────────────────────────────────────────────────────────

export const examReportScoringPendingSchema = z
  .object({
    report_state: z.literal("scoring_pending"),
    ...reportBase,
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
    estimated_ready_at: z.string().nullable(),
    review_unlocked: z.literal(false),
  })
  .strict();

// ── §8.1 ────────────────────────────────────────────────────────────────────

export const examReportScoredSchema = z
  .object({
    report_state: z.literal("scored"),
    ...reportBase,
    mode: examModeSchema,
    completed_at: z.string(),
    attempt_number_for_form: z.number().int().positive(),
    is_first_seen_form_attempt: z.boolean(),
    score: z
      .object({
        total_scaled: z.number().int().min(400).max(1600),
        rw_scaled: z.number().int().min(200).max(800),
        math_scaled: z.number().int().min(200).max(800),
        partial_display_scaled: z.null(),
        scoring_model_version: z.string(),
        score_run_id: z.string().uuid(),
        scored_at: z.string(),
      })
      .strict(),
    sections: z.array(
      z
        .object({
          section: examSectionSchema,
          section_state: z.literal("submitted"),
          scaled: z.number().int().min(200).max(800),
          scoreable: z.literal(true),
        })
        .strict(),
    ),
    disclosure: examDisclosureSchema,
    review_unlocked: z.literal(true),
  })
  .strict();

// ── §9.1 ────────────────────────────────────────────────────────────────────

/**
 * 04C §9.2 lists `timed_out` too, but its `null when scoreable` rule makes that value
 * unreachable (SCL-149): a section submitted by timeout is complete and scored. It is
 * left out so the strict parse refuses it rather than a reviewer having to notice.
 */
export const examIncompletenessReasonSchema = z.enum([
  "never_attempted",
  "module1_only",
]);

export const examReportPartialSchema = z
  .object({
    report_state: z.literal("partial_scored"),
    ...reportBase,
    mode: examModeSchema,
    abandoned_at: z.string(),
    attempt_number_for_form: z.number().int().positive(),
    is_first_seen_form_attempt: z.boolean(),
    score: z
      .object({
        total_scaled: z.null(),
        rw_scaled: z.number().int().min(200).max(800).nullable(),
        math_scaled: z.number().int().min(200).max(800).nullable(),
        partial_display_scaled: z.number().int().min(200).max(800),
        scoring_model_version: z.string(),
        score_run_id: z.string().uuid(),
        scored_at: z.string(),
      })
      .strict(),
    sections: z.array(
      z
        .object({
          section: examSectionSchema,
          section_state: examSectionStateSchema.exclude(["module2_active"]),
          scaled: z.number().int().min(200).max(800).nullable(),
          scoreable: z.boolean(),
          incompleteness_reason: examIncompletenessReasonSchema.nullable(),
        })
        .strict(),
    ),
    completed_sections: z.array(examSectionSchema),
    incomplete_sections: z.array(examSectionSchema),
    disclosure: examDisclosureSchema,
    partial_disclosure: z.object({ summary: z.string().min(1) }).strict(),
    review_unlocked: z.literal(true),
  })
  .strict();

// ── §10.2 (student projection: no `internal` block, §10.3) ────────────────────

export const examReportFailedSchema = z
  .object({
    report_state: z.literal("failed_requires_review"),
    ...reportBase,
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
    failure_summary: z
      .object({
        student_facing_message: z.string().min(1),
        incident_reference: z.string().regex(/^INC-[0-9a-f]{8}$/),
        recorded_at: z.string(),
      })
      .strict(),
    review_unlocked: z.literal(false),
  })
  .strict();

// ── §11.5b ──────────────────────────────────────────────────────────────────

export const examReportUnavailableSchema = z
  .object({
    report_state: z.literal("unavailable"),
    ...reportBase,
    unavailable_reason: z.enum([
      "entitlement_lapsed",
      "guardian_link_inactive",
      "content_takedown",
    ]),
    unavailable_at: z.string().nullable(),
    resume_action: z
      .object({
        type: z.enum([
          "renew_entitlement",
          "reactivate_guardian_link",
          "contact_support",
        ]),
        url: z.string().nullable(),
      })
      .strict()
      .nullable(),
    review_unlocked: z.literal(false),
  })
  .strict();

export const examReportPayloadSchema = z.discriminatedUnion("report_state", [
  examReportNotCompletedSchema,
  examReportScoringPendingSchema,
  examReportScoredSchema,
  examReportPartialSchema,
  examReportFailedSchema,
  examReportUnavailableSchema,
]);
export type ExamReportPayload = z.infer<typeof examReportPayloadSchema>;

/** §16.1 /report/status. */
export const examReportStatusSchema = z
  .object({
    report_state: examReportStateSchema,
    review_unlocked: z.boolean(),
    estimated_ready_at: z.string().nullable().optional(),
  })
  .strict();
export type ExamReportStatus = z.infer<typeof examReportStatusSchema>;

/** §16.8 envelope metadata. */
export const examReportMetaSchema = z
  .object({ request_id: z.string(), served_at: z.string() })
  .strict();

// ── Product-owned copy (04C §9.3, §10.4 canonical examples) ───────────────────

/** §10.4, canonical example 1. `{ref}` is replaced by the incident reference. */
export const EXAM_REPORT_FAILED_MESSAGE =
  "Your test score isn't available yet because of a technical issue on our end. Our team has been notified and is investigating. We'll email you when your score is ready. (Reference: {ref})";

export const EXAM_SECTION_LABEL = {
  RW: "Reading and Writing",
  M: "Math",
} as const satisfies Record<z.infer<typeof examSectionSchema>, string>;

// ── GET /api/tests/forms (SCL-147) ──────────────────────────────────────────

export const examFormSectionSummarySchema = z
  .object({
    section: examSectionSchema,
    questions_per_module: z.number().int().nonnegative(),
    module1_ms: z.number().int().positive(),
    module2_ms: z.number().int().positive(),
  })
  .strict();

export const examFormLatestSessionSchema = z
  .object({
    session_id: z.string().uuid(),
    state: examSessionStateSchema,
    mode: examModeSchema,
    attempt_number_for_form: z.number().int().positive(),
    report_state: examReportStateSchema,
  })
  .strict();

export const examFormSummarySchema = z
  .object({
    test_form_id: z.string().uuid(),
    name: z.string(),
    is_selectable: z.boolean(),
    question_count: z.number().int().nonnegative(),
    break_duration_ms: z.number().int().nonnegative(),
    sections: z.array(examFormSectionSummarySchema),
    latest_session: examFormLatestSessionSchema.nullable(),
  })
  .strict();

export const examFormsResponseSchema = z
  .object({ forms: z.array(examFormSummarySchema) })
  .strict();
export type ExamFormsResponse = z.infer<typeof examFormsResponseSchema>;
