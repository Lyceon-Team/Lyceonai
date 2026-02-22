/**
 * Full-Length SAT Exam Service
 * 
 * Implements Bluebook-style adaptive testing with:
 * - Deterministic question selection (seeded)
 * - Server-authoritative timing
 * - Adaptive Module 2 difficulty based on Module 1 performance
 * - Idempotent answer submission
 * - Anti-leak: no answers/explanations before module submit
 */

import { getSupabaseAdmin } from "../lib/supabase-admin";
import type { 
  FullLengthExamSession, 
  FullLengthExamModule,
  FullLengthExamQuestion,
  FullLengthExamResponse,
  Question
} from "../../../../shared/schema";

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

// ============================================================================
// TYPES
// ============================================================================

export type SectionType = "rw" | "math";
export type ModuleIndex = 1 | 2;
export type DifficultyBucket = "easy" | "medium" | "hard";
export type SessionStatus = "not_started" | "in_progress" | "completed" | "abandoned";
export type ModuleStatus = "not_started" | "in_progress" | "submitted" | "expired";

export interface CreateSessionParams {
  userId: string;
}

export interface GetCurrentSessionResult {
  session: FullLengthExamSession;
  currentModule: FullLengthExamModule | null;
  currentQuestion: {
    id: string;
    stem: string;
    section: string;
    type: "mc" | "fr";
    options: Array<{ key: string; text: string }> | null;
    difficulty: string | null;
    orderIndex: number;
    moduleQuestionCount: number;
    answeredCount: number;
    // User's previously submitted answer (for resume support)
    submittedAnswer?: {
      selectedAnswer?: string;
      freeResponseAnswer?: string;
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
  freeResponseAnswer?: string;
}

export interface SubmitModuleParams {
  sessionId: string;
  userId: string;
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
}

export interface CompleteExamResult {
  sessionId: string;
  rwScore: {
    module1: { correct: number; total: number };
    module2: { correct: number; total: number };
    totalCorrect: number;
    totalQuestions: number;
  };
  mathScore: {
    module1: { correct: number; total: number };
    module2: { correct: number; total: number };
    totalCorrect: number;
    totalQuestions: number;
  };
  overallScore: {
    totalCorrect: number;
    totalQuestions: number;
    percentageCorrect: number;
  };
  completedAt: Date;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Generate a deterministic seed for the session
 * Format: userId_timestamp
 */
function generateSeed(userId: string): string {
  return `${userId}_${Date.now()}`;
}

/**
 * Simple hash function for deterministic selection
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

/**
 * Deterministically pick an item from an array using a seed
 */
function deterministicPickFromArray<T>(items: T[], seed: string): T {
  if (items.length === 0) throw new Error("Cannot pick from empty array");
  const idx = simpleHash(seed) % items.length;
  return items[idx];
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

/**
 * Format a score rollup DB row as a CompleteExamResult
 */
function formatRollupAsResult(
  rollup: {
    session_id: string;
    rw_module1_correct: number;
    rw_module1_total: number;
    rw_module2_correct: number;
    rw_module2_total: number;
    math_module1_correct: number;
    math_module1_total: number;
    math_module2_correct: number;
    math_module2_total: number;
    overall_score: number;
  },
  completedAt: Date
): CompleteExamResult {
  const rwTotalCorrect = rollup.rw_module1_correct + rollup.rw_module2_correct;
  const rwTotalQuestions = rollup.rw_module1_total + rollup.rw_module2_total;
  const mathTotalCorrect = rollup.math_module1_correct + rollup.math_module2_correct;
  const mathTotalQuestions = rollup.math_module1_total + rollup.math_module2_total;
  const overallTotalQuestions = rwTotalQuestions + mathTotalQuestions;

  return {
    sessionId: rollup.session_id,
    rwScore: {
      module1: { correct: rollup.rw_module1_correct, total: rollup.rw_module1_total },
      module2: { correct: rollup.rw_module2_correct, total: rollup.rw_module2_total },
      totalCorrect: rwTotalCorrect,
      totalQuestions: rwTotalQuestions,
    },
    mathScore: {
      module1: { correct: rollup.math_module1_correct, total: rollup.math_module1_total },
      module2: { correct: rollup.math_module2_correct, total: rollup.math_module2_total },
      totalCorrect: mathTotalCorrect,
      totalQuestions: mathTotalQuestions,
    },
    overallScore: {
      totalCorrect: rollup.overall_score,
      totalQuestions: overallTotalQuestions,
      percentageCorrect:
        overallTotalQuestions > 0
          ? (rollup.overall_score / overallTotalQuestions) * 100
          : 0,
    },
    completedAt,
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
  const moduleScores: Record<string, { correct: number; total: number }> = {};

  for (const module of modules) {
    const { data: responses, error: responsesError } = await supabase
      .from("full_length_exam_responses")
      .select("is_correct")
      .eq("module_id", module.id);

    if (responsesError) {
      throw new Error(`Failed to fetch responses for module ${module.id}`);
    }

    const correct = responses?.filter((r) => r.is_correct).length || 0;
    const total = responses?.length || 0;

    const key = `${module.section}_${module.module_index}`;
    moduleScores[key] = { correct, total };
  }

  // Compute scores
  const rwModule1 = moduleScores["rw_1"] || { correct: 0, total: 0 };
  const rwModule2 = moduleScores["rw_2"] || { correct: 0, total: 0 };
  const mathModule1 = moduleScores["math_1"] || { correct: 0, total: 0 };
  const mathModule2 = moduleScores["math_2"] || { correct: 0, total: 0 };

  const rwTotalCorrect = rwModule1.correct + rwModule2.correct;
  const rwTotalQuestions = rwModule1.total + rwModule2.total;

  const mathTotalCorrect = mathModule1.correct + mathModule2.correct;
  const mathTotalQuestions = mathModule1.total + mathModule2.total;

  const overallTotalCorrect = rwTotalCorrect + mathTotalCorrect;
  const overallTotalQuestions = rwTotalQuestions + mathTotalQuestions;
  const percentageCorrect = overallTotalQuestions > 0 
    ? (overallTotalCorrect / overallTotalQuestions) * 100 
    : 0;

  return {
    sessionId,
    rwScore: {
      module1: rwModule1,
      module2: rwModule2,
      totalCorrect: rwTotalCorrect,
      totalQuestions: rwTotalQuestions,
    },
    mathScore: {
      module1: mathModule1,
      module2: mathModule2,
      totalCorrect: mathTotalCorrect,
      totalQuestions: mathTotalQuestions,
    },
    overallScore: {
      totalCorrect: overallTotalCorrect,
      totalQuestions: overallTotalQuestions,
      percentageCorrect,
    },
    completedAt,
  };
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
// PUBLIC API
// ============================================================================

/**
 * Create a new full-length exam session
 * Idempotent: returns existing active session if one exists for the user
 */
export async function createExamSession(params: CreateSessionParams): Promise<FullLengthExamSession> {
  const supabase = getSupabaseAdmin();

  // Check for existing active session (not_started, in_progress, or break)
  const { data: existingSession } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .in("status", ["not_started", "in_progress", "break"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If active session exists, return it (idempotent)
  if (existingSession) {
    return existingSession;
  }

  // No active session - create a new one
  const seed = generateSeed(params.userId);

  // Create the session
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .insert({
      user_id: params.userId,
      seed,
      status: "not_started",
    })
    .select()
    .single();

  // If insert failed due to unique constraint (race condition),
  // re-select the active session that was created by the concurrent request
  if (sessionError) {
    // Check if it's a unique constraint violation (code 23505)
    if (sessionError.code === '23505' || sessionError.message?.includes('duplicate') || sessionError.message?.includes('unique')) {
      const { data: racedSession } = await supabase
        .from("full_length_exam_sessions")
        .select("*")
        .eq("user_id", params.userId)
        .in("status", ["not_started", "in_progress", "break"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (racedSession) {
        return racedSession;
      }
    }
    
    throw new Error(`Failed to create exam session: ${sessionError.message || "Unknown error"}`);
  }

  if (!session) {
    throw new Error("Failed to create exam session: No session returned");
  }

  // Create all 4 modules (but don't select questions yet)
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

  const { error: modulesError } = await supabase
    .from("full_length_exam_modules")
    .insert(modules);

  if (modulesError) {
    throw new Error(`Failed to create exam modules: ${modulesError.message}`);
  }

  return session;
}

/**
 * Get the current session state with the current question
 */
export async function getCurrentSession(
  sessionId: string,
  userId: string
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
    // Calculate break time remaining (simplified - using session updated_at as break start)
    const breakStart = new Date(session.updated_at).getTime();
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
    await startModule(sessionId, currentModule.id, session.seed);
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
        stem,
        section,
        type,
        options,
        difficulty
      )
    `)
    .eq("module_id", currentModule.id)
    .order("order_index", { ascending: true });

  if (questionsError) {
    throw new Error(`Failed to fetch module questions: ${questionsError.message}`);
  }

  // Get responses for this module (including answer content for resume support)
  const { data: responses, error: responsesError } = await supabase
    .from("full_length_exam_responses")
    .select("question_id, selected_answer, free_response_answer")
    .eq("module_id", currentModule.id);

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

  // Build a map of question_id -> response for quick lookup
  const responseMap = new Map(
    responses?.map((r) => [r.question_id, { 
      selectedAnswer: r.selected_answer, 
      freeResponseAnswer: r.free_response_answer 
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
      stem: string;
      section: string;
      type: string;
      options: Array<{ key: string; text: string }> | null;
      difficulty: string | null;
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
      
      currentQuestion = {
        id: q.id,
        stem: q.stem,
        section: q.section,
        type: q.type as "mc" | "fr",
        options: q.type === "mc" ? q.options : null,
        difficulty: q.difficulty,
        orderIndex: target.order_index,
        moduleQuestionCount: moduleQuestions.length,
        answeredCount: answeredQuestionIds.size,
        // Include previously submitted answer if it exists (for resume support)
        submittedAnswer: submittedAnswer ? {
          selectedAnswer: submittedAnswer.selectedAnswer || undefined,
          freeResponseAnswer: submittedAnswer.freeResponseAnswer || undefined,
        } : undefined,
      };
    }
  }

  // Calculate time remaining
  const timeRemaining = calculateTimeRemaining(currentModule);

  // Check if time expired
  if (timeRemaining !== null && timeRemaining === 0 && currentModule.status === "in_progress") {
    // Auto-submit module if time expired
    await submitModule({ sessionId, userId });
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
 * Start a module by selecting questions and setting start time
 */
async function startModule(sessionId: string, moduleId: string, seed: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Get module details
  const { data: module, error: moduleError } = await supabase
    .from("full_length_exam_modules")
    .select("*")
    .eq("id", moduleId)
    .single();

  if (moduleError || !module) {
    throw new Error("Module not found");
  }

  const section = module.section as SectionType;
  const moduleIndex = module.module_index as ModuleIndex;
  const config = MODULE_CONFIG[section][`module${moduleIndex}` as "module1" | "module2"];

  // Select questions deterministically
  const questions = await selectQuestionsForModule(
    section,
    moduleIndex,
    module.difficulty_bucket as DifficultyBucket | null,
    config.questionCount,
    seed,
    moduleId
  );

  // Insert module questions
  const moduleQuestions = questions.map((q, idx) => ({
    module_id: moduleId,
    question_id: q.id,
    order_index: idx,
  }));

  const { error: insertError } = await supabase
    .from("full_length_exam_questions")
    .insert(moduleQuestions);

  if (insertError) {
    throw new Error(`Failed to insert module questions: ${insertError.message}`);
  }

  // Update module to in_progress
  const now = new Date();
  const endsAt = new Date(now.getTime() + module.target_duration_ms);

  const { error: updateError } = await supabase
    .from("full_length_exam_modules")
    .update({
      status: "in_progress",
      started_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .eq("id", moduleId);

  if (updateError) {
    throw new Error(`Failed to start module: ${updateError.message}`);
  }
}

/**
 * Select questions for a module deterministically
 */
async function selectQuestionsForModule(
  section: SectionType,
  moduleIndex: ModuleIndex,
  difficultyBucket: DifficultyBucket | null,
  questionCount: number,
  seed: string,
  moduleId: string
): Promise<Array<{ id: string }>> {
  const supabase = getSupabaseAdmin();

  // For module 1, select from medium difficulty
  // For module 2, use the adaptive difficulty bucket
  const targetDifficulty = moduleIndex === 1 ? "medium" : (difficultyBucket || "medium");

  // Map section to question section names
  const sectionFilter = section === "rw" ? ["Reading", "Writing", "Reading and Writing"] : ["Math"];

  // Build query
  let query = supabase
    .from("questions")
    .select("id, difficulty, canonical_id")
    .in("section", sectionFilter)
    .eq("type", "mc") // Only MC questions for now
    .not("answer_choice", "is", null); // Must have an answer

  // Add difficulty filter
  if (targetDifficulty === "easy") {
    query = query.in("difficulty", ["Easy", "easy", "1"]);
  } else if (targetDifficulty === "medium") {
    query = query.in("difficulty", ["Medium", "medium", "2"]);
  } else {
    query = query.in("difficulty", ["Hard", "hard", "3"]);
  }

  const { data: candidates, error } = await query.limit(questionCount * 3); // Get more than needed for selection

  if (error) {
    throw new Error(`Failed to fetch questions: ${error.message}`);
  }

  if (!candidates || candidates.length === 0) {
    throw new Error(`No questions available for section=${section}, difficulty=${targetDifficulty}`);
  }

  // Deterministically shuffle and select
  const shuffled = [...candidates];
  const seedForModule = `${seed}_${moduleId}_${section}_${moduleIndex}`;
  
  // Simple deterministic shuffle
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = simpleHash(`${seedForModule}_${i}`) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Take first N questions
  return shuffled.slice(0, questionCount);
}

/**
 * Submit an answer to a question
 */
export async function submitAnswer(params: SubmitAnswerParams): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Validate session ownership
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("id, status, current_section, current_module")
    .eq("id", params.sessionId)
    .eq("user_id", params.userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

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

  if (currentModule.status !== "in_progress") {
    throw new Error("Module is not in progress");
  }

  // Check if time expired
  const timeRemaining = calculateTimeRemaining(currentModule);
  if (timeRemaining === 0) {
    throw new Error("Module time has expired");
  }

  // Verify question belongs to this module
  const { data: moduleQuestion, error: mqError } = await supabase
    .from("full_length_exam_questions")
    .select("id")
    .eq("module_id", currentModule.id)
    .eq("question_id", params.questionId)
    .single();

  if (mqError || !moduleQuestion) {
    throw new Error("Question not found in current module");
  }

  // Get question to check correctness
  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("id, type, answer_choice, answer_text")
    .eq("id", params.questionId)
    .single();

  if (questionError || !question) {
    throw new Error("Question not found");
  }

  // Determine correctness
  let isCorrect = false;
  if (question.type === "mc" && params.selectedAnswer) {
    isCorrect = params.selectedAnswer.toUpperCase() === (question.answer_choice || "").toUpperCase();
  } else if (question.type === "fr" && params.freeResponseAnswer) {
    // Simple string comparison for FR (could be enhanced)
    isCorrect = params.freeResponseAnswer.trim().toLowerCase() === (question.answer_text || "").trim().toLowerCase();
  }

  // Upsert response (idempotent with unique constraint)
  const now = new Date().toISOString();
  
  const { error: upsertError } = await supabase
    .from("full_length_exam_responses")
    .upsert({
      session_id: params.sessionId,
      module_id: currentModule.id,
      question_id: params.questionId,
      selected_answer: params.selectedAnswer,
      free_response_answer: params.freeResponseAnswer,
      is_correct: isCorrect,
      answered_at: now,
      updated_at: now,
    }, {
      onConflict: 'session_id,module_id,question_id',
      ignoreDuplicates: false,
    });

  if (upsertError) {
    throw new Error(`Failed to upsert response: ${upsertError.message}`);
  }
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
        .select("is_correct")
        .eq("module_id", currentModule.id);
      
      const correctCount = responses?.filter((r) => r.is_correct).length || 0;
      const totalCount = responses?.length || 0;
      
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
          difficultyBucket: (module2?.difficulty_bucket as DifficultyBucket) || "medium"
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
    .select("is_correct")
    .eq("module_id", currentModule.id);

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

  const correctCount = responses?.filter((r) => r.is_correct).length || 0;
  const totalCount = responses?.length || 0;

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
export async function startExam(sessionId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Validate session ownership
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  if (session.status !== "not_started") {
    throw new Error("Exam already started");
  }

  // Update session to in_progress, set current section/module
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
}

/**
 * Continue from break to Math Module 1
 */
export async function continueFromBreak(sessionId: string, userId: string): Promise<void> {
  const supabase = getSupabaseAdmin();

  // Validate session ownership
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (sessionError || !session) {
    throw new Error("Session not found or access denied");
  }

  if (session.current_section !== "break") {
    throw new Error("Not on break");
  }

  // Update session to Math Module 1
  const { error: updateError } = await supabase
    .from("full_length_exam_sessions")
    .update({
      current_section: "math",
      current_module: 1,
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

  // Idempotency: if already completed, return existing rollup from DB
  if (session.status === "completed") {
    // Fetch existing rollup from database (deterministic)
    const { data: existingRollup, error: rollupError } = await supabase
      .from("full_length_exam_score_rollups")
      .select("*")
      .eq("session_id", params.sessionId)
      .single();

    if (rollupError || !existingRollup) {
      throw new Error("Score rollup not found for completed session");
    }

    // Return rollup data in CompleteExamResult format
    return formatRollupAsResult(existingRollup, new Date(session.completed_at!));
  }

  // Terminal-state guard: enforce preconditions for completion
  // - session.status must be "in_progress"
  // - session.current_section must be "math"
  // - session.current_module must be 2
  // - Math Module 2 must exist
  // - Math Module 2 status must be "submitted"
  
  if (session.status !== "in_progress") {
    throw new Error("Invalid exam state");
  }

  if (session.current_section !== "math") {
    throw new Error("Invalid exam state");
  }

  if (session.current_module !== 2) {
    throw new Error("Invalid exam state");
  }

  // Verify Math Module 2 exists and is submitted
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

  // Mark session as completed with atomic conditional update
  // Only update if status is NOT already 'completed' (prevents race conditions)
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

  // Handle race condition: if no rows were updated, session was already completed
  // Re-fetch and return the existing completed result (idempotent)
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
      // Session was completed by concurrent request - return existing rollup from DB
      const { data: existingRollup, error: rollupError } = await supabase
        .from("full_length_exam_score_rollups")
        .select("*")
        .eq("session_id", params.sessionId)
        .single();

      if (rollupError || !existingRollup) {
        throw new Error("Score rollup not found for completed session");
      }

      return formatRollupAsResult(existingRollup, new Date(completedSession.completed_at!));
    } else {
      throw new Error("Invalid exam state");
    }
  }

  // Success: compute scores, persist rollup, and return
  return await computeAndPersistExamScores(
    supabase,
    params.sessionId,
    params.userId,
    completedAt
  );
}

// ============================================================================
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
  'id',
  'stem',
  'section',
  'type',
  'options',
  'difficulty',
  'difficultyLevel',
  'unitTag',
  'tags',
  'questionNumber',
  'pageNumber',
] as const;

/**
 * Additional fields to include when session is completed.
 * These fields reveal correct answers and explanations.
 */
export const ANSWER_FIELDS_POST_COMPLETION = [
  'answer',
  'answerChoice',
  'answerText',
  'explanation',
  'classification',
] as const;

/**
 * Supabase select string for pre-completion question queries.
 * Only fetches safe fields — answer/explanation never leave the DB pre-completion.
 */
const SAFE_QUESTION_SELECT_PRE_COMPLETION = SAFE_QUESTION_FIELDS_PRE_COMPLETION.join(",");

/**
 * Supabase select string for post-completion question queries.
 * Fetches safe fields plus answer/explanation fields.
 */
const SAFE_QUESTION_SELECT_POST_COMPLETION =
  [...SAFE_QUESTION_FIELDS_PRE_COMPLETION, ...ANSWER_FIELDS_POST_COMPLETION].join(",");

/**
 * Type-safe question row from Supabase for pre-completion queries.
 * Only includes safe fields that don't leak answers/explanations.
 */
type QuestionRowPreCompletion = Pick<
  Question,
  'id' | 'stem' | 'section' | 'type' | 'options' | 'difficulty' | 
  'difficultyLevel' | 'unitTag' | 'tags' | 'questionNumber' | 'pageNumber'
>;

/**
 * Type-safe question row from Supabase for post-completion queries.
 * Includes all safe fields plus answer/explanation fields.
 */
type QuestionRowPostCompletion = Pick<
  Question,
  'id' | 'stem' | 'section' | 'type' | 'options' | 'difficulty' | 
  'difficultyLevel' | 'unitTag' | 'tags' | 'questionNumber' | 'pageNumber' |
  'answer' | 'answerChoice' | 'answerText' | 'explanation' | 'classification'
>;

/**
 * Safe question type for pre-completion review.
 * Contains only fields from SAFE_QUESTION_FIELDS_PRE_COMPLETION.
 */
export interface SafeQuestionPreCompletion {
  id: string;
  stem: string;
  section: string;
  type: string | null;
  options: Array<{ key: string; text: string }> | null;
  difficulty: string | null;
  difficultyLevel: number | null;
  unitTag: string | null;
  tags: string[] | null;
  questionNumber: number | null;
  pageNumber: number | null;
}

/**
 * Full question type for post-completion review.
 * Includes answer and explanation fields.
 */
export interface FullQuestionPostCompletion extends SafeQuestionPreCompletion {
  answer: string;
  answerChoice: string | null;
  answerText: string | null;
  explanation: string | null;
  classification: unknown | null;
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
  freeResponseAnswer: string | null;
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
}

/**
 * Apply safe projection to a question object.
 * Uses an explicit allowlist to ensure only safe fields are included.
 */
function projectSafeQuestionFields(
  question: Record<string, unknown>
): SafeQuestionPreCompletion {
  const result: SafeQuestionPreCompletion = {
    id: question.id as string,
    stem: question.stem as string,
    section: question.section as string,
    type: (question.type ?? null) as string | null,
    options: (question.options ?? null) as Array<{ key: string; text: string }> | null,
    difficulty: (question.difficulty ?? null) as string | null,
    difficultyLevel: (question.difficultyLevel ?? question.difficulty_level ?? null) as number | null,
    unitTag: (question.unitTag ?? question.unit_tag ?? null) as string | null,
    tags: (question.tags ?? null) as string[] | null,
    questionNumber: (question.questionNumber ?? question.question_number ?? null) as number | null,
    pageNumber: (question.pageNumber ?? question.page_number ?? null) as number | null,
  };
  return result;
}

/**
 * Project full question fields including answers (for completed sessions).
 */
function projectFullQuestionFields(
  question: Record<string, unknown>
): FullQuestionPostCompletion {
  const safeFields = projectSafeQuestionFields(question);
  return {
    ...safeFields,
    answer: question.answer as string,
    answerChoice: (question.answerChoice ?? question.answer_choice ?? null) as string | null,
    answerText: (question.answerText ?? question.answer_text ?? null) as string | null,
    explanation: (question.explanation ?? null) as string | null,
    classification: question.classification ?? null,
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
  const { supabase, sessionId } = params;

  // Load session by ID (RLS enforces user ownership, but we verify existence)
  const { data: session, error: sessionError } = await supabase
    .from("full_length_exam_sessions")
    .select("id, user_id, status, current_section, current_module, seed, started_at, completed_at, created_at")
    .eq("id", sessionId)
    .single();

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

    if (Array.isArray(questionsData) && questionsData.every((q) => typeof q === "object")) {
      questions = questionsData as unknown as Record<string, unknown>[];
    }
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
    .select("question_id, module_id, selected_answer, free_response_answer, is_correct, answered_at")
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
    freeResponseAnswer: r.free_response_answer,
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
