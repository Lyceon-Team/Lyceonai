/**
 * CANONICAL MASTERY WRITE CHOKE POINT
 *
 * All runtime mastery-affecting flows must call applyLearningEventToMastery().
 * This bridge only invokes the installed canonical DB writer:
 * public.apply_learning_event_to_mastery(...)
 */
import { getSupabaseAdmin } from "../lib/supabase-admin";

export type LearningSourceFamily = "practice" | "review" | "test";

export interface LearningEventInput {
  studentId: string;
  section: string;
  domain: string;
  skill: string;
  difficulty: 1 | 2 | 3;
  sourceFamily: LearningSourceFamily;
  correct: boolean;
  latencyMs?: number | null;
  occurredAt?: string | Date | null;
}

export interface LearningEventResult {
  ok: boolean;
  error?: string;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLatencyMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.trunc(value);
  return rounded >= 0 ? rounded : 0;
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

export async function applyLearningEventToMastery(input: LearningEventInput): Promise<LearningEventResult> {
  const supabase = getSupabaseAdmin();

  const studentId = normalizeText(input.studentId);
  const section = normalizeText(input.section);
  const domain = normalizeText(input.domain);
  const skill = normalizeText(input.skill);
  const sourceFamily = normalizeText(input.sourceFamily) as LearningSourceFamily | null;

  if (!studentId) return { ok: false, error: "Missing student id for mastery update" };
  if (!section) return { ok: false, error: "Missing section for mastery update" };
  if (!domain) return { ok: false, error: "Missing domain for mastery update" };
  if (!skill) return { ok: false, error: "Missing skill for mastery update" };
  if (input.difficulty !== 1 && input.difficulty !== 2 && input.difficulty !== 3) {
    return { ok: false, error: "Invalid difficulty bucket for mastery update" };
  }
  if (sourceFamily !== "practice" && sourceFamily !== "review" && sourceFamily !== "test") {
    return { ok: false, error: "Invalid source family for mastery update" };
  }

  const { data, error } = await supabase.rpc("apply_learning_event_to_mastery", {
    p_student_id: studentId,
    p_section: section,
    p_domain: domain,
    p_skill: skill,
    p_difficulty: input.difficulty,
    p_source_family: sourceFamily,
    p_correct: Boolean(input.correct),
    p_latency_ms: normalizeLatencyMs(input.latencyMs),
    p_occurred_at: normalizeOccurredAt(input.occurredAt),
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  if (data && typeof data === "object") {
    const payload = data as Record<string, unknown>;
    const ok = typeof payload.ok === "boolean" ? payload.ok : true;
    const rpcError = typeof payload.error === "string" ? payload.error : undefined;
    return { ok, error: rpcError };
  }

  return { ok: true };
}
