/**
 * Full-length exam score report (Doc 04C) — derivation and per-state serializers.
 *
 * @spec [Doc-04C_V1.0, §5.3 (derivation, pure), §5.5 (no state cache), §7.1, §8-§11
 *        (payloads), §11.3 (one serializer per state), §11.7 (redaction), §15.1
 *        (disclosure is payload data), §16.5-§16.7 (precondition chain, 403 anti-
 *        enumeration, report_data_integrity_violation)]
 *       [E7a decision log D6 (failure ledger stand-in), D7 (pure read)]
 * @implemented [2026-09-25]
 *
 * plain English: one SQL read (exam_report_source) supplies every input; a pure
 * function derives the report state from them; exactly one serializer per state
 * builds the payload, and each output is parsed against its `.strict()` schema so an
 * extra field throws instead of shipping. Nothing is cached across requests.
 *
 * trade-offs / edge cases:
 *  - 04D's failure ledger does not exist. The "open failure entry" of §5.3 is the
 *    session's exam_runtime_outbox row in its dead-letter state (D6).
 *  - `incompleteness_reason` is null for every scoreable section (SCL-149: §9.2's
 *    `timed_out` bullet contradicts its own `null when scoreable` bullet).
 *  - A scored/partial report with no disclosure row is a 500
 *    report_data_integrity_violation (§16.7): a score must never ship without it.
 */
import { z } from "zod";
import {
  EXAM_REPORT_FAILED_MESSAGE,
  EXAM_SECTION_LABEL,
  examDisclosureSchema,
  examReportFailedSchema,
  examReportNotCompletedSchema,
  examReportPartialSchema,
  examReportScoredSchema,
  examReportScoringPendingSchema,
  examReportUnavailableSchema,
  deriveReportState,
  type ExamReportPayload,
  type ExamReportState,
} from "../../packages/shared/src/exam-report-schema";
import {
  examModeSchema,
  examSectionSchema,
  examSectionStateSchema,
  examSessionStateSchema,
} from "../../packages/shared/src/exam-runtime-schema";
import { callExamRpc } from "./exam-runtime-service";

// ── The source row (server-side only) ───────────────────────────────────────

const reportSourceSchema = z.object({
  session: z.object({
    session_id: z.string().uuid(),
    test_form_id: z.string().uuid(),
    test_form_name: z.string(),
    state: examSessionStateSchema,
    mode: examModeSchema,
    grace_expires_at: z.string(),
    completed_at: z.string().nullable(),
    abandoned_at: z.string().nullable(),
    attempt_number_for_form: z.number().int().positive(),
    is_first_seen_form_attempt: z.boolean(),
  }),
  server_now: z.string(),
  sections: z.array(
    z.object({
      section: examSectionSchema,
      state: examSectionStateSchema,
      module2_submitted_by: z.enum(["student", "timeout"]).nullable(),
    }),
  ),
  score_run: z
    .object({
      score_run_id: z.string().uuid(),
      rw_scored: z.boolean(),
      math_scored: z.boolean(),
      rw_scaled: z.number().int().nullable(),
      math_scaled: z.number().int().nullable(),
      total_scaled: z.number().int().nullable(),
      partial_display_scaled: z.number().int().nullable(),
      scoring_model_version: z.string(),
      scored_at: z.string(),
    })
    .nullable(),
  failure: z
    .object({ outbox_id: z.string().uuid(), recorded_at: z.string() })
    .nullable(),
  disclosure: examDisclosureSchema.nullable(),
});
export type ExamReportSource = z.infer<typeof reportSourceSchema>;

export function reportStateOf(
  source: ExamReportSource,
  accessGranted: boolean,
): ExamReportState {
  return deriveReportState({
    sessionState: source.session.state,
    scoreTotalPresent: source.score_run?.total_scaled != null,
    scorePartialPresent: source.score_run?.partial_display_scaled != null,
    failurePresent: source.failure !== null,
    accessGranted,
  });
}

// ── §11.3 — one serializer per state ────────────────────────────────────────

export class ReportIntegrityError extends Error {}

function base(source: ExamReportSource) {
  return {
    session_id: source.session.session_id,
    test_form_id: source.session.test_form_id,
    test_form_name: source.session.test_form_name,
  };
}

function disclosureOrThrow(source: ExamReportSource) {
  if (source.disclosure === null) {
    throw new ReportIntegrityError(
      "no score_disclosure_versions row for the score run's scoring_model_version",
    );
  }
  return source.disclosure;
}

function serializeNotCompleted(source: ExamReportSource): ExamReportPayload {
  const state = source.session.state;
  const resumable =
    (state === "created" || state === "active" || state === "section_break") &&
    Date.parse(source.server_now) < Date.parse(source.session.grace_expires_at);
  return examReportNotCompletedSchema.parse({
    report_state: "not_completed",
    ...base(source),
    session_state: state,
    resumable,
    review_unlocked: false,
  });
}

function serializeScoringPending(source: ExamReportSource): ExamReportPayload {
  return examReportScoringPendingSchema.parse({
    report_state: "scoring_pending",
    ...base(source),
    completed_at: source.session.completed_at,
    abandoned_at: source.session.abandoned_at,
    estimated_ready_at: null, // 04D's publish-lag SLI does not exist (§11.5)
    review_unlocked: false,
  });
}

function serializeScored(source: ExamReportSource): ExamReportPayload {
  const run = source.score_run;
  if (run === null)
    throw new ReportIntegrityError("scored without a score run");
  return examReportScoredSchema.parse({
    report_state: "scored",
    ...base(source),
    mode: source.session.mode,
    completed_at: source.session.completed_at,
    attempt_number_for_form: source.session.attempt_number_for_form,
    is_first_seen_form_attempt: source.session.is_first_seen_form_attempt,
    score: {
      total_scaled: run.total_scaled,
      rw_scaled: run.rw_scaled,
      math_scaled: run.math_scaled,
      partial_display_scaled: null,
      scoring_model_version: run.scoring_model_version,
      score_run_id: run.score_run_id,
      scored_at: run.scored_at,
    },
    sections: [
      {
        section: "RW",
        section_state: "submitted",
        scaled: run.rw_scaled,
        scoreable: true,
      },
      {
        section: "M",
        section_state: "submitted",
        scaled: run.math_scaled,
        scoreable: true,
      },
    ],
    disclosure: disclosureOrThrow(source),
    review_unlocked: true,
  });
}

/** §9.2; null for every scoreable section (SCL-149). */
function incompletenessReason(
  state: z.infer<typeof examSectionStateSchema>,
): z.infer<
  typeof examReportPartialSchema
>["sections"][number]["incompleteness_reason"] {
  if (state === "submitted") return null;
  if (state === "module1_submitted") return "module1_only";
  return "never_attempted";
}

function partialSummary(
  scored: ReadonlyArray<"RW" | "M">,
  unscored: ReadonlyArray<"RW" | "M">,
  scaledOf: (s: "RW" | "M") => number | null,
): string {
  // §9.3 canonical example shape; no total framing (invariant #2).
  if (scored.length === 1 && unscored.length === 1) {
    const done = scored[0]!;
    const missing = unscored[0]!;
    return `${EXAM_SECTION_LABEL[done]} section score: ${scaledOf(done)}. ${EXAM_SECTION_LABEL[missing]} was not completed, so no total score is available.`;
  }
  return "This attempt ended before both sections were completed, so no total score is available.";
}

function serializePartial(source: ExamReportSource): ExamReportPayload {
  const run = source.score_run;
  if (run === null)
    throw new ReportIntegrityError("partial without a score run");
  const scaledOf = (s: "RW" | "M"): number | null =>
    s === "RW"
      ? run.rw_scored
        ? run.rw_scaled
        : null
      : run.math_scored
        ? run.math_scaled
        : null;
  const sections = source.sections.map((sec) => {
    // module2_active cannot survive finalisation (04A §14.3); refuse rather than guess.
    if (sec.state === "module2_active") {
      throw new ReportIntegrityError(
        "partial_scored session with an active module",
      );
    }
    const scoreable = sec.state === "submitted";
    return {
      section: sec.section,
      section_state: sec.state,
      scaled: scoreable ? scaledOf(sec.section) : null,
      scoreable,
      incompleteness_reason: incompletenessReason(sec.state),
    };
  });
  const completed = sections.filter((s) => s.scoreable).map((s) => s.section);
  const incomplete = sections.filter((s) => !s.scoreable).map((s) => s.section);
  return examReportPartialSchema.parse({
    report_state: "partial_scored",
    ...base(source),
    mode: source.session.mode,
    abandoned_at: source.session.abandoned_at,
    attempt_number_for_form: source.session.attempt_number_for_form,
    is_first_seen_form_attempt: source.session.is_first_seen_form_attempt,
    score: {
      total_scaled: null,
      rw_scaled: scaledOf("RW"),
      math_scaled: scaledOf("M"),
      partial_display_scaled: run.partial_display_scaled,
      scoring_model_version: run.scoring_model_version,
      score_run_id: run.score_run_id,
      scored_at: run.scored_at,
    },
    sections,
    completed_sections: completed,
    incomplete_sections: incomplete,
    disclosure: disclosureOrThrow(source),
    partial_disclosure: {
      summary: partialSummary(completed, incomplete, scaledOf),
    },
    review_unlocked: true,
  });
}

function serializeFailed(source: ExamReportSource): ExamReportPayload {
  const failure = source.failure;
  if (failure === null)
    throw new ReportIntegrityError("failed without a failure row");
  // §10.3: INC- + the first 8 hex of the ledger (here: dead-letter outbox) id.
  const reference = `INC-${failure.outbox_id.replace(/-/g, "").slice(0, 8)}`;
  return examReportFailedSchema.parse({
    report_state: "failed_requires_review",
    ...base(source),
    completed_at: source.session.completed_at,
    abandoned_at: source.session.abandoned_at,
    failure_summary: {
      student_facing_message: EXAM_REPORT_FAILED_MESSAGE.replace(
        "{ref}",
        reference,
      ),
      incident_reference: reference,
      recorded_at: failure.recorded_at,
    },
    review_unlocked: false,
  });
}

function serializeUnavailable(source: ExamReportSource): ExamReportPayload {
  return examReportUnavailableSchema.parse({
    report_state: "unavailable",
    ...base(source),
    unavailable_reason: "entitlement_lapsed",
    unavailable_at: null, // Doc 01 does not record the lapse time here
    resume_action: null, // no canonical renewal URL is wired (§11.5b allows null)
    review_unlocked: false,
  });
}

export function serializeStudentReport(
  source: ExamReportSource,
  state: ExamReportState,
): ExamReportPayload {
  switch (state) {
    case "not_completed":
      return serializeNotCompleted(source);
    case "scoring_pending":
      return serializeScoringPending(source);
    case "scored":
      return serializeScored(source);
    case "partial_scored":
      return serializePartial(source);
    case "failed_requires_review":
      return serializeFailed(source);
    case "unavailable":
      return serializeUnavailable(source);
    case "voided":
      throw new ReportIntegrityError(
        "voided is MVP-reserved and cannot be derived",
      );
  }
}

// ── The read ────────────────────────────────────────────────────────────────

export type ExamReportRead =
  | { kind: "forbidden" }
  | { kind: "report"; state: ExamReportState; payload: ExamReportPayload };

/**
 * §16.5 steps 3-7. `entitlementActive` is decided by the caller (Doc 01); a missing
 * or foreign session is `forbidden` whatever it says (anti-enumeration first).
 */
export async function readExamReport(
  studentId: string,
  sessionId: string,
  entitlementActive: () => Promise<boolean>,
): Promise<ExamReportRead> {
  const env = await callExamRpc("exam_report_source", {
    p_student_id: studentId,
    p_session_id: sessionId,
  });
  if (env.status === 403) return { kind: "forbidden" };
  if (env.status !== 200) {
    throw new Error(`exam_report_source returned status ${env.status}`);
  }
  const source = reportSourceSchema.parse(env.body);
  const state = reportStateOf(source, await entitlementActive());
  return {
    kind: "report",
    state,
    payload: serializeStudentReport(source, state),
  };
}
