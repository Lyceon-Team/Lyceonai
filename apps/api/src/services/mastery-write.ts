/**
 * @spec [Doc-05A_V1.0, §4.1] | @implemented [2026-06-27]
 * Thin bridge to the canonical DB mastery RPC; formula is DB-owned.
 * All runtime mastery-affecting flows must call applyMasteryEvent().
 */
import { getSupabaseAdmin } from "../lib/supabase-admin";

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
    return { ok: false, error: "Missing student id for mastery update" };
  if (!section)
    return { ok: false, error: "Missing section for mastery update" };
  if (!domain) return { ok: false, error: "Missing domain for mastery update" };
  if (!skill) return { ok: false, error: "Missing skill for mastery update" };
  if (
    input.difficulty !== 1 &&
    input.difficulty !== 2 &&
    input.difficulty !== 3
  ) {
    return { ok: false, error: "Invalid difficulty bucket for mastery update" };
  }
  if (
    sourceFamily !== "practice" &&
    sourceFamily !== "review" &&
    sourceFamily !== "test"
  ) {
    return { ok: false, error: "Invalid source family for mastery update" };
  }
  if (!eventSourceKind) {
    return { ok: false, error: "Missing event source kind for mastery update" };
  }
  if (!eventId)
    return { ok: false, error: "Missing event id for mastery update" };
  if (!questionId)
    return { ok: false, error: "Missing question id for mastery update" };

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
    return { ok: false, error: error.message };
  }

  if (data && typeof data === "object") {
    const payload = data as Record<string, unknown>;
    const ok = typeof payload.ok === "boolean" ? payload.ok : true;
    const rpcError =
      typeof payload.error === "string" ? payload.error : undefined;
    return { ok, error: rpcError };
  }

  return { ok: true };
}
