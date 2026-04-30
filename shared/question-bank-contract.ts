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
  section_code?: string | null;
  test_code?: string | null;
  question_type?: string | null;
  options?: unknown;
  correct_answer?: string | null;
  explanation?: string | null;
  status?: string | null;
  stem?: string | null;
  difficulty?: unknown;
  domain?: string | null;
  skill?: string | null;
  subskill?: string | null;
  skill_code?: string | null;
  source_type?: unknown;
  tags?: unknown;
  answer_text?: string | null;
  diagram_present?: boolean | null;
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
  if (!normalizeSectionCode(row.section_code ?? null)) return false;
  if (!hasCanonicalOptionSet(row.options ?? null)) return false;
  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? null, row.options ?? null)) return false;
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
  if (!normalizeSectionCode(row.section_code ?? null)) return false;
  if (!hasCanonicalOptionSet(row.options ?? null)) return false;
  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? null, row.options ?? null)) return false;
  if (!normalizeText(row.stem)) return false;
  return true;
}

export interface StudentSafeQuestionProjection {
  id: string;
  canonical_id: string | null;
  section_code: CanonicalSectionCode | null;
  test_code: string | null;
  question_type: "multiple_choice";
  stem: string;
  options: CanonicalMcOption[];
  difficulty: string | number | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  tags: string[] | null;
  correct_answer: null;
  explanation: null;
}

export interface StudentSafeOption {
  id: string;
  text: string;
}

export function projectStudentSafeQuestion(row: CanonicalQuestionRowLike): StudentSafeQuestionProjection {
  const difficulty =
    typeof row.difficulty === "string" || typeof row.difficulty === "number"
      ? row.difficulty
      : null;
  const sectionCode = normalizeSectionCode(row.section_code ?? null);
  
  let tags: string[] | null = null;
  if (Array.isArray(row.tags)) {
    tags = row.tags.map(String);
  } else if (typeof row.tags === "string") {
    try {
      const parsed = JSON.parse(row.tags);
      if (Array.isArray(parsed)) tags = parsed.map(String);
    } catch {
      tags = null;
    }
  }

  return {
    id: String(row.id),
    canonical_id: typeof row.canonical_id === "string" ? row.canonical_id : null,
    section_code: sectionCode,
    test_code: typeof row.test_code === "string" ? row.test_code : "SAT",
    question_type: "multiple_choice",
    stem: normalizeText(row.stem),
    options: parseCanonicalMcOptions(row.options ?? null),
    difficulty,
    domain: typeof row.domain === "string" ? row.domain : null,
    skill: typeof row.skill === "string" ? row.skill : null,
    subskill: typeof row.subskill === "string" ? row.subskill : null,
    skill_code: typeof row.skill_code === "string" ? row.skill_code : null,
    tags,
    correct_answer: null,
    explanation: null,
  };
}

export type ClientInstanceResolutionAction = "allow" | "bind" | "conflict";

export interface ClientInstanceResolution {
  action: ClientInstanceResolutionAction;
  boundClientInstanceId: string | null;
  requestedClientInstanceId: string | null;
}

export function normalizeClientInstanceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function resolveClientInstanceBinding(args: {
  boundClientInstanceId: unknown;
  requestedClientInstanceId: unknown;
}): ClientInstanceResolution {
  const bound = normalizeClientInstanceId(args.boundClientInstanceId);
  const requested = normalizeClientInstanceId(args.requestedClientInstanceId);

  if (bound && (!requested || requested !== bound)) {
    if (typeof bound === "string" && bound.startsWith("server-") && requested) {
      return { action: "bind", boundClientInstanceId: bound, requestedClientInstanceId: requested };
    }
    return { action: "conflict", boundClientInstanceId: bound, requestedClientInstanceId: requested };
  }
  if (!bound && requested) {
    return { action: "bind", boundClientInstanceId: null, requestedClientInstanceId: requested };
  }
  return { action: "allow", boundClientInstanceId: bound, requestedClientInstanceId: requested };
}

function parseStoredOptionOrder(raw: unknown): CanonicalOptionKey[] | null {
  if (Array.isArray(raw)) {
    const values = raw
      .map((v) => (typeof v === "string" ? normalizeAnswerKey(v) : null))
      .filter((v) => !!v) as CanonicalOptionKey[];
    return values.length > 0 ? values : null;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const inner = trimmed.slice(1, -1).trim();
      if (!inner) return null;
      const values = inner.split(",").map((k) => normalizeAnswerKey(k.trim())).filter((k) => !!k) as CanonicalOptionKey[];
      return values.length > 0 ? values : null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      return parseStoredOptionOrder(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

function parseStoredOptionTokenMap(raw: unknown): Record<string, CanonicalOptionKey> | null {
  let value: unknown = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const out: Record<string, CanonicalOptionKey> = {};
  for (const [token, keyRaw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof token !== "string" || token.trim().length === 0) return null;
    const normalizedKey = normalizeAnswerKey(keyRaw);
    if (!normalizedKey) return null;
    out[token] = normalizedKey;
  }

  return Object.keys(out).length > 0 ? out : null;
}

export function parseStudentSafeOptionTokenMap(raw: unknown): Record<string, CanonicalOptionKey> | null {
  return parseStoredOptionTokenMap(raw);
}

export function buildStudentSafeOptionTokens(
  options: ReadonlyArray<CanonicalMcOption>,
  order?: ReadonlyArray<CanonicalOptionKey>
) {
  const optionOrder = order && order.length > 0 ? Array.from(order) : options.map((opt) => opt.key);
  const optionTokenMap: Record<string, CanonicalOptionKey> = {};
  const safeOptions: StudentSafeOption[] = [];

  for (const key of optionOrder) {
    const option = options.find((opt) => opt.key === key);
    if (!option) continue;
    let token = "opt_" + randomBytes(8).toString("hex");
    while (optionTokenMap[token]) {
      token = "opt_" + randomBytes(8).toString("hex");
    }
    optionTokenMap[token] = key;
    safeOptions.push({ id: token, text: option.text });
  }

  return { optionOrder, optionTokenMap, safeOptions };
}

export function buildStudentSafeOptionsFromStoredMap(
  options: ReadonlyArray<CanonicalMcOption>,
  optionOrderRaw: unknown,
  optionTokenMapRaw: unknown
): StudentSafeOption[] | null {
  const optionOrder = parseStoredOptionOrder(optionOrderRaw);
  const optionTokenMap = parseStoredOptionTokenMap(optionTokenMapRaw);
  if (!optionOrder || !optionTokenMap) return null;

  if (optionOrder.length !== options.length) return null;

  const optionByKey = new Map<CanonicalOptionKey, string>();
  for (const opt of options) {
    const normalized = normalizeAnswerKey(opt.key);
    if (!normalized) return null;
    optionByKey.set(normalized, opt.text);
  }

  const canonicalKeys = new Set(optionByKey.keys());
  if (canonicalKeys.size !== options.length) return null;

  const orderKeySet = new Set(optionOrder);
  if (orderKeySet.size !== optionOrder.length) return null;
  if (!Array.from(orderKeySet).every((key) => canonicalKeys.has(key))) return null;

  const entries = Object.entries(optionTokenMap);
  if (entries.length !== options.length) return null;

  const tokenSet = new Set<string>();
  const mappedKeySet = new Set<CanonicalOptionKey>();
  const tokenByKey = new Map<CanonicalOptionKey, string>();

  for (const [token, key] of entries) {
    if (!token || !key) return null;
    if (tokenSet.has(token)) return null;
    tokenSet.add(token);

    if (!canonicalKeys.has(key)) return null;
    if (mappedKeySet.has(key)) return null;
    mappedKeySet.add(key);
    tokenByKey.set(key, token);
  }

  const safeOptions: StudentSafeOption[] = [];
  for (const key of optionOrder) {
    const token = tokenByKey.get(key);
    const textValue = optionByKey.get(key);
    if (!token || !textValue) return null;
    safeOptions.push({ id: token, text: textValue });
  }

  return safeOptions;
}

const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
export const CANONICAL_ID_SUFFIX_LENGTH = 6;

export function generateCanonicalIdSuffix(length: number = CANONICAL_ID_SUFFIX_LENGTH): string {
  const charsetLength = CHARSET.length;
  if (charsetLength <= 0) {
    throw new Error("CHARSET must not be empty");
  }
  const maxUnbiased = Math.floor(256 / charsetLength) * charsetLength;

  let token = "";
  while (token.length < length) {
    const bytes = randomBytes(length);
    for (let i = 0; i < bytes.length && token.length < length; i += 1) {
      const byte = bytes[i];
      if (byte >= maxUnbiased) {
        continue;
      }
      const index = byte % charsetLength;
      token += CHARSET[index];
    }
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
  if (!normalizeSectionCode(row.section_code ?? null)) {
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
  if (!hasSingleCanonicalCorrectAnswer(row.correct_answer ?? null, row.options ?? null)) {
    errors.push("correct_answer must be one of A/B/C/D and match options");
  }
  return { ok: errors.length === 0, errors };
}
