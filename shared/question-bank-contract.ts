import { randomBytes } from "crypto";

export const CANONICAL_ID_PATTERN = /^SAT(?:M|RW)[12][A-Z0-9]{6}$/;
export const MC_OPTION_KEYS = ["A", "B", "C", "D"] as const;
export const QUESTION_LIFECYCLE = ["draft", "qa", "published"] as const;
export const LEGACY_QUESTION_LIFECYCLE = ["reviewed"] as const;

export type CanonicalOptionKey = (typeof MC_OPTION_KEYS)[number];
export type CanonicalSectionCode = "M" | "RW";
export type CanonicalSourceType = 1 | 2;
export type QuestionLifecycle = (typeof QUESTION_LIFECYCLE)[number];

export interface CanonicalMcOption {
  key: CanonicalOptionKey;
  text: string;
}

export interface CanonicalQuestionRowLike {
  id: string;
  canonical_id?: string | null;
  section?: string | null;
  section_code?: string | null;
  question_type?: string | null;
  options?: unknown;
  correct_answer?: string | null;
  answer_choice?: string | null;
  answer?: string | null;
  explanation?: string | null;
  status?: string | null;
  stem?: string | null;
  difficulty?: unknown;
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  skill_code?: string | null;
  tags?: unknown;
  competencies?: unknown;
  source_type?: unknown;
  option_metadata?: unknown;
  answer_text?: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isValidCanonicalId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (CANONICAL_ID_PATTERN.test(normalized)) return true;
  return /^[A-Za-z0-9._:-]{6,128}$/.test(normalized);
}

export function normalizeSectionCode(value: unknown): CanonicalSectionCode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if (normalized === "M" || normalized === "MATH") return "M";
  if (normalized === "RW" || normalized === "R" || normalized === "W") return "RW";
  if (normalized === "READING" || normalized === "WRITING" || normalized === "READING_WRITING") return "RW";
  return null;
}

export function resolveSectionFilterValues(input: unknown): string[] | null {
  if (typeof input !== "string") return null;
  const normalized = input.trim().toLowerCase();
  if (normalized === "math" || normalized === "m") return ["M", "MATH"];
  if (
    normalized === "rw" ||
    normalized === "reading_writing" ||
    normalized === "reading-writing" ||
    normalized === "reading" ||
    normalized === "writing"
  ) {
    return ["RW"];
  }
  return null;
}

export function normalizeLifecycleStatus(value: unknown): QuestionLifecycle | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "reviewed") return "qa";
  if ((QUESTION_LIFECYCLE as readonly string[]).includes(normalized)) {
    return normalized as QuestionLifecycle;
  }
  return null;
}

export function isPublishedLifecycleStatus(value: unknown): boolean {
  return normalizeLifecycleStatus(value) === "published";
}

export function normalizeAnswerKey(value: unknown): CanonicalOptionKey | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  if ((MC_OPTION_KEYS as readonly string[]).includes(normalized)) {
    return normalized as CanonicalOptionKey;
  }
  return null;
}

export function parseCanonicalMcOptions(raw: unknown): CanonicalMcOption[] {
  let parsed = raw;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const options: CanonicalMcOption[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const key = normalizeAnswerKey((item as Record<string, unknown>).key);
    const text = normalizeText((item as Record<string, unknown>).text);
    if (!key || !text) continue;
    options.push({ key, text });
  }

  return options;
}

export function hasCanonicalOptionSet(raw: unknown): raw is CanonicalMcOption[] {
  const options = parseCanonicalMcOptions(raw);
  if (options.length !== 4) return false;
  const keySet = new Set(options.map((o) => o.key));
  if (keySet.size !== 4) return false;
  return MC_OPTION_KEYS.every((required) => keySet.has(required));
}

export function hasSingleCanonicalCorrectAnswer(rawCorrectAnswer: unknown, rawOptions: unknown): boolean {
  const correct = normalizeAnswerKey(rawCorrectAnswer);
  if (!correct) return false;
  const options = parseCanonicalMcOptions(rawOptions);
  if (!hasCanonicalOptionSet(options)) return false;
  return options.some((opt) => opt.key === correct);
}

export function isCanonicalPublishedMcQuestion(row: CanonicalQuestionRowLike): boolean {
  if (!isPublishedLifecycleStatus(row.status)) return false;
  if (row.question_type !== "multiple_choice") return false;
  if (!isValidCanonicalId(row.canonical_id ?? null)) return false;
  if (!normalizeSectionCode(row.section_code ?? row.section ?? null)) return false;
  if (!hasCanonicalOptionSet(row.options ?? null)) return false;
  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? row.answer_choice ?? row.answer ?? null, row.options ?? null)) return false;
  if (!normalizeText(row.stem)) return false;
  return true;
}

/**
 * Runtime-safe canonical MC validation that does NOT depend on questions.status.
 * Use this for student runtime delivery where status may be unavailable/drifted.
 */
export function isCanonicalRuntimeMcQuestion(row: CanonicalQuestionRowLike): boolean {
  if (row.question_type !== "multiple_choice") return false;
  if (!isValidCanonicalId(row.canonical_id ?? null)) return false;
  if (!normalizeSectionCode(row.section_code ?? row.section ?? null)) return false;
  if (!hasCanonicalOptionSet(row.options ?? null)) return false;
  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? row.answer_choice ?? row.answer ?? null, row.options ?? null)) return false;
  if (!normalizeText(row.stem)) return false;
  return true;
}

export interface StudentSafeQuestionProjection {
  id: string;
  canonical_id: string | null;
  section: string | null;
  section_code: CanonicalSectionCode | null;
  question_type: "multiple_choice";
  stem: string;
  options: CanonicalMcOption[];
  difficulty: unknown;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  tags: unknown;
  competencies: unknown;
  correct_answer: null;
  explanation: null;
}

export function projectStudentSafeQuestion(row: CanonicalQuestionRowLike): StudentSafeQuestionProjection {
  return {
    id: String(row.id),
    canonical_id: typeof row.canonical_id === "string" ? row.canonical_id : null,
    section: typeof row.section === "string" ? row.section : null,
    section_code: normalizeSectionCode(row.section_code ?? row.section ?? null),
    question_type: "multiple_choice",
    stem: normalizeText(row.stem),
    options: parseCanonicalMcOptions(row.options ?? null),
    difficulty: row.difficulty ?? null,
    domain: typeof row.domain === "string" ? row.domain : null,
    skill: typeof row.skill === "string" ? row.skill : null,
    subskill: typeof row.subskill === "string" ? row.subskill : null,
    skill_code: typeof row.skill_code === "string" ? row.skill_code : null,
    tags: row.tags ?? null,
    competencies: row.competencies ?? null,
    correct_answer: null,
    explanation: null,
  };
}

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const CANONICAL_ID_SUFFIX_LENGTH = 6;

export function generateCanonicalIdSuffix(length: number = CANONICAL_ID_SUFFIX_LENGTH): string {
  const bytes = randomBytes(length);
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += CHARSET[bytes[i] % CHARSET.length];
  }
  return token;
}

export function buildCanonicalId(sectionCode: CanonicalSectionCode, sourceType: CanonicalSourceType, suffix?: string): string {
  const token = (suffix ?? generateCanonicalIdSuffix()).toUpperCase();
  const canonicalId = `SAT${sectionCode}${sourceType}${token}`;
  if (!isValidCanonicalId(canonicalId)) {
    throw new Error("Generated canonical ID is invalid");
  }
  return canonicalId;
}

export function normalizeSourceType(value: unknown): CanonicalSourceType | null {
  if (value === 1 || value === "1") return 1;
  if (value === 2 || value === "2") return 2;
  return null;
}

export interface PublishValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateQuestionForPublish(row: CanonicalQuestionRowLike): PublishValidationResult {
  const errors: string[] = [];
  const normalizedStatus = normalizeLifecycleStatus(row.status ?? null);
  if (!normalizedStatus || normalizedStatus === "published") {
    errors.push("Question must be in draft or qa status before publish");
  }
  if (row.question_type !== "multiple_choice") {
    errors.push("question_type must be multiple_choice");
  }
  if (!normalizeSectionCode(row.section_code ?? row.section ?? null)) {
    errors.push("section_code must normalize to M or RW");
  }
  if (!normalizeSourceType(row.source_type ?? null)) {
    errors.push("source_type must be 1 (pdf) or 2 (ai)");
  }
  if (!normalizeText(row.stem)) {
    errors.push("stem is required");
  }
  if (!hasCanonicalOptionSet(row.options ?? null)) {
    errors.push("options must be exactly 4 choices with keys A/B/C/D");
  }
  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? row.answer_choice ?? row.answer ?? null, row.options ?? null)) {
    errors.push("correct_answer must be one of A/B/C/D and match options");
  }
  return { ok: errors.length === 0, errors };
}
