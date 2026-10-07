import type {
  CanonicalMcOption,
  CanonicalQuestionRowLike,
} from "../../../../shared/question-bank-contract";

export type StudentQuestionType = "multiple_choice";

type Option = CanonicalMcOption;

function normalizeOptions(options: unknown): Option[] {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt: unknown) => {
      const row = typeof opt === "object" && opt !== null ? (opt as Record<string, unknown>) : {};
      return { key: row.key, text: row.text };
    })
    .filter((opt): opt is Option => {
      return (
        typeof opt.key === "string" &&
        ["A", "B", "C", "D"].includes(opt.key) &&
        typeof opt.text === "string"
      );
    });
}

export function mapDbQuestionToStudentQuestion(
  q: CanonicalQuestionRowLike & { competencies?: unknown },
) {
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
