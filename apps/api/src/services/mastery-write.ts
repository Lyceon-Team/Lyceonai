/**
 * @spec [Doc-05A_V1.0, §4.1] | @implemented [2026-06-27]
 * Thin bridge to the canonical DB mastery RPC; formula is DB-owned.
 * All runtime mastery-affecting flows must call applyMasteryEvent().
 */
import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  MASTERY_EMISSION_FAILURE_CODE,
  type MasteryEmissionFailureCode,
} from "../../../../packages/shared/src/mastery-emission";

export type LearningSourceFamily = "practice" | "review" | "test";

export type EventSourceKind =
  | "practice_attempt"
  | "diagnostic_attempt"
  | "review_error_attempt"
  | "full_length_answer";

export type LearningEventInput = {
  studentId: string;
  section: string;
  domain: string;
  skill: string;
  difficulty: 1 | 2 | 3;
  sourceFamily: LearningSourceFamily;
  eventSourceKind: EventSourceKind;
  correct: boolean;
  occurredAt?: string | Date | null;
  eventId: string;
  questionId: string;
  sectionState?: "submitted" | null;
};

export type LearningEventResult = {
  ok: boolean;
  /** Stable machine-readable code, present on every failure. Absent on success. */
  code?: MasteryEmissionFailureCode;
  error?: string;
};

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOccurredAt(value: unknown): string {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isFinite(time)) return value.toISOString();
    return new Date().toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export async function applyMasteryEvent(
  input: LearningEventInput,
): Promise<LearningEventResult> {
  const supabase = getSupabaseAdmin();

  const studentId = normalizeText(input.studentId);
  const section = normalizeText(input.section);
  const domain = normalizeText(input.domain);
  const skill = normalizeText(input.skill);
  const sourceFamily = normalizeText(
    input.sourceFamily,
  ) as LearningSourceFamily | null;
  const eventSourceKind = normalizeText(
    input.eventSourceKind,
  ) as EventSourceKind | null;
  const eventId = normalizeText(input.eventId);
  const questionId = normalizeText(input.questionId);

  if (!studentId)
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing student id for mastery update",
    };
  if (!section)
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing section for mastery update",
    };
  if (!domain)
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing domain for mastery update",
    };
  if (!skill)
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing skill for mastery update",
    };
  if (
    input.difficulty !== 1 &&
    input.difficulty !== 2 &&
    input.difficulty !== 3
  ) {
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Invalid difficulty bucket for mastery update",
    };
  }
  if (
    sourceFamily !== "practice" &&
    sourceFamily !== "review" &&
    sourceFamily !== "test"
  ) {
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Invalid source family for mastery update",
    };
  }
  if (!eventSourceKind) {
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing event source kind for mastery update",
    };
  }
  if (!eventId)
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing event id for mastery update",
    };
  if (!questionId)
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.INPUT_INVALID,
      error: "Missing question id for mastery update",
    };

  const { data, error } = await supabase.rpc("apply_mastery_event", {
    p_student_id: studentId,
    p_section: section,
    p_domain: domain,
    p_skill: skill,
    p_difficulty: input.difficulty,
    p_source_family: sourceFamily,
    p_event_source_kind: eventSourceKind,
    p_correct: Boolean(input.correct),
    p_occurred_at: normalizeOccurredAt(input.occurredAt),
    p_event_id: eventId,
    p_question_id: questionId,
    p_section_state: input.sectionState ?? null,
  });

  if (error) {
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.RPC_ERROR,
      error: error.message,
    };
  }

  // @spec [Doc-05A_V1.0 §4.10] | @implemented [2026-08-16]
  // plain English: apply_mastery_event RETURNS public.student_skill_mastery, so a call
  // that actually wrote mastery always yields a row for p_student_id — on the first
  // write, on the §4.3 Step 2 idempotent re-entry, and on the §4.8 unique_violation
  // re-entry alike. Success is therefore derivable from evidence and does not have to
  // be assumed from the absence of an error.
  //
  // The previous implementation inferred it: it looked for an `ok` boolean the composite
  // has never carried, defaulted to true when absent, and returned {ok:true} outright
  // when `data` was null. That reported success for a call that demonstrably wrote
  // nothing, which is the shape of failure this pipeline spent seven weeks in.
  if (!data || typeof data !== "object") {
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.NO_ROW,
      error:
        "apply_mastery_event returned no row — mastery was not written for this event",
    };
  }

  const row = data as Record<string, unknown>;
  const returnedStudentId =
    typeof row.student_id === "string" ? row.student_id : null;

  if (returnedStudentId !== studentId) {
    return {
      ok: false,
      code: MASTERY_EMISSION_FAILURE_CODE.STUDENT_MISMATCH,
      error:
        "apply_mastery_event returned a row for a different student than the one submitted",
    };
  }

  return { ok: true };
}
