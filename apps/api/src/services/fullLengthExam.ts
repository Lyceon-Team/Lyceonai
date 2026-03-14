/**
 * Full-Length SAT Exam Service
 * 
 * Implements server-authoritative SAT full test runtime with:
 * - Published form lifecycle enforcement
 * - Fixed-order question serving from canonical form items
 * - Server-authoritative timing
 * - Adaptive Module 2 difficulty based on Module 1 performance
 * - Idempotent answer submission
 * - Anti-leak: no answers/explanations before module submit
 */

import crypto from "node:crypto";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { applyMasteryUpdate } from "./mastery-write";
import { MasteryEventType } from "./mastery-constants";
import { normalizeSectionCode as normalizeCanonicalSectionCode } from "../../../../shared/question-bank-contract";
import type {
  FullLengthExamSession,
  FullLengthExamModule,
  FullLengthExamQuestion,
  FullLengthExamResponse,
} from "../../../../shared/schema";
import { getModeledScaledScore, SECTION_SCORE_TABLES } from "./fullLengthScoreTables";

// ============================================================================
// CONSTANTS - Bluebook SAT Structure
// ============================================================================

/**
 * Official SAT module structure
 * RW Module 1: 32 minutes, 27 questions
 * RW Module 2: 32 minutes, 27 questions (adaptive)
 * Math Module 1: 35 minutes, 22 questions
 * Math Module 2: 35 minutes, 22 questions (adaptive)
 */
export const MODULE_CONFIG = {
  rw: {
    module1: {
      durationMs: 32 * 60 * 1000, // 32 minutes
      questionCount: 27,
    },
    module2: {
      durationMs: 32 * 60 * 1000,
      questionCount: 27,
    },
  },
  math: {
    module1: {
      durationMs: 35 * 60 * 1000, // 35 minutes
      questionCount: 22,
    },
    module2: {
      durationMs: 35 * 60 * 1000,
      questionCount: 22,
    },
  },
} as const;

/**
 * Break duration between RW and Math sections
 */
export const BREAK_DURATION_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Adaptive difficulty thresholds for Module 2
 * Based on Module 1 raw score (number correct)
 */
export const ADAPTIVE_THRESHOLDS = {
  rw: {
    // For RW Module 1 (27 questions)
    // ≥ 18 correct (66.7%) → hard
    // < 18 correct → medium
    hardThreshold: 18,
  },
  math: {
    // For Math Module 1 (22 questions)
    // ≥ 15 correct (68.2%) → hard
    // < 15 correct → medium
    hardThreshold: 15,
  },
} as const;

const ACTIVE_SESSION_STATUSES = ["not_started", "in_progress", "break"] as const;
const CLIENT_INSTANCE_CONFLICT_MESSAGE = "Session client instance conflict";
const FORM_NOT_FOUND_MESSAGE = "Test form not found";
const FORM_NOT_PUBLISHED_MESSAGE = "Test form is not published";
const FORM_ITEMS_MISSING_MESSAGE = "Test form has no items";
const FORM_STRUCTURE_INCOMPLETE_MESSAGE = "Test form is structurally incomplete";
const FORM_DUPLICATE_ORDINAL_MESSAGE = "Test form has duplicate ordinals";
const FORM_INVALID_ORDINAL_MESSAGE = "Test form has invalid ordinal sequence";
const FORM_UNKNOWN_QUESTION_MESSAGE = "Test form references unknown canonical question";
const FORM_UNPUBLISHED_QUESTION_MESSAGE = "Test form references unpublished question";
const FORM_UNSUPPORTED_QUESTION_TYPE_MESSAGE = "Test form references unsupported question type";
const FORM_SECTION_MISMATCH_MESSAGE = "Test form question section mismatch";

// ============================================================================
// TYPES
// ============================================================================

export type SectionType = "rw" | "math";
export type ModuleIndex = 1 | 2;
export type DifficultyBucket = "easy" | "medium" | "hard";
export type QuestionDifficulty = 1 | 2 | 3;
export type SessionStatus = "not_started" | "in_progress" | "completed" | "abandoned";
export type ModuleStatus = "not_started" | "in_progress" | "submitted" | "expired";

type QuestionOption = { key: string; text: string };

type TestFormItemRecord = {
  section: string;
  module_index: number;
  ordinal: number;
  question_id: string;
};

type ResolvedFormItem = {
  section: SectionType;
  moduleIndex: ModuleIndex;
  ordinal: number;
  canonicalQuestionId: string;
  questionId: string;
};

type ResolvedPublishedForm = {
  formId: string;
  itemsByModule: Map<string, ResolvedFormItem[]>;
};

export interface CreateSessionParams {
  userId: string;
  testFormId?: string;
  clientInstanceId?: string;
}

export interface GetCurrentSessionResult {
  session: FullLengthExamSession;
  currentModule: FullLengthExamModule | null;
  currentQuestion: {
    id: string;
    canonicalId: string | null;
    stem: string;
    section: string;
    question_type: "multiple_choice";
    options: QuestionOption[];
    difficulty: QuestionDifficulty | null;
    orderIndex: number;
    moduleQuestionCount: number;
    answeredCount: number;
    // User's previously submitted answer (for resume support)
    submittedAnswer?: {
      selectedAnswer?: string;
    };
  } | null;
  timeRemaining: number | null; // milliseconds remaining, null if module not started
  breakTimeRemaining: number | null; // milliseconds remaining for break, null if not on break
}

export interface SubmitAnswerParams {
  sessionId: string;
  userId: string;
  questionId: string;
  selectedAnswer?: string;
  clientInstanceId?: string;
  clientAttemptId?: string;
}

export interface SubmitModuleParams {
  sessionId: string;
  userId: string;
  clientInstanceId?: string;
}

export interface SubmitModuleResult {
  moduleId: string;
  correctCount: number;
  totalCount: number;
  nextModule: {
    section: SectionType;
    moduleIndex: ModuleIndex;
    difficultyBucket?: DifficultyBucket;
  } | null;
  isBreak: boolean;
}

export interface CompleteExamParams {
  sessionId: string;
  userId: string;
  clientInstanceId?: string;
}

export interface SectionRawScore {
  correct: number;
  total: number;
}

export interface DomainBreakdownItem {
  domain: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface SkillDiagnosticItem {
  domain: string;
  skill: string;
  correct: number;
  total: number;
  accuracy: number;
  performanceBand: "strength" | "developing" | "needs_focus";
}

export interface CompleteExamResult {
  sessionId: string;
  rawScore: {
    rw: SectionRawScore;
    math: SectionRawScore;
    total: SectionRawScore;
  };
  scaledScore: {
    rw: number;
    math: number;
    total: number;
  };
  domainBreakdown: {
    rw: DomainBreakdownItem[];
    math: DomainBreakdownItem[];
  };
  skillDiagnostics: {
    rw: SkillDiagnosticItem[];
    math: SkillDiagnosticItem[];
  };
  rwScore: {
    module1: SectionRawScore;
    module2: SectionRawScore;
    totalCorrect: number;
    totalQuestions: number;
  };
  mathScore: {
    module1: SectionRawScore;
    module2: SectionRawScore;
    totalCorrect: number;
    totalQuestions: number;
  };
  overallScore: {
    totalCorrect: number;
    totalQuestions: number;
    percentageCorrect: number;
    scaledTotal: number;
  };
  completedAt: Date;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateSeed(userId: string): string {
  return `${userId}_${Date.now()}`;
}


/**
 * Determine Module 2 difficulty based on Module 1 performance
 */
function determineModule2Difficulty(
  section: SectionType,
  module1CorrectCount: number
): DifficultyBucket {
  const threshold = ADAPTIVE_THRESHOLDS[section].hardThreshold;
  return module1CorrectCount >= threshold ? "hard" : "medium";
}

interface DiagnosticInputRow {
  section: SectionType;
  isCorrect: boolean;
  domain: string;
  skill: string;
}

interface SectionDiagnostics {
  domains: DomainBreakdownItem[];
  skills: SkillDiagnosticItem[];
}

/**
 * Deterministic modeled score table lookup.
 * Fails closed when the section total does not match canonical SAT totals.
 */
export function calculateScaledScore(rawCorrect: number, totalQuestions: number): number {
  if (!Number.isFinite(totalQuestions) || totalQuestions <= 0) {
    throw new Error("Missing modeled score table for unsupported question total");
  }

  if (totalQuestions === SECTION_SCORE_TABLES.rw.totalQuestions) {
    return getModeledScaledScore("rw", rawCorrect, totalQuestions);
  }

  if (totalQuestions === SECTION_SCORE_TABLES.math.totalQuestions) {
    return getModeledScaledScore("math", rawCorrect, totalQuestions);
  }

  throw new Error(`Missing modeled score table for totalQuestions=${totalQuestions}`);
}

function calculateSectionScaledScore(
  section: SectionType,
  rawCorrect: number,
  totalQuestions: number
): number {
  return getModeledScaledScore(section, rawCorrect, totalQuestions);
}

function normalizeClientInstanceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toSectionType(value: unknown): SectionType | null {
  if (value === "rw" || value === "math") {
    return value;
  }
  if (value === "RW") return "rw";
  if (value === "M" || value === "MATH") return "math";

  const normalized = normalizeCanonicalSectionCode(value);
  if (!normalized) {
    return null;
  }
  return normalized === "RW" ? "rw" : "math";
}

function moduleKey(section: SectionType, moduleIndex: ModuleIndex): string {
  return `${section}:${moduleIndex}`;
}

function requireModuleItems(
  itemsByModule: Map<string, ResolvedFormItem[]>,
  section: SectionType,
  moduleIndex: ModuleIndex
): ResolvedFormItem[] {
  const key = moduleKey(section, moduleIndex);
  const items = itemsByModule.get(key);
  if (!items || items.length === 0) {
    throw new Error(`${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: missing items for ${section} module ${moduleIndex}`);
  }
  return items;
}

async function resolvePublishedFormForSession(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  requestedFormId?: string
): Promise<ResolvedPublishedForm> {
  let formId = requestedFormId ?? null;

  if (formId) {
    const { data: form, error: formError } = await supabase
      .from("test_forms")
      .select("id, status, published_at, created_at")
      .eq("id", formId)
      .maybeSingle();

    if (formError) {
      throw new Error(`Failed to load test form: ${formError.message}`);
    }

    if (!form) {
      throw new Error(FORM_NOT_FOUND_MESSAGE);
    }

    if (form.status !== "published") {
      throw new Error(FORM_NOT_PUBLISHED_MESSAGE);
    }
  } else {
    const { data: latestForm, error: latestFormError } = await supabase
      .from("test_forms")
      .select("id, status, published_at, created_at")
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestFormError) {
      throw new Error(`Failed to load published test form: ${latestFormError.message}`);
    }

    if (!latestForm) {
      throw new Error(FORM_NOT_FOUND_MESSAGE);
    }

    formId = latestForm.id;
  }

  if (!formId) {
    throw new Error(FORM_NOT_FOUND_MESSAGE);
  }

  const { data: rawItems, error: itemsError } = await supabase
    .from("test_form_items")
    .select("section, module_index, ordinal, question_id")
    .eq("form_id", formId)
    .order("section", { ascending: true })
    .order("module_index", { ascending: true })
    .order("ordinal", { ascending: true });

  if (itemsError) {
    throw new Error(`Failed to load test form items: ${itemsError.message}`);
  }

  const formItems = (rawItems ?? []) as TestFormItemRecord[];
  if (!formItems.length) {
    throw new Error(FORM_ITEMS_MISSING_MESSAGE);
  }

  const seenModuleOrdinals = new Set<string>();
  const canonicalQuestionIds = new Set<string>();
  const orderedDraftItems: Array<{
    section: SectionType;
    moduleIndex: ModuleIndex;
    ordinal: number;
    canonicalQuestionId: string;
  }> = [];

  for (const item of formItems) {
    const section = toSectionType(item.section);
    if (!section) {
      throw new Error(`${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: invalid section in test_form_items`);
    }

    if (item.module_index !== 1 && item.module_index !== 2) {
      throw new Error(`${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: invalid module index in test_form_items`);
    }

    if (!Number.isInteger(item.ordinal) || item.ordinal < 1) {
      throw new Error(`${FORM_INVALID_ORDINAL_MESSAGE}: ordinals must start at 1`);
    }

    const canonicalQuestionId = String(item.question_id ?? "").trim();
    if (!canonicalQuestionId) {
      throw new Error(`${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: missing canonical question id`);
    }

    const ordinalKey = `${section}:${item.module_index}:${item.ordinal}`;
    if (seenModuleOrdinals.has(ordinalKey)) {
      throw new Error(FORM_DUPLICATE_ORDINAL_MESSAGE);
    }

    seenModuleOrdinals.add(ordinalKey);
    canonicalQuestionIds.add(canonicalQuestionId);

    orderedDraftItems.push({
      section,
      moduleIndex: item.module_index as ModuleIndex,
      ordinal: item.ordinal,
      canonicalQuestionId,
    });
  }

  const { data: questionRows, error: questionRowsError } = await supabase
    .from("questions")
    .select("id, canonical_id, status, question_type, section_code")
    .in("canonical_id", Array.from(canonicalQuestionIds));

  if (questionRowsError) {
    throw new Error(`Failed to load canonical questions for test form: ${questionRowsError.message}`);
  }

  const questionByCanonicalId = new Map<string, {
    id: string;
    canonical_id: string;
    status: string;
    question_type: string;
    section_code: string | null;
  }>();

  for (const row of (questionRows ?? [])) {
    if (typeof row.canonical_id === "string" && row.canonical_id.trim().length > 0) {
      questionByCanonicalId.set(row.canonical_id, {
        id: row.id,
        canonical_id: row.canonical_id,
        status: row.status,
        question_type: row.question_type,
        section_code: row.section_code,
      });
    }
  }

  const itemsByModule = new Map<string, ResolvedFormItem[]>();

  for (const item of orderedDraftItems) {
    const question = questionByCanonicalId.get(item.canonicalQuestionId);
    if (!question) {
      throw new Error(FORM_UNKNOWN_QUESTION_MESSAGE);
    }

    if (question.status !== "published") {
      throw new Error(FORM_UNPUBLISHED_QUESTION_MESSAGE);
    }

    if (question.question_type !== "multiple_choice") {
      throw new Error(FORM_UNSUPPORTED_QUESTION_TYPE_MESSAGE);
    }

    const questionSection = toSectionType(question.section_code);
    if (!questionSection || questionSection !== item.section) {
      throw new Error(FORM_SECTION_MISMATCH_MESSAGE);
    }

    const key = moduleKey(item.section, item.moduleIndex);
    const moduleItems = itemsByModule.get(key) ?? [];
    moduleItems.push({
      section: item.section,
      moduleIndex: item.moduleIndex,
      ordinal: item.ordinal,
      canonicalQuestionId: item.canonicalQuestionId,
      questionId: question.id,
    });
    itemsByModule.set(key, moduleItems);
  }

  for (const section of ["rw", "math"] as const) {
    for (const moduleIndex of [1, 2] as const) {
      const moduleItems = requireModuleItems(itemsByModule, section, moduleIndex);
      const expectedCount = MODULE_CONFIG[section][`module${moduleIndex}`].questionCount;

      if (moduleItems.length !== expectedCount) {
        throw new Error(`${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: ${section} module ${moduleIndex} expected ${expectedCount} items`);
      }

      moduleItems.sort((a, b) => a.ordinal - b.ordinal);

      for (let ordinal = 1; ordinal <= expectedCount; ordinal += 1) {
        if (moduleItems[ordinal - 1]?.ordinal !== ordinal) {
          throw new Error(`${FORM_INVALID_ORDINAL_MESSAGE}: ${section} module ${moduleIndex} must be contiguous 1..${expectedCount}`);
        }
      }
    }
  }

  return {
    formId,
    itemsByModule,
  };
}

function assertClientInstanceAccess(
  session: { client_instance_id?: string | null },
  clientInstanceId?: string
): void {
  const boundClient = normalizeClientInstanceId(session.client_instance_id);
  if (!boundClient) {
    return;
  }
  const requestedClient = normalizeClientInstanceId(clientInstanceId);
  if (!requestedClient || requestedClient !== boundClient) {
    throw new Error(CLIENT_INSTANCE_CONFLICT_MESSAGE);
  }
}

async function bindSessionClientInstanceIfNeeded(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  args: { sessionId: string; userId: string; clientInstanceId?: string }
): Promise<void> {
  const normalized = normalizeClientInstanceId(args.clientInstanceId);
  if (!normalized) {
    return;
  }

  await supabase
    .from("full_length_exam_sessions")
    .update({ client_instance_id: normalized })
    .eq("id", args.sessionId)
    .eq("user_id", args.userId)
    .is("client_instance_id", null);
}

type FullLengthEventType =
  | "test_started"
  | "section_started"
  | "answer_submitted"
  | "test_completed"
  | "score_computed";

async function emitFullLengthEvent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventType: FullLengthEventType,
  args: {
    sessionId: string;
    userId: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await supabase.from("system_event_logs").insert({
      event_type: eventType,
      level: "info",
      source: "full_length_exam",
      message: eventType,
      user_id: args.userId,
      session_id: args.sessionId,
      details: args.details ?? null,
    });
  } catch {
    // Best-effort observability; never break exam runtime.
  }
}

function toAccuracy(correct: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((correct / total) * 1000) / 1000;
}

function toPerformanceBand(accuracy: number): "strength" | "developing" | "needs_focus" {
  if (accuracy >= 0.8) return "strength";
  if (accuracy >= 0.5) return "developing";
  return "needs_focus";
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeSkillFromCompetencies(competencies: unknown): string | null {
  if (!Array.isArray(competencies) || competencies.length === 0) return null;
  const first = competencies[0] as { raw?: unknown; code?: unknown } | string;
  if (typeof first === "string") return normalizeLabel(first);
  return normalizeLabel(first?.raw) || normalizeLabel(first?.code) || null;
}

function extractDomainAndSkill(
  section: SectionType,
  question: Record<string, unknown> | undefined
): { domain: string; skill: string } {
  const explicitDomain = normalizeLabel(question?.domain);
  const tagsDomain = Array.isArray(question?.tags) ? normalizeLabel(question?.tags[0]) : null;

  const fallbackDomain = section === "math" ? "Math Overall" : "Reading and Writing Overall";
  const domain = explicitDomain || tagsDomain || fallbackDomain;

  const explicitSkill = normalizeLabel(question?.skill);
  const explicitSubskill = normalizeLabel(question?.subskill);
  const competencySkill = normalizeSkillFromCompetencies(question?.competencies);

  const skill = explicitSubskill || explicitSkill || competencySkill || "General";

  return { domain, skill };
}

function buildSectionDiagnostics(
  section: SectionType,
  rows: DiagnosticInputRow[],
  fallbackRaw: SectionRawScore
): SectionDiagnostics {
  const domainMap = new Map<string, { correct: number; total: number }>();
  const skillMap = new Map<string, { domain: string; skill: string; correct: number; total: number }>();

  for (const row of rows) {
    if (row.section !== section) continue;

    if (!domainMap.has(row.domain)) {
      domainMap.set(row.domain, { correct: 0, total: 0 });
    }
    const domainAgg = domainMap.get(row.domain)!;
    domainAgg.total += 1;
    if (row.isCorrect) domainAgg.correct += 1;

    const skillKey = `${row.domain}::${row.skill}`;
    if (!skillMap.has(skillKey)) {
      skillMap.set(skillKey, { domain: row.domain, skill: row.skill, correct: 0, total: 0 });
    }
    const skillAgg = skillMap.get(skillKey)!;
    skillAgg.total += 1;
    if (row.isCorrect) skillAgg.correct += 1;
  }

  const domains = Array.from(domainMap.entries())
    .map(([domain, agg]) => ({
      domain,
      correct: agg.correct,
      total: agg.total,
      accuracy: toAccuracy(agg.correct, agg.total),
    }))
    .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain));

  const skills = Array.from(skillMap.values())
    .map((agg) => {
      const accuracy = toAccuracy(agg.correct, agg.total);
      return {
        domain: agg.domain,
        skill: agg.skill,
        correct: agg.correct,
        total: agg.total,
        accuracy,
        performanceBand: toPerformanceBand(accuracy),
      };
    })
    .sort((a, b) => b.total - a.total || a.domain.localeCompare(b.domain) || a.skill.localeCompare(b.skill));

  if (domains.length > 0 && skills.length > 0) {
    return { domains, skills };
  }

  const fallbackDomain = section === "math" ? "Math Overall" : "Reading and Writing Overall";
  const fallbackAccuracy = toAccuracy(fallbackRaw.correct, fallbackRaw.total);

  return {
    domains: [
      {
        domain: fallbackDomain,
        correct: fallbackRaw.correct,
        total: fallbackRaw.total,
        accuracy: fallbackAccuracy,
      },
    ],
    skills: [
      {
        domain: fallbackDomain,
        skill: "General",
        correct: fallbackRaw.correct,
        total: fallbackRaw.total,
        accuracy: fallbackAccuracy,
        performanceBand: toPerformanceBand(fallbackAccuracy),
      },
    ],
  };
}

interface BuildCompleteExamResultInput {
  sessionId: string;
  completedAt: Date;
  rwModule1: SectionRawScore;
  rwModule2: SectionRawScore;
  mathModule1: SectionRawScore;
  mathModule2: SectionRawScore;
  diagnosticRows?: DiagnosticInputRow[];
}

function buildCompleteExamResult(input: BuildCompleteExamResultInput): CompleteExamResult {
  const rwTotalCorrect = input.rwModule1.correct + input.rwModule2.correct;
  const rwTotalQuestions = input.rwModule1.total + input.rwModule2.total;
  const mathTotalCorrect = input.mathModule1.correct + input.mathModule2.correct;
  const mathTotalQuestions = input.mathModule1.total + input.mathModule2.total;

  const totalCorrect = rwTotalCorrect + mathTotalCorrect;
  const totalQuestions = rwTotalQuestions + mathTotalQuestions;

  const rwRaw: SectionRawScore = { correct: rwTotalCorrect, total: rwTotalQuestions };
  const mathRaw: SectionRawScore = { correct: mathTotalCorrect, total: mathTotalQuestions };
  const overallRaw: SectionRawScore = { correct: totalCorrect, total: totalQuestions };

  const rwScaled = calculateSectionScaledScore("rw", rwRaw.correct, rwRaw.total);
  const mathScaled = calculateSectionScaledScore("math", mathRaw.correct, mathRaw.total);
  const scaledTotal = rwScaled + mathScaled;

  const rows = input.diagnosticRows || [];
  const rwDiagnostics = buildSectionDiagnostics("rw", rows, rwRaw);
  const mathDiagnostics = buildSectionDiagnostics("math", rows, mathRaw);

  return {
    sessionId: input.sessionId,
    rawScore: {
      rw: rwRaw,
      math: mathRaw,
      total: overallRaw,
    },
    scaledScore: {
      rw: rwScaled,
      math: mathScaled,
      total: scaledTotal,
    },
    domainBreakdown: {
      rw: rwDiagnostics.domains,
      math: mathDiagnostics.domains,
    },
    skillDiagnostics: {
      rw: rwDiagnostics.skills,
      math: mathDiagnostics.skills,
    },
    rwScore: {
      module1: input.rwModule1,
      module2: input.rwModule2,
      totalCorrect: rwRaw.correct,
      totalQuestions: rwRaw.total,
    },
    mathScore: {
      module1: input.mathModule1,
      module2: input.mathModule2,
      totalCorrect: mathRaw.correct,
      totalQuestions: mathRaw.total,
    },
    overallScore: {
      totalCorrect: overallRaw.correct,
      totalQuestions: overallRaw.total,
      percentageCorrect: overallRaw.total > 0 ? (overallRaw.correct / overallRaw.total) * 100 : 0,
      scaledTotal,
    },
    completedAt: input.completedAt,
  };
}

/**
 * Compute exam scores from modules and responses, then persist to rollups table
 */
async function computeAndPersistExamScores(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  userId: string,
  completedAt: Date
): Promise<CompleteExamResult> {
  // First compute scores from responses
  const result = await computeExamScores(supabase, sessionId, completedAt);

  // Persist to rollups table (upsert to handle race conditions)
  const { error: insertError } = await supabase
    .from("full_length_exam_score_rollups")
    .upsert(
      {
        session_id: sessionId,
        user_id: userId,
        rw_module1_correct: result.rwScore.module1.correct,
        rw_module1_total: result.rwScore.module1.total,
        rw_module2_correct: result.rwScore.module2.correct,
        rw_module2_total: result.rwScore.module2.total,
        math_module1_correct: result.mathScore.module1.correct,
        math_module1_total: result.mathScore.module1.total,
        math_module2_correct: result.mathScore.module2.correct,
        math_module2_total: result.mathScore.module2.total,
        overall_score: result.overallScore.totalCorrect,
      },
      {
        onConflict: "session_id",
      }
    );

  if (insertError) {
    throw new Error(`Failed to persist score rollup: ${insertError.message}`);
  }

  return result;
}

/**
 * Build diagnostic rows from responses and question metadata.
 */
async function computeDiagnosticRows(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  modules: Array<{ id: string; section: string }>
): Promise<DiagnosticInputRow[]> {
  try {
    const moduleSectionById = new Map<string, SectionType>();
    for (const module of modules) {
      if (module.section === "rw" || module.section === "math") {
        moduleSectionById.set(module.id, module.section);
      }
    }

    const moduleIds = Array.from(moduleSectionById.keys());
    if (moduleIds.length === 0) {
      return [];
    }

    const { data: moduleQuestions, error: moduleQuestionsError } = await supabase
      .from("full_length_exam_questions")
      .select("module_id, question_id")
      .in("module_id", moduleIds);

    if (moduleQuestionsError || !moduleQuestions || moduleQuestions.length === 0) {
      return [];
    }

    const { data: responseRows, error: responsesError } = await supabase
      .from("full_length_exam_responses")
      .select("module_id, question_id, is_correct")
      .eq("session_id", sessionId);

    if (responsesError) {
      return [];
    }

    const responseMap = new Map<string, boolean>();
    for (const response of responseRows || []) {
      const key = `${response.module_id}::${response.question_id}`;
      responseMap.set(key, Boolean(response.is_correct));
    }

    const questionIds = Array.from(new Set(moduleQuestions.map((mq) => mq.question_id).filter(Boolean)));
    const questionMap = new Map<string, Record<string, unknown>>();

    if (questionIds.length > 0) {
      const { data: questionsData, error: questionsError } = await supabase
        .from("questions")
        .select("id, domain, skill, subskill, tags, competencies")
        .in("id", questionIds);

      if (!questionsError && questionsData) {
        for (const question of questionsData as Array<Record<string, unknown>>) {
          questionMap.set(question.id as string, question);
        }
      }
    }

    return moduleQuestions.map((moduleQuestion) => {
      const section = moduleSectionById.get(moduleQuestion.module_id) || "rw";
      const question = questionMap.get(moduleQuestion.question_id);
      const diagnostic = extractDomainAndSkill(section, question);
      const responseKey = `${moduleQuestion.module_id}::${moduleQuestion.question_id}`;

      return {
        section,
        isCorrect: responseMap.get(responseKey) || false,
        domain: diagnostic.domain,
        skill: diagnostic.skill,
      };
    });
  } catch {
    return [];
  }
}
async function getModuleQuestionTotal(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  moduleId: string,
  fallbackTotal: number
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("full_length_exam_questions")
      .select("id")
      .eq("module_id", moduleId);

    if (!error && data) {
      return data.length;
    }
  } catch {
    // Fall back to answered count when question map is unavailable.
  }

  return fallbackTotal;
}

/**
 * Compute exam scores from modules and responses
 * Used for both initial completion and idempotent re-computation
 */
async function computeExamScores(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  completedAt: Date
): Promise<CompleteExamResult> {
  // Get all modules
  const { data: modules, error: modulesError } = await supabase
    .from("full_length_exam_modules")
    .select("id, section, module_index")
    .eq("session_id", sessionId)
    .order("section", { ascending: true })
    .order("module_index", { ascending: true });

  if (modulesError || !modules) {
    throw new Error("Failed to fetch modules");
  }

  // Get responses for each module
  const moduleScores: Record<string, SectionRawScore> = {};

  for (const module of modules) {
    const { data: responses, error: responsesError } = await supabase
      .from("full_length_exam_responses")
      .select("question_id, is_correct")
      .eq("module_id", module.id);

    if (responsesError) {
      throw new Error(`Failed to fetch responses for module ${module.id}`);
    }

    const correct = responses?.filter((r) => r.is_correct).length || 0;
    const fallbackTotal = responses?.length || 0;
    const total = await getModuleQuestionTotal(supabase, module.id, fallbackTotal);

    const key = `${module.section}_${module.module_index}`;
    moduleScores[key] = { correct, total };
  }

  const diagnosticRows = await computeDiagnosticRows(
    supabase,
    sessionId,
    modules as Array<{ id: string; section: string }>
  );

  const rwModule1 = moduleScores["rw_1"] || { correct: 0, total: 0 };
  const rwModule2 = moduleScores["rw_2"] || { correct: 0, total: 0 };
  const mathModule1 = moduleScores["math_1"] || { correct: 0, total: 0 };
  const mathModule2 = moduleScores["math_2"] || { correct: 0, total: 0 };

  return buildCompleteExamResult({
    sessionId,
    completedAt,
    rwModule1,
    rwModule2,
    mathModule1,
    mathModule2,
    diagnosticRows,
  });
}

/**
 * Canonical scoring/reporting path for all completed-session outputs.
 * This is the single source for raw/scaled/domain/skill result shape.
 */
async function computeCanonicalExamReport(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  sessionId: string,
  completedAt: Date
): Promise<CompleteExamResult> {
  return computeExamScores(supabase, sessionId, completedAt);
}
/**
 * Calculate time remaining for a module
 * Returns null if module hasn't started, 0 if expired, positive milliseconds if active
 */
function calculateTimeRemaining(module: FullLengthExamModule): number | null {
  if (!module.startedAt) return null;
  if (module.submittedAt) return 0;
  
  const endsAt = new Date(module.endsAt!).getTime();
  const now = Date.now();
  const remaining = endsAt - now;
  
  return Math.max(0, remaining);
}

// ============================================================================
async function applyFullLengthMasterySignals(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  sessionId: string,
  responses: Array<{ question_id: string; is_correct: boolean | null }>
): Promise<void> {
  if (!responses.length) return;

  const questionIds = Array.from(new Set(responses.map((r) => r.question_id).filter(Boolean)));
  if (!questionIds.length) return;

  try {
    const { data: questionRows, error: questionError } = await supabase
      .from("questions")
      .select("id, canonical_id, exam, section, domain, skill, subskill, skill_code, difficulty, structure_cluster_id")
      .in("id", questionIds);

    if (questionError) {
      console.warn(`[FULL-LENGTH] Failed to load question metadata for mastery updates: ${questionError.message}`);
      return;
    }

    const metadataByQuestionId = new Map((questionRows || []).map((q) => [q.id, q]));

    for (const response of responses) {
      const question = metadataByQuestionId.get(response.question_id);
      if (!question?.canonical_id) continue;

      try {
        const result = await applyMasteryUpdate({
          userId,
          questionCanonicalId: question.canonical_id,
          sessionId,
          isCorrect: !!response.is_correct,
          eventType: MasteryEventType.FULL_LENGTH_SUBMIT,
          metadata: {
            exam: question.exam || null,
            section: question.section || null,
            domain: question.domain || null,
            skill: question.skill || null,
            subskill: question.subskill || null,
            skill_code: question.skill_code || null,
            difficulty: question.difficulty || null,
            structure_cluster_id: question.structure_cluster_id || null,
          },
        });

        if (result.error) {
          console.warn(`[FULL-LENGTH] Canonical mastery update warning for ${question.canonical_id}: ${result.error}`);
        }
      } catch (masteryErr: any) {
        console.warn(`[FULL-LENGTH] Canonical mastery update failed for ${question.canonical_id}: ${masteryErr?.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`[FULL-LENGTH] Skipping canonical mastery bridge: ${err?.message || 'unknown error'}`);
  }
}
// PUBLIC API
// ============================================================================

/**
 * Create a new full-length exam session
 * Idempotent: returns existing active session if one exists for the user
 */
export async function createExamSession(params: CreateSessionParams): Promise<FullLengthExamSession> {
  const requestedClientInstanceId = normalizeClientInstanceId(params.clientInstanceId);
  const supabase = getSupabaseAdmin();

  const { data: existingSession } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .in("status", [...ACTIVE_SESSION_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingSession) {
    if (params.testFormId && existingSession.test_form_id !== params.testFormId) {
      throw new Error("Active session exists for a different test form");
    }

    assertClientInstanceAccess(existingSession, requestedClientInstanceId || undefined);
    await bindSessionClientInstanceIfNeeded(supabase, {
      sessionId: existingSession.id,
      userId: params.userId,
      clientInstanceId: requestedClientInstanceId || undefined,
    });

    if (!existingSession.client_instance_id && requestedClientInstanceId) {
      existingSession.client_instance_id = requestedClientInstanceId;
    }

    return existingSession;
  }

  const resolvedForm = await resolvePublishedFormForSession(supabase, params.testFormId);

  const seed = generateSeed(params.userId);
  const insertClientInstanceId = requestedClientInstanceId || `srv_${crypto.randomUUID()}`;

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .insert({
      user_id: params.userId,
      seed,
      status: "not_started",
      test_form_id: resolvedForm.formId,
      client_instance_id: insertClientInstanceId,
    })
    .select()
    .single();

  if (sessionError) {
    if (sessionError.code === "23505" || sessionError.message?.includes("duplicate") || sessionError.message?.includes("unique")) {
      const { data: racedSession } = await supabase
        .from("full_length_exam_sessions")
        .select("*")
        .eq("user_id", params.userId)
        .in("status", [...ACTIVE_SESSION_STATUSES])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (racedSession) {
        if (params.testFormId && racedSession.test_form_id !== params.testFormId) {
          throw new Error("Active session exists for a different test form");
        }

        assertClientInstanceAccess(racedSession, requestedClientInstanceId || undefined);
        await bindSessionClientInstanceIfNeeded(supabase, {
          sessionId: racedSession.id,
          userId: params.userId,
          clientInstanceId: requestedClientInstanceId || undefined,
        });

        if (!racedSession.client_instance_id && requestedClientInstanceId) {
          racedSession.client_instance_id = requestedClientInstanceId;
        }

        return racedSession;
      }
    }

    throw new Error(`Failed to create exam session: ${sessionError.message || "Unknown error"}`);
  }

  if (!session) {
    throw new Error("Failed to create exam session: No session returned");
  }

  const modules = [
    {
      session_id: session.id,
      section: "rw",
      module_index: 1,
      target_duration_ms: MODULE_CONFIG.rw.module1.durationMs,
      status: "not_started",
    },
    {
      session_id: session.id,
      section: "rw",
      module_index: 2,
      target_duration_ms: MODULE_CONFIG.rw.module2.durationMs,
      status: "not_started",
    },
    {
      session_id: session.id,
      section: "math",
      module_index: 1,
      target_duration_ms: MODULE_CONFIG.math.module1.durationMs,
      status: "not_started",
    },
    {
      session_id: session.id,
      section: "math",
      module_index: 2,
      target_duration_ms: MODULE_CONFIG.math.module2.durationMs,
      status: "not_started",
    },
  ];

  const { data: createdModules, error: modulesError } = await supabase
    .from("full_length_exam_modules")
    .insert(modules)
    .select("id, section, module_index");

  if (modulesError || !createdModules) {
    throw new Error(`Failed to create exam modules: ${modulesError?.message || "No modules returned"}`);
  }

  const moduleIdByKey = new Map<string, string>();
  for (const moduleRow of createdModules) {
    const section = toSectionType(moduleRow.section);
    if (!section) {
      throw new Error("Invalid module section while creating session");
    }
    if (moduleRow.module_index !== 1 && moduleRow.module_index !== 2) {
      throw new Error("Invalid module index while creating session");
    }
    moduleIdByKey.set(moduleKey(section, moduleRow.module_index as ModuleIndex), moduleRow.id);
  }

  const sessionQuestions: Array<{ module_id: string; question_id: string; order_index: number }> = [];

  for (const section of ["rw", "math"] as const) {
    for (const moduleIndex of [1, 2] as const) {
      const key = moduleKey(section, moduleIndex);
      const moduleId = moduleIdByKey.get(key);
      if (!moduleId) {
        throw new Error(`${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: module mapping missing for ${section} module ${moduleIndex}`);
      }

      const formItems = requireModuleItems(resolvedForm.itemsByModule, section, moduleIndex);
      for (const item of formItems) {
        sessionQuestions.push({
          module_id: moduleId,
          question_id: item.questionId,
          order_index: item.ordinal - 1,
        });
      }
    }
  }

  const { error: sessionQuestionsError } = await supabase
    .from("full_length_exam_questions")
    .insert(sessionQuestions);

  if (sessionQuestionsError) {
    throw new Error(`Failed to materialize form questions for session: ${sessionQuestionsError.message}`);
  }

  return session;
}
/**
 * Get the current session state with the current question
 */
export async function getCurrentSession(
  sessionId: string,
  userId: string,
  clientInstanceId?: string
): Promise<GetCurrentSessionResult> {
  const supabase = getSupabaseAdmin();

  // Get session (with user validation)
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  assertClientInstanceAccess(session, clientInstanceId);

  // If session hasn't started, return minimal state
  if (session.status === "not_started") {
    return {
      session,
      currentModule: null,
      currentQuestion: null,
      timeRemaining: null,
      breakTimeRemaining: null,
    };
  }

  // Check if on break
  if (session.current_section === "break") {
    // Break timer is server authoritative and anchored to break_started_at.
    const breakStart = new Date(session.break_started_at || session.updated_at).getTime();
    const breakEnd = breakStart + BREAK_DURATION_MS;
    const now = Date.now();
    const breakTimeRemaining = Math.max(0, breakEnd - now);

    return {
      session,
      currentModule: null,
      currentQuestion: null,
      timeRemaining: null,
      breakTimeRemaining,
    };
  }

  // Get current module
  const { data: currentModule, error: moduleError } = await supabase
    .from("full_length_exam_modules")
    .select("*")
    .eq("session_id", sessionId)
    .eq("section", session.current_section!)
    .eq("module_index", session.current_module!)
    .single();

  if (moduleError || !currentModule) {
    throw new Error("Current module not found");
  }

  // If module hasn't started, start it now
  if (currentModule.status === "not_started") {
    await startModule(sessionId, currentModule.id, userId);
    // Re-fetch the module
    const { data: refreshedModule } = await supabase
      .from("full_length_exam_modules")
      .select("*")
      .eq("id", currentModule.id)
      .single();
    
    if (refreshedModule) {
      Object.assign(currentModule, refreshedModule);
    }
  }

  // Get questions for this module (whitelist safe fields only - no answer/explanation leakage)
  const { data: moduleQuestions, error: questionsError } = await supabase
    .from("full_length_exam_questions")
    .select(`
      id,
      question_id,
      order_index,
      questions (
        id,
        canonical_id,
        stem,
        section,
        question_type,
        options,
        difficulty,
        domain,
        skill,
        subskill,
        skill_code
      )
    `)
    .eq("module_id", currentModule.id)
    .order("order_index", { ascending: true });

  if (questionsError) {
    throw new Error(`Failed to fetch module questions: ${questionsError.message}`);
  }

  // Get responses for this module (for resume support)
  const { data: responses, error: responsesError } = await supabase
    .from("full_length_exam_responses")
    .select("question_id, selected_answer")
    .eq("module_id", currentModule.id);

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

    // Build a map of question_id -> response for quick lookup
  const responseMap = new Map(
    responses?.map((r) => [r.question_id, {
      selectedAnswer: r.selected_answer,
    }]) || []
  );
  const answeredQuestionIds = new Set(responses?.map((r) => r.question_id) || []);

  // Type guard for module question with embedded question data
  interface ModuleQuestionWithData {
    id: string;
    question_id: string;
    order_index: number;
    questions: {
      id: string;
      canonical_id: string | null;
      stem: string;
      section: string;
      question_type: string;
      options: QuestionOption[] | null;
      difficulty: number | null;
    } | null;
  }

  // Find first unanswered question
  let currentQuestion = null;
  if (moduleQuestions && moduleQuestions.length > 0) {
    const typedQuestions = moduleQuestions as unknown as ModuleQuestionWithData[];
    const unanswered = typedQuestions.find((mq) => !answeredQuestionIds.has(mq.question_id));
    const target = unanswered || typedQuestions[0];

    if (target?.questions) {
      const q = target.questions;
      const submittedAnswer = responseMap.get(q.id);
      const options = Array.isArray(q.options) ? q.options : [];
      const difficulty = q.difficulty === 1 || q.difficulty === 2 || q.difficulty === 3
        ? (q.difficulty as QuestionDifficulty)
        : null;

      currentQuestion = {
        id: q.id,
        canonicalId: q.canonical_id ?? null,
        stem: q.stem,
        section: q.section,
        question_type: "multiple_choice" as const,
        options,
        difficulty,
        orderIndex: target.order_index,
        moduleQuestionCount: moduleQuestions.length,
        answeredCount: answeredQuestionIds.size,
        // Include previously submitted answer if it exists (for resume support)
        submittedAnswer: submittedAnswer
          ? {
              selectedAnswer: submittedAnswer.selectedAnswer || undefined,
            }
          : undefined,
      };
    }
  }

  // Calculate time remaining
  const timeRemaining = calculateTimeRemaining(currentModule);

  // Check if time expired
  if (timeRemaining !== null && timeRemaining === 0 && currentModule.status === "in_progress") {
    // Auto-submit module if time expired
    await submitModule({ sessionId, userId, clientInstanceId });
  }

  return {
    session,
    currentModule,
    currentQuestion,
    timeRemaining,
    breakTimeRemaining: null,
  };
}

/**
 * Start a module by validating and activating materialized fixed-order questions
 */
async function startModule(
  sessionId: string,
  moduleId: string,
  userId?: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: module, error: moduleError } = await supabase
    .from("full_length_exam_modules")
    .select("*")
    .eq("id", moduleId)
    .single();

  if (moduleError || !module) {
    throw new Error("Module not found");
  }

  if (module.status !== "not_started") {
    return;
  }

  const section = module.section as SectionType;
  const moduleIndex = module.module_index as ModuleIndex;
  const expectedQuestionCount = MODULE_CONFIG[section][`module${moduleIndex}` as "module1" | "module2"].questionCount;

  const { data: existingQuestions, error: existingQuestionsError } = await supabase
    .from("full_length_exam_questions")
    .select("id")
    .eq("module_id", moduleId)
    .order("order_index", { ascending: true });

  if (existingQuestionsError) {
    throw new Error(`Failed to load module questions: ${existingQuestionsError.message}`);
  }

  if (!existingQuestions || existingQuestions.length !== expectedQuestionCount) {
    throw new Error(
      `${FORM_STRUCTURE_INCOMPLETE_MESSAGE}: session module ${section} ${moduleIndex} expected ${expectedQuestionCount} items`
    );
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + module.target_duration_ms);

  const { error: updateError } = await supabase
    .from("full_length_exam_modules")
    .update({
      status: "in_progress",
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", moduleId)
    .eq("status", "not_started");

  if (updateError) {
    throw new Error(`Failed to start module: ${updateError.message}`);
  }

  if (userId) {
    await emitFullLengthEvent(supabase, "section_started", {
      sessionId,
      userId,
      details: {
        moduleId,
        section,
        moduleIndex,
      },
    });
  }
}
/**
 * Submit an answer to a question
 */
export async function submitAnswer(params: SubmitAnswerParams): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("id, status, current_section, current_module, client_instance_id")
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  assertClientInstanceAccess(session, params.clientInstanceId);

  if (session.status !== "in_progress") {
    throw new Error("Session is not in progress");
  }

  const { data: currentModule, error: moduleError } = await supabase
    .from("full_length_exam_modules")
    .select("*")
    .eq("session_id", params.sessionId)
    .eq("section", session.current_section!)
    .eq("module_index", session.current_module!)
    .single();

  if (moduleError || !currentModule) {
    throw new Error("Current module not found");
  }

  if (currentModule.status !== "in_progress") {
    throw new Error("Module is not in progress");
  }

  const timeRemaining = calculateTimeRemaining(currentModule);
  if (timeRemaining === 0) {
    await submitModule({
      sessionId: params.sessionId,
      userId: params.userId,
      clientInstanceId: params.clientInstanceId,
    });
    throw new Error("Module time has expired");
  }

  const { data: moduleQuestion, error: mqError } = await supabase
    .from("full_length_exam_questions")
    .select("id")
    .eq("module_id", currentModule.id)
    .eq("question_id", params.questionId)
    .single();

  if (mqError || !moduleQuestion) {
    throw new Error("Question not found in current module");
  }

  const { data: existingResponse, error: existingResponseError } = await supabase
    .from("full_length_exam_responses")
    .select("id")
    .eq("session_id", params.sessionId)
    .eq("module_id", currentModule.id)
    .eq("question_id", params.questionId)
    .maybeSingle();

  if (existingResponseError) {
    throw new Error(`Failed to check existing response: ${existingResponseError.message}`);
  }

  if (existingResponse) {
    return;
  }

  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("id, question_type, correct_answer")
    .eq("id", params.questionId)
    .single();

  if (questionError || !question) {
    throw new Error("Question not found");
  }

  if (question.question_type !== "multiple_choice") {
    throw new Error("Unsupported question type for full-length exam");
  }

  const selected = String(params.selectedAnswer ?? "").trim().toUpperCase();
  const correct = String(question.correct_answer ?? "").trim().toUpperCase();
  const isCorrect = selected.length > 0 && selected === correct;
  const storedSelectedAnswer = selected.length > 0 ? selected : null;

  const now = new Date().toISOString();

  const { error: insertError } = await supabase
    .from("full_length_exam_responses")
    .insert({
      session_id: params.sessionId,
      module_id: currentModule.id,
      question_id: params.questionId,
      selected_answer: storedSelectedAnswer,
      is_correct: isCorrect,
      answered_at: now,
      updated_at: now,
    });

  if (insertError) {
    const message = insertError.message || "";
    if (insertError.code === "23505" || message.toLowerCase().includes("duplicate")) {
      return;
    }
    throw new Error(`Failed to insert response: ${insertError.message}`);
  }

  await emitFullLengthEvent(supabase, "answer_submitted", {
    sessionId: params.sessionId,
    userId: params.userId,
    details: {
      moduleId: currentModule.id,
      questionId: params.questionId,
      clientAttemptId: params.clientAttemptId ?? null,
    },
  });
}

/**
 * Submit a module (end module, compute performance, set up next module)
 */
export async function submitModule(params: SubmitModuleParams): Promise<SubmitModuleResult> {
  const supabase = getSupabaseAdmin();

  // Validate session ownership
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  assertClientInstanceAccess(session, params.clientInstanceId);

  if (session.status !== "in_progress") {
    throw new Error("Session is not in progress");
  }

  // Get current module
  const { data: currentModule, error: moduleError } = await supabase
    .from("full_length_exam_modules")
    .select("*")
    .eq("session_id", params.sessionId)
    .eq("section", session.current_section!)
    .eq("module_index", session.current_module!)
    .single();

  if (moduleError || !currentModule) {
    throw new Error("Current module not found");
  }

  // Deterministic rule 1: Module must be started (ends_at must be set)
  if (!currentModule.ends_at) {
    throw new Error("Module must be started before submitting");
  }

  // Deterministic rule 2: Module must be in_progress to submit
  if (currentModule.status !== "in_progress") {
    // If already submitted, return cached result (idempotent)
    if (currentModule.status === "submitted") {
      // Re-compute the result to return
      const { data: responses } = await supabase
        .from("full_length_exam_responses")
        .select("question_id, is_correct")
        .eq("module_id", currentModule.id);

      const correctCount = responses?.filter((r) => r.is_correct).length || 0;
      const answeredCount = responses?.length || 0;
      const totalCount = await getModuleQuestionTotal(supabase, currentModule.id, answeredCount);

      const currentSection = session.current_section as SectionType;
      const currentModuleIndex = session.current_module as ModuleIndex;

      let nextModule: { section: SectionType; moduleIndex: ModuleIndex; difficultyBucket?: DifficultyBucket } | null = null;
      let isBreak = false;

      if (currentModuleIndex === 1) {
        // Get Module 2 difficulty that was set
        const { data: module2 } = await supabase
          .from("full_length_exam_modules")
          .select("difficulty_bucket")
          .eq("session_id", params.sessionId)
          .eq("section", currentSection)
          .eq("module_index", 2)
          .single();

        nextModule = {
          section: currentSection,
          moduleIndex: 2,
          difficultyBucket: (module2?.difficulty_bucket as DifficultyBucket) || "medium",
        };
      } else if (currentSection === "rw") {
        isBreak = true;
      } else {
        nextModule = null;
      }

      return {
        moduleId: currentModule.id,
        correctCount,
        totalCount,
        nextModule,
        isBreak,
      };
    }

    // Otherwise reject - module must be in_progress
    throw new Error("Module must be in progress to submit");
  }

  // Deterministic rule 3: Determine if submission is late (server-side time comparison)
  const now = new Date();
  const endsAt = new Date(currentModule.ends_at);
  const isLate = now > endsAt;

  // Mark module as submitted with server-side timestamp and late flag
  const { error: updateError } = await supabase
    .from("full_length_exam_modules")
    .update({
      status: "submitted",
      submitted_at: now.toISOString(),
      submitted_late: isLate,
    })
    .eq("id", currentModule.id);

  if (updateError) {
    throw new Error(`Failed to submit module: ${updateError.message}`);
  }

  // Get module responses to compute score
  const { data: responses, error: responsesError } = await supabase
    .from("full_length_exam_responses")
    .select("question_id, is_correct")
    .eq("module_id", currentModule.id);

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

  const correctCount = responses?.filter((r) => r.is_correct).length || 0;
  const answeredCount = responses?.length || 0;
  const totalCount = await getModuleQuestionTotal(supabase, currentModule.id, answeredCount);

  await applyFullLengthMasterySignals(
    supabase,
    params.userId,
    params.sessionId,
    (responses || []).map((r) => ({ question_id: r.question_id, is_correct: r.is_correct }))
  );

  // Determine next module
  const currentSection = session.current_section as SectionType;
  const currentModuleIndex = session.current_module as ModuleIndex;

  let nextModule: { section: SectionType; moduleIndex: ModuleIndex; difficultyBucket?: DifficultyBucket } | null = null;
  let isBreak = false;

  if (currentModuleIndex === 1) {
    // Moving to Module 2 of same section
    const difficulty = determineModule2Difficulty(currentSection, correctCount);

    // Update Module 2 difficulty - single-write guarantee
    // Only set difficulty_bucket if it's currently NULL to prevent overwrites
    const { data: updatedModules, error: difficultyError } = await supabase
      .from("full_length_exam_modules")
      .update({ difficulty_bucket: difficulty })
      .eq("session_id", params.sessionId)
      .eq("section", currentSection)
      .eq("module_index", 2)
      .is("difficulty_bucket", null)
      .select();

    // If no rows were updated, difficulty_bucket was already set
    // Fetch the existing value
    let finalDifficulty: DifficultyBucket = difficulty;
    if (!updatedModules || updatedModules.length === 0) {
      const { data: existingModule } = await supabase
        .from("full_length_exam_modules")
        .select("difficulty_bucket")
        .eq("session_id", params.sessionId)
        .eq("section", currentSection)
        .eq("module_index", 2)
        .single();

      if (existingModule?.difficulty_bucket) {
        finalDifficulty = existingModule.difficulty_bucket as DifficultyBucket;
      }
    }

    if (difficultyError) {
      throw new Error(`Failed to set Module 2 difficulty: ${difficultyError.message}`);
    }

    nextModule = { section: currentSection, moduleIndex: 2, difficultyBucket: finalDifficulty };

    // Update session
    await supabase
      .from("full_length_exam_sessions")
      .update({
        current_module: 2,
        break_started_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.sessionId);
  } else if (currentSection === "rw") {
    // Moving from RW Module 2 to break
    isBreak = true;

    await supabase
      .from("full_length_exam_sessions")
      .update({
        current_section: "break",
        current_module: null,
        break_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.sessionId);
  } else {
    // Completed Math Module 2 - exam is done
    nextModule = null;
  }

  return {
    moduleId: currentModule.id,
    correctCount,
    totalCount,
    nextModule,
    isBreak,
  };
}
/**
 * Start the exam (set status to in_progress, start RW Module 1)
 */
export async function startExam(sessionId: string, userId: string, clientInstanceId?: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  assertClientInstanceAccess(session, clientInstanceId);
  await bindSessionClientInstanceIfNeeded(supabase, { sessionId, userId, clientInstanceId });

  if (session.status !== "not_started") {
    throw new Error("Exam already started");
  }

  const { error: updateError } = await supabase
    .from("full_length_exam_sessions")
    .update({
      status: "in_progress",
      current_section: "rw",
      current_module: 1,
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (updateError) {
    throw new Error(`Failed to start exam: ${updateError.message}`);
  }

  await emitFullLengthEvent(supabase, "test_started", {
    sessionId,
    userId,
  });
}

/**
 * Continue from break to Math Module 1
 */
export async function continueFromBreak(sessionId: string, userId: string, clientInstanceId?: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  assertClientInstanceAccess(session, clientInstanceId);

  if (session.current_section !== "break") {
    throw new Error("Not on break");
  }

  const { error: updateError } = await supabase
    .from("full_length_exam_sessions")
    .update({
      current_section: "math",
      current_module: 1,
      break_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  if (updateError) {
    throw new Error(`Failed to continue from break: ${updateError.message}`);
  }
}

/**
 * Complete the exam (compute final scores)
 */
export async function completeExam(params: CompleteExamParams): Promise<CompleteExamResult> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  assertClientInstanceAccess(session, params.clientInstanceId);

  if (session.status === "completed") {
    return computeCanonicalExamReport(
      supabase,
      params.sessionId,
      new Date(session.completed_at || new Date().toISOString())
    );
  }

  if (session.status !== "in_progress") {
    throw new Error("Invalid exam state");
  }

  if (session.current_section !== "math") {
    throw new Error("Invalid exam state");
  }

  if (session.current_module !== 2) {
    throw new Error("Invalid exam state");
  }

  const { data: mathMod2, error: mathMod2Error } = await supabase
    .from("full_length_exam_modules")
    .select("*")
    .eq("session_id", params.sessionId)
    .eq("section", "math")
    .eq("module_index", 2)
    .single();

  if (mathMod2Error || !mathMod2) {
    throw new Error("Invalid exam state");
  }

  if (mathMod2.status !== "submitted") {
    throw new Error("Invalid exam state");
  }

  const completedAt = new Date();
  const { data: updateResult, error: updateError } = await supabase
    .from("full_length_exam_sessions")
    .update({
      status: "completed",
      completed_at: completedAt.toISOString(),
      updated_at: completedAt.toISOString(),
    })
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .neq("status", "completed")
    .select();

  if (updateError) {
    throw new Error(`Failed to complete exam: ${updateError.message}`);
  }

  if (!updateResult || updateResult.length === 0) {
    const { data: completedSession, error: refetchError } = await supabase
      .from("full_length_exam_sessions")
      .select("*")
      .eq("id", params.sessionId)
      .eq("user_id", params.userId)
      .single();

    if (refetchError || !completedSession) {
      throw new Error("Session not found after completion race");
    }

    if (completedSession.status === "completed") {
      return computeCanonicalExamReport(
        supabase,
        params.sessionId,
        new Date(completedSession.completed_at || completedAt.toISOString())
      );
    }

    throw new Error("Invalid exam state");
  }

  const result = await computeAndPersistExamScores(
    supabase,
    params.sessionId,
    params.userId,
    completedAt
  );

  await emitFullLengthEvent(supabase, "test_completed", {
    sessionId: params.sessionId,
    userId: params.userId,
    details: {
      completedAt: completedAt.toISOString(),
    },
  });

  await emitFullLengthEvent(supabase, "score_computed", {
    sessionId: params.sessionId,
    userId: params.userId,
    details: {
      scaledTotal: result.scaledScore.total,
      scaledRw: result.scaledScore.rw,
      scaledMath: result.scaledScore.math,
    },
  });

  return result;
}

// ============================================================================
export async function getExamReport(params: CompleteExamParams): Promise<CompleteExamResult> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("id, user_id, status, completed_at")
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  if (session.status !== "completed") {
    throw new Error("Results locked until completion");
  }

  const completedAt = session.completed_at ? new Date(session.completed_at) : new Date();
  return computeCanonicalExamReport(supabase, params.sessionId, completedAt);
}

export async function getExamReviewAfterCompletion(params: CompleteExamParams): Promise<GetExamReviewResult> {
  const supabase = getSupabaseAdmin();

  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("id, status")
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  if (session.status !== "completed") {
    throw new Error("Review locked until completion");
  }

  return getExamReview({
    supabase,
    sessionId: params.sessionId,
    userId: params.userId,
  });
}
// EXAM REVIEW - Safe Question Projection
// ============================================================================

/**
 * Allowlist of question fields safe to expose BEFORE session completion.
 * These fields do NOT reveal correct answers or explanations.
 * 
 * SECURITY: This is an explicit allowlist. Any field not listed here
 * will NOT be included in pre-completion review responses.
 */
export const SAFE_QUESTION_FIELDS_PRE_COMPLETION = [
  "id",
  "canonical_id",
  "stem",
  "section",
  "section_code",
  "question_type",
  "options",
  "domain",
  "skill",
  "subskill",
  "skill_code",
  "difficulty",
  "source_type",
  "diagram_present",
  "tags",
  "competencies",
] as const;

/**
 * Additional fields to include when session is completed.
 * These fields reveal correct answers and explanations.
 */
export const ANSWER_FIELDS_POST_COMPLETION = [
  "correct_answer",
  "answer_text",
  "explanation",
  "option_metadata",
] as const;

/**
 * Supabase select string for pre-completion question queries.
 * Only fetches safe fields - answer/explanation never leave the DB pre-completion.
 */
const SAFE_QUESTION_SELECT_PRE_COMPLETION = SAFE_QUESTION_FIELDS_PRE_COMPLETION.join(",");

/**
 * Supabase select string for post-completion question queries.
 * Fetches safe fields plus answer/explanation fields.
 */
const SAFE_QUESTION_SELECT_POST_COMPLETION =
  [...SAFE_QUESTION_FIELDS_PRE_COMPLETION, ...ANSWER_FIELDS_POST_COMPLETION].join(",");

type CanonicalSectionCode = "MATH" | "RW";
type CanonicalSourceType = 0 | 1 | 2 | 3;

type OptionMetadataEntry = {
  role: "correct" | "distractor";
  error_taxonomy: string | null;
};

type OptionMetadata = {
  A: OptionMetadataEntry;
  B: OptionMetadataEntry;
  C: OptionMetadataEntry;
  D: OptionMetadataEntry;
};

type QuestionRowPreCompletion = {
  id: string;
  canonical_id: string | null;
  stem: string;
  section: string;
  section_code: string | null;
  question_type: string | null;
  options: unknown;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  difficulty: number | null;
  source_type: number | null;
  diagram_present: boolean | null;
  tags: unknown;
  competencies: unknown;
};

type QuestionRowPostCompletion = QuestionRowPreCompletion & {
  correct_answer: string | null;
  answer_text: string | null;
  explanation: string | null;
  option_metadata: unknown;
};

/**
 * Safe question type for pre-completion review.
 * Contains only fields from SAFE_QUESTION_FIELDS_PRE_COMPLETION.
 */
export interface SafeQuestionPreCompletion {
  id: string;
  canonical_id: string | null;
  stem: string;
  section: string;
  section_code: CanonicalSectionCode | null;
  question_type: "multiple_choice";
  options: QuestionOption[];
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  difficulty: QuestionDifficulty | null;
  source_type: CanonicalSourceType | null;
  diagram_present: boolean | null;
  tags: unknown;
  competencies: unknown;
}

/**
 * Full question type for post-completion review.
 * Includes answer and explanation fields.
 */
export interface FullQuestionPostCompletion extends SafeQuestionPreCompletion {
  correct_answer: "A" | "B" | "C" | "D" | null;
  answer_text: string | null;
  explanation: string | null;
  option_metadata: OptionMetadata | null;
}

/**
 * Module with questions for exam review
 */
export interface ExamReviewModule {
  id: string;
  section: string;
  moduleIndex: number;
  status: string;
  difficultyBucket: string | null;
  startedAt: string | null;
  submittedAt: string | null;
}

/**
 * User response for exam review
 */
export interface ExamReviewResponse {
  questionId: string;
  moduleId: string;
  selectedAnswer: string | null;
  isCorrect: boolean | null;
  answeredAt: string | null;
}

/**
 * Result type for getExamReview
 */
export interface GetExamReviewResult {
  session: {
    id: string;
    status: string;
    currentSection: string | null;
    currentModule: number | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
  };
  modules: ExamReviewModule[];
  questions: SafeQuestionPreCompletion[] | FullQuestionPostCompletion[];
  responses: ExamReviewResponse[];
}

/**
 * Parameters for getExamReview
 */
export interface GetExamReviewParams {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  sessionId: string;
  userId?: string;
}

function normalizeReviewSectionCode(value: unknown): CanonicalSectionCode | null {
  if (value === "MATH" || value === "RW") {
    return value;
  }
  const normalized = normalizeCanonicalSectionCode(value);
  if (!normalized) {
    return null;
  }
  return normalized === "M" ? "MATH" : "RW";
}

function normalizeDifficulty(value: unknown): QuestionDifficulty | null {
  return value === 1 || value === 2 || value === 3 ? (value as QuestionDifficulty) : null;
}

function normalizeSourceType(value: unknown): CanonicalSourceType | null {
  return value === 0 || value === 1 || value === 2 || value === 3
    ? (value as CanonicalSourceType)
    : null;
}

function normalizeOptions(value: unknown): QuestionOption[] {
  return Array.isArray(value) ? (value as QuestionOption[]) : [];
}

function normalizeOptionMetadata(value: unknown): OptionMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const metadata = value as Record<string, unknown>;
  if (!("A" in metadata) || !("B" in metadata) || !("C" in metadata) || !("D" in metadata)) {
    return null;
  }

  return metadata as unknown as OptionMetadata;
}

/**
 * Apply safe projection to a question object.
 * Uses an explicit allowlist to ensure only safe fields are included.
 */
function projectSafeQuestionFields(
  question: Record<string, unknown>
): SafeQuestionPreCompletion {
  return {
    id: String(question.id),
    canonical_id: (question.canonical_id as string | null) ?? null,
    stem: String(question.stem ?? ""),
    section: String(question.section ?? ""),
    section_code: normalizeReviewSectionCode(question.section_code),
    question_type: "multiple_choice",
    options: normalizeOptions(question.options),
    domain: (question.domain as string | null) ?? null,
    skill: (question.skill as string | null) ?? null,
    subskill: (question.subskill as string | null) ?? null,
    skill_code: (question.skill_code as string | null) ?? null,
    difficulty: normalizeDifficulty(question.difficulty),
    source_type: normalizeSourceType(question.source_type),
    diagram_present: (question.diagram_present as boolean | null) ?? null,
    tags: question.tags ?? null,
    competencies: question.competencies ?? null,
  };
}

/**
 * Project full question fields including answers (for completed sessions).
 */
function projectFullQuestionFields(
  question: Record<string, unknown>
): FullQuestionPostCompletion {
  const safeFields = projectSafeQuestionFields(question);
  const normalizedAnswer = String(question.correct_answer ?? "").toUpperCase();
  const correctAnswer = normalizedAnswer === "A" || normalizedAnswer === "B" || normalizedAnswer === "C" || normalizedAnswer === "D"
    ? (normalizedAnswer as "A" | "B" | "C" | "D")
    : null;

  return {
    ...safeFields,
    correct_answer: correctAnswer,
    answer_text: (question.answer_text as string | null) ?? null,
    explanation: (question.explanation as string | null) ?? null,
    option_metadata: normalizeOptionMetadata(question.option_metadata),
  };
}

/**
 * Get exam review data with safe question field projection.
 * 
 * SECURITY GUARDRAIL:
 * - If session.status != 'completed': Returns questions with ONLY safe fields
 *   (no correct_answer, no explanation, no solution fields)
 * - If session.status == 'completed': Returns full question details including
 *   correct answers and explanations
 * 
 * @param params.supabase - Supabase client instance
 * @param params.sessionId - The session ID to retrieve review for
 * @returns Exam review data with appropriately projected question fields
 */
export async function getExamReview(
  params: GetExamReviewParams
): Promise<GetExamReviewResult> {
  const { supabase, sessionId, userId } = params;

  // Load session by ID and optionally enforce explicit user ownership.
  let sessionQuery = supabase
    .from("full_length_exam_sessions")
    .select("id, user_id, status, current_section, current_module, seed, started_at, completed_at, created_at")
    .eq("id", sessionId);

  if (userId) {
    sessionQuery = sessionQuery.eq("user_id", userId);
  }

  const { data: session, error: sessionError } = await sessionQuery.single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  // Load all modules for this session
  const { data: modules, error: modulesError } = await supabase
    .from("full_length_exam_modules")
    .select("id, section, module_index, status, difficulty_bucket, started_at, submitted_at")
    .eq("session_id", sessionId)
    .order("section", { ascending: true })
    .order("module_index", { ascending: true });

  if (modulesError) {
    throw new Error(`Failed to fetch modules: ${modulesError.message}`);
  }

  // Load all module questions with their question data
  const moduleIds = (modules || []).map((m) => m.id);
  
  // Get question IDs from module questions
  const { data: moduleQuestions, error: mqError } = await supabase
    .from("full_length_exam_questions")
    .select("question_id, module_id, order_index")
    .in("module_id", moduleIds.length > 0 ? moduleIds : ['__none__']);

  if (mqError) {
    throw new Error(`Failed to fetch module questions: ${mqError.message}`);
  }

  const questionIds = (moduleQuestions || []).map((mq) => mq.question_id);

  // Determine if session is completed (needed for query projection below)
  const isCompleted = session.status === "completed";

  // Fetch questions - use query-level projection to prevent answer/explanation
  // from ever leaving the DB pre-completion (stronger than output-only projection).
  const questionSelectFields = isCompleted
    ? SAFE_QUESTION_SELECT_POST_COMPLETION
    : SAFE_QUESTION_SELECT_PRE_COMPLETION;

  // Type the questions array based on completion status
  // The Supabase select() ensures only these fields are returned from the DB
  let questions: Record<string, unknown>[] = [];
  
  if (questionIds.length > 0) {
    const { data: questionsData, error: questionsError } = await supabase
      .from("questions")
      .select(questionSelectFields)
      .in("id", questionIds);

    if (questionsError) {
      throw new Error(`Failed to fetch questions: ${questionsError.message}`);
    }

    questions = (questionsData as unknown as Record<string, unknown>[]) || [];
    // Safe assignment: The select string above guarantees that questionsData contains
    // exactly the fields defined in Question schema matching our allowlist constants.
    // We cast to the specific type based on completion status for better type precision.
    // TypeScript doesn't know Supabase's runtime projection, so we cast through unknown.
    questions = isCompleted
      ? (questionsData ?? []) as unknown as QuestionRowPostCompletion[]
      : (questionsData ?? []) as unknown as QuestionRowPreCompletion[];
  }

  // Load user responses
  const { data: responses, error: responsesError } = await supabase
    .from("full_length_exam_responses")
    .select("question_id, module_id, selected_answer, is_correct, answered_at")
    .eq("session_id", sessionId);

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

  // Project questions based on completion status using allowlist
  const projectedQuestions = questions.map((q) =>
    isCompleted ? projectFullQuestionFields(q) : projectSafeQuestionFields(q)
  );

  // Format modules
  const formattedModules: ExamReviewModule[] = (modules || []).map((m) => ({
    id: m.id,
    section: m.section,
    moduleIndex: m.module_index,
    status: m.status,
    difficultyBucket: m.difficulty_bucket,
    startedAt: m.started_at,
    submittedAt: m.submitted_at,
  }));

  // Format responses
  const formattedResponses: ExamReviewResponse[] = (responses || []).map((r) => ({
    questionId: r.question_id,
    moduleId: r.module_id,
    selectedAnswer: r.selected_answer,
    isCorrect: isCompleted ? r.is_correct : null, // Only reveal correctness after completion
    answeredAt: r.answered_at,
  }));

  return {
    session: {
      id: session.id,
      status: session.status,
      currentSection: session.current_section,
      currentModule: session.current_module,
      startedAt: session.started_at,
      completedAt: session.completed_at,
      createdAt: session.created_at,
    },
    modules: formattedModules,
    questions: projectedQuestions,
    responses: formattedResponses,
  };
}

