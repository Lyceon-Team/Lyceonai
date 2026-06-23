import { supabaseServer } from "../lib/supabase-server";
import type { CompetencyProgress } from "../lib/rag-types";

/**
 * @spec [Doc 05A §7.4 — student_skill_mastery service-role columns: mastery_score, event_count_total] | @implemented [2026-06-23]
 * plain English: canonical competency-map reader for the RAG service. Reads the DB-computed
 * mastery_score and event_count_total straight from student_skill_mastery — it never recomputes
 * mastery and never synthesizes per-attempt correct/incorrect counts. The RAG weak/strong
 * classifier consumes mastery_score directly (see rag-service.classifyCompetency). These numbers
 * are internal retrieval signals only — never serialized to any student/guardian surface.
 */

export interface MasterySkillRow {
  section: string | null;
  domain: string | null;
  skill: string | null;
  mastery_score: number | null;
  event_count_total: number | null;
  computed_at: string | null;
}

function normalizeToken(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * @spec [Doc 05A §7.4 — student_skill_mastery service-role columns: mastery_score, event_count_total] | @implemented [2026-06-23]
 * plain English: Build the RAG competency map from canonical student_skill_mastery rows.
 * Each entry carries the DB-computed mastery_score (0..1) and the event count — NOT
 * synthesized correct/incorrect tallies. Weak/strong classification happens downstream
 * from mastery_score; this reader only conforms the rows to the canonical signal.
 * mastery_score is service-role only and never serialized to a client (stripped at the
 * rag-v2 student boundary).
 */
export function buildCompetencyMapFromMasteryRows(
  rows: MasterySkillRow[]
): Record<string, CompetencyProgress> {
  const out: Record<string, CompetencyProgress> = {};

  for (const row of rows) {
    const skillRaw = row.skill?.trim();
    if (!skillRaw) continue;

    const masteryScore = clamp(row.mastery_score ?? 0, 0, 1);
    const total = Math.max(0, row.event_count_total ?? 0);

    const domainNorm = normalizeToken(row.domain);
    const skillNorm = normalizeToken(skillRaw);
    const competencyKey = domainNorm ? `${domainNorm}.${skillNorm}` : skillNorm;

    out[competencyKey] = { masteryScore, total };
  }

  return out;
}
