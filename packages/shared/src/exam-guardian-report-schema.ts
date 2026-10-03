/**
 * Full-length exam — the guardian's view of a student's results (G1).
 *
 * @spec [Doc-04C_V1.0 §2.6 (derived access; strict subset, rule 7), §12.2 (projection
 *        function), §12.3 (guardians cannot review, resume or see failure internals),
 *        §2.3 (no Module 2 path)] [Doc 04 Parent Q9 as amended by SCL-180 (domain
 *        breakdown in; skills, pacing, answers, routing and raw scores still out)]
 *       [SCL-181 (/api/students/:studentId/tests[/:sessionId/report], 404/402, envelope)]
 * @implemented [2026-09-27]
 *
 * plain English: a guardian sees the headline of each exam — total, the two section
 * scores, when it was finished, lenient or strict, which attempt it was, whether the form
 * was new to the student, the disclosure — and, per domain, the BAR the student sees on their
 * Score breakdown tab, without the "N of M correct" counts beside it (R4, SCL-189). Nothing else.
 *
 * HOW. Every guardian state has its OWN `.strict()` schema, written out field by field
 * rather than derived by `.omit()` from the student's. A field added to the student report
 * therefore does not reach a guardian unless someone adds it here too, by name — the
 * chokepoint is this file, not a list of exclusions that has to be remembered.
 * `toGuardianExamReport` builds each guardian object from named fields (never a spread) and
 * parses it, so an extra key throws instead of shipping.
 *
 * WHAT §12.2 REMOVES, AND WHAT G1 REMOVES BEYOND IT (strict subset either way, §2.6):
 *   §12.2: sections[].incompleteness_reason, estimated_ready_at, resumable.
 *   G1 D-log: review_unlocked (guardians cannot review, §12.3 — a flag for a door they
 *   cannot open); score.score_run_id, scoring_model_version, scored_at (internal record
 *   identity; the disclosure already names the model a guardian may read about);
 *   score.partial_display_scaled and sections[] (they restate rw_scaled / math_scaled and
 *   completed_sections); failure_summary (a message addressed to the student, and an
 *   incident reference that is operational, §12.3); unavailable_at / resume_action.
 */
import { z } from "zod";
import {
  examModeSchema,
  examSectionSchema,
  examSessionStateSchema,
} from "./exam-runtime-schema";
import {
  examDisclosureSchema,
  examReportStateSchema,
  type ExamDomainBreakdownRow,
  type ExamFormsResponse,
  type ExamReportPayload,
} from "./exam-report-schema";
import { canonicalDomainSchema, sectionOfDomain } from "./calendar/scope";

/**
 * @spec [Doc 04 Parent Q9 as amended by SCL-180 and SCL-189; Guardian_Closure_Plan G3-02,
 *   owner ruling R4] | @implemented [2026-09-30]
 *
 * plain English: one guardian row per (scored section, domain) — the domain and the length of
 * its bar, as a whole percent 0–100, and nothing else. R4 keeps the bar and removes the
 * "N of M correct" counts, so `correct` and `total` are not on the guardian wire at all:
 * `.strict()` refuses either key, and the row is built from named fields by
 * `toGuardianDomainBars`, never spread from the student's row.
 *
 * edge cases: `total` is positive by the student schema, so the division is defined; the
 * percent is rounded half-up, so 0 and 100 are reachable only by 0-of-N and N-of-N.
 */
export const guardianDomainBarRowSchema = z
  .object({
    section: examSectionSchema,
    domain: canonicalDomainSchema,
    bar_pct: z.number().int().min(0).max(100),
  })
  .strict()
  .refine((r) => sectionOfDomain(r.domain) === r.section, {
    message: "domain does not belong to section",
  });
export type GuardianDomainBarRow = z.infer<typeof guardianDomainBarRowSchema>;

const guardianDomainBarsSchema = z
  .array(guardianDomainBarRowSchema)
  .refine(
    (rows) =>
      new Set(rows.map((r) => `${r.section}|${r.domain}`)).size === rows.length,
    { message: "duplicate (section, domain) row" },
  );

/** The student's rows in, the guardian's bars out: field by named field. Pure. */
export function toGuardianDomainBars(
  rows: ReadonlyArray<ExamDomainBreakdownRow>,
): GuardianDomainBarRow[] {
  return rows.map((r) => ({
    section: r.section,
    domain: r.domain,
    bar_pct: Math.round((r.correct / r.total) * 100),
  }));
}

const guardianBase = {
  session_id: z.string().uuid(),
  test_form_id: z.string().uuid(),
  test_form_name: z.string(),
};

const sectionScaled = z.number().int().min(200).max(800);

const guardianExamNotCompletedSchema = z
  .object({
    report_state: z.literal("not_completed"),
    ...guardianBase,
    session_state: z.enum([
      "created",
      "active",
      "section_break",
      "abandoned_final",
    ]),
  })
  .strict();

const guardianExamScoringPendingSchema = z
  .object({
    report_state: z.literal("scoring_pending"),
    ...guardianBase,
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
  })
  .strict();

const guardianExamScoredSchema = z
  .object({
    report_state: z.literal("scored"),
    ...guardianBase,
    mode: examModeSchema,
    completed_at: z.string(),
    attempt_number_for_form: z.number().int().positive(),
    is_first_seen_form_attempt: z.boolean(),
    score: z
      .object({
        total_scaled: z.number().int().min(400).max(1600),
        rw_scaled: sectionScaled,
        math_scaled: sectionScaled,
      })
      .strict(),
    domain_breakdown: guardianDomainBarsSchema,
    disclosure: examDisclosureSchema,
  })
  .strict();

/** No total, by schema: a partial attempt never shows one (04C §9, invariant #2). */
const guardianExamPartialSchema = z
  .object({
    report_state: z.literal("partial_scored"),
    ...guardianBase,
    mode: examModeSchema,
    abandoned_at: z.string(),
    attempt_number_for_form: z.number().int().positive(),
    is_first_seen_form_attempt: z.boolean(),
    score: z
      .object({
        rw_scaled: sectionScaled.nullable(),
        math_scaled: sectionScaled.nullable(),
      })
      .strict(),
    completed_sections: z.array(examSectionSchema),
    incomplete_sections: z.array(examSectionSchema),
    domain_breakdown: guardianDomainBarsSchema,
    disclosure: examDisclosureSchema,
    partial_disclosure: z.object({ summary: z.string().min(1) }).strict(),
  })
  .strict();

const guardianExamFailedSchema = z
  .object({
    report_state: z.literal("failed_requires_review"),
    ...guardianBase,
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
  })
  .strict();

/**
 * Reachable only if the entitlement lapses between the route's 402 gate and the read;
 * the gate answers every request that arrives after the lapse.
 */
const guardianExamUnavailableSchema = z
  .object({
    report_state: z.literal("unavailable"),
    ...guardianBase,
    unavailable_reason: z.enum([
      "entitlement_lapsed",
      "guardian_link_inactive",
      "content_takedown",
    ]),
  })
  .strict();

export const guardianExamReportSchema = z.discriminatedUnion("report_state", [
  guardianExamNotCompletedSchema,
  guardianExamScoringPendingSchema,
  guardianExamScoredSchema,
  guardianExamPartialSchema,
  guardianExamFailedSchema,
  guardianExamUnavailableSchema,
]);
export type GuardianExamReport = z.infer<typeof guardianExamReportSchema>;

/**
 * @spec [Doc-04C §12.2] | @implemented [2026-09-27]
 * plain English: the student's payload in, the guardian's out, field by named field.
 * Pure. Parsed on the way out so a mistake here throws rather than leaks.
 */
export function toGuardianExamReport(
  report: ExamReportPayload,
): GuardianExamReport {
  const base = {
    session_id: report.session_id,
    test_form_id: report.test_form_id,
    test_form_name: report.test_form_name,
  };
  switch (report.report_state) {
    case "not_completed":
      return guardianExamNotCompletedSchema.parse({
        report_state: report.report_state,
        ...base,
        session_state: report.session_state,
      });
    case "scoring_pending":
      return guardianExamScoringPendingSchema.parse({
        report_state: report.report_state,
        ...base,
        completed_at: report.completed_at,
        abandoned_at: report.abandoned_at,
      });
    case "scored":
      return guardianExamScoredSchema.parse({
        report_state: report.report_state,
        ...base,
        mode: report.mode,
        completed_at: report.completed_at,
        attempt_number_for_form: report.attempt_number_for_form,
        is_first_seen_form_attempt: report.is_first_seen_form_attempt,
        score: {
          total_scaled: report.score.total_scaled,
          rw_scaled: report.score.rw_scaled,
          math_scaled: report.score.math_scaled,
        },
        domain_breakdown: toGuardianDomainBars(report.domain_breakdown),
        disclosure: report.disclosure,
      });
    case "partial_scored":
      return guardianExamPartialSchema.parse({
        report_state: report.report_state,
        ...base,
        mode: report.mode,
        abandoned_at: report.abandoned_at,
        attempt_number_for_form: report.attempt_number_for_form,
        is_first_seen_form_attempt: report.is_first_seen_form_attempt,
        score: {
          rw_scaled: report.score.rw_scaled,
          math_scaled: report.score.math_scaled,
        },
        completed_sections: report.completed_sections,
        incomplete_sections: report.incomplete_sections,
        domain_breakdown: toGuardianDomainBars(report.domain_breakdown),
        disclosure: report.disclosure,
        partial_disclosure: report.partial_disclosure,
      });
    case "failed_requires_review":
      return guardianExamFailedSchema.parse({
        report_state: report.report_state,
        ...base,
        completed_at: report.completed_at,
        abandoned_at: report.abandoned_at,
      });
    case "unavailable":
      return guardianExamUnavailableSchema.parse({
        report_state: report.report_state,
        ...base,
        unavailable_reason: report.unavailable_reason,
      });
  }
}

// ── GET /api/students/:studentId/tests (SCL-181) ──────────────────────────────

/**
 * The student's latest attempt on each form, as 04A's forms listing already derives it
 * (`exam_list_forms`) — no second listing query. Forms never sat are left out: a guardian
 * has nothing to read there and no way to start one.
 *
 * Every field here is one the student also sees (Doc-04C §2.6 rule 7), and NONE IS A SCORE
 * (G5-09, owner brief 2026-10-03: scores reach a guardian only through the report route,
 * `GET /api/students/:id/tests/:sessionId/report`). The list carries what is needed to choose
 * sessions and to say the student's own card word: the report and session states and the
 * instants. G5-08 added `session_state` and `abandoned_at` (SCL-199, narrowed by G5-09 to these
 * two lifecycle fields).
 */
export const guardianExamListItemSchema = z
  .object({
    session_id: z.string().uuid(),
    test_form_id: z.string().uuid(),
    test_form_name: z.string(),
    mode: examModeSchema,
    attempt_number_for_form: z.number().int().positive(),
    report_state: examReportStateSchema,
    // G5-08: `latest_session.state`, which tells "In progress" from "Not finished" on the
    // student's card for the same `not_completed` report state.
    session_state: examSessionStateSchema,
    // SCL-192: required-present, null when the attempt never completed. G5-08 (SCL-199): with
    // `abandoned_at`, when the attempt ended (a partial score is abandoned, never completed).
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
  })
  .strict();

const guardianExamListSchema = z
  .object({ tests: z.array(guardianExamListItemSchema) })
  .strict();
export type GuardianExamList = z.infer<typeof guardianExamListSchema>;

/** One latest session's instants from `exam_list_forms`, keyed by session id (SCL-192/199). */
export const guardianListSessionFactsSchema = z
  .object({
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
  })
  .strict();
export type GuardianListSessionFacts = z.infer<
  typeof guardianListSessionFactsSchema
>;

/**
 * @spec [SCL-181; SCL-192; SCL-199 (narrowed, G5-09); Guardian_Closure_Plan G5-08, G5-09]
 *       | @implemented [2026-09-27; scores removed 2026-10-03]
 * plain English: the forms listing in, the guardian's list out — one row per form the
 * student has sat, its latest attempt. Timings, question counts and selectability are
 * the student's controls and are not carried, and no score is (G5-09: the report route is the
 * one score path). Pure; parsed on the way out. Each item takes its session's instants from
 * `sessions` (keyed by session id).
 */
export function toGuardianExamList(
  forms: ExamFormsResponse,
  sessions: Readonly<Record<string, GuardianListSessionFacts>>,
): GuardianExamList {
  const tests = forms.forms.flatMap((f) => {
    const l = f.latest_session;
    if (l === null) return [];
    const facts = sessions[l.session_id];
    return [
      {
        session_id: l.session_id,
        test_form_id: f.test_form_id,
        test_form_name: f.name,
        mode: l.mode,
        attempt_number_for_form: l.attempt_number_for_form,
        report_state: l.report_state,
        session_state: l.state,
        completed_at: facts?.completed_at ?? null,
        abandoned_at: facts?.abandoned_at ?? null,
      },
    ];
  });
  return guardianExamListSchema.parse({ tests });
}

// ── The /api/students envelope, parsed whole (`ok` and `requestId` are transport) ──

export const guardianExamListEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    tests: z.array(guardianExamListItemSchema),
    requestId: z.string().optional(),
  })
  .strict();

export const guardianExamReportEnvelopeSchema = z
  .object({
    ok: z.literal(true),
    report: guardianExamReportSchema,
    requestId: z.string().optional(),
  })
  .strict();
