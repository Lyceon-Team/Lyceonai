export type StudentQuestionType = "multiple_choice";

type Option = { key: "A" | "B" | "C" | "D"; text: string };

function normalizeOptions(options: unknown): Option[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt: any) => ({ key: opt?.key, text: opt?.text }))
    .filter((opt): opt is Option => {
      return ["A", "B", "C", "D"].includes(opt.key) && typeof opt.text === "string";
    });
}

export function mapDbQuestionToStudentQuestion(q: any) {
  return {
    id: q.id,
    canonical_id: q.canonical_id,
    section: q.section,
    section_code: q.section_code,
    question_type: "multiple_choice" as const,
    stem: q.stem,
    options: normalizeOptions(q.options),
    difficulty: q.difficulty ?? null,
    domain: q.domain ?? null,
    skill: q.skill ?? null,
    subskill: q.subskill ?? null,
    skill_code: q.skill_code ?? null,
    tags: q.tags ?? null,
    competencies: q.competencies ?? null,
    explanation: null,
  };
}
