import { supabaseServer } from "../lib/supabase-server";

// COMPATIBILITY-ONLY: This helper is not used by mounted product-read routes.
// Keep quarantined for legacy tooling until explicitly removed.

export interface MasterySkillRow {
  section: string | null;
  domain: string | null;
  skill: string | null;
  mastery_score: number | null;
  event_count_total: number | null;
  computed_at: string | null;
}

export interface DerivedWeaknessSignal {
  competencyKey: string;
  aliases: string[];
  section: string | null;
  domain: string | null;
  skill: string;
  attempts: number;
  correct: number;
  incorrect: number;
  skipped: number;
  masteryScore100: number;
  weaknessScore: number;
  updatedAt: string | null;
}

function normalizeToken(value: string | null | undefined): string {
  if (!value) return "";
  return value.trim().toLowerCase().replace(/\s+/g, "_");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildDerivedWeaknessSignal(row: MasterySkillRow): DerivedWeaknessSignal | null {
  const skillRaw = row.skill?.trim();
  if (!skillRaw) return null;

  const score = clamp(row.mastery_score ?? 0, 0, 1);
  const attempts = Math.max(0, row.event_count_total ?? 0);
  const correct = Math.round(score * attempts);
  const incorrect = Math.max(0, attempts - correct);
  const masteryScore100 = Math.round(score * 100);
  const weaknessScore = Math.round((100 - masteryScore100) * 100) / 100;

  const domainNorm = normalizeToken(row.domain);
  const skillNorm = normalizeToken(skillRaw);
  const competencyKey = domainNorm ? `${domainNorm}.${skillNorm}` : skillNorm;

  return {
    competencyKey,
    aliases: unique([
      competencyKey,
      skillNorm,
      domainNorm ? `${domainNorm}.${skillRaw}` : "",
      skillRaw,
      row.domain || "",
    ]),
    section: row.section || null,
    domain: row.domain || null,
    skill: skillRaw,
    attempts,
    correct,
    incorrect,
    skipped: 0,
    masteryScore100,
    weaknessScore,
    updatedAt: row.computed_at || null,
  };
}

export async function getDerivedWeaknessSignals(
  userId: string,
  options?: { section?: string; minAttempts?: number; limit?: number; failOnError?: boolean }
): Promise<DerivedWeaknessSignal[]> {
  const section = options?.section;
  const minAttempts = Math.max(0, options?.minAttempts ?? 1);
  const limit = Math.max(1, options?.limit ?? 20);

  let query = supabaseServer
    .from("student_skill_mastery")
    .select("section, domain, skill, mastery_score, event_count_total, computed_at")
    .eq("student_id", userId)
    .gte("event_count_total", minAttempts);

  if (section) {
    query = query.eq("section", section);
  }

  const { data, error } = await query;
  if (error || !data) {
    if (options?.failOnError) {
      throw new Error(`derived_weakness_query_failed: ${error?.message || "empty_data"}`);
    }
    return [];
  }

  return (data as MasterySkillRow[])
    .map(buildDerivedWeaknessSignal)
    .filter((s): s is DerivedWeaknessSignal => !!s)
    .sort((a, b) => {
      if (b.weaknessScore !== a.weaknessScore) return b.weaknessScore - a.weaknessScore;
      if (b.attempts !== a.attempts) return b.attempts - a.attempts;
      return a.competencyKey.localeCompare(b.competencyKey);
    })
    .slice(0, limit);
}

export function buildCompetencyMapFromMasteryRows(
  rows: MasterySkillRow[]
): Record<string, { correct: number; incorrect: number; total: number }> {
  const out: Record<string, { correct: number; incorrect: number; total: number }> = {};

  for (const row of rows) {
    const signal = buildDerivedWeaknessSignal(row);
    if (!signal) continue;
    out[signal.competencyKey] = {
      correct: signal.correct,
      incorrect: signal.incorrect,
      total: signal.attempts,
    };
  }

  return out;
}
