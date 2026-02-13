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
  FullLengthExamResponse
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
    classification: any;
    orderIndex: number;
    moduleQuestionCount: number;
    answeredCount: number;
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
 */
export async function createExamSession(params: CreateSessionParams): Promise<FullLengthExamSession> {
  const supabase = getSupabaseAdmin();
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

  if (sessionError || !session) {
    throw new Error(`Failed to create exam session: ${sessionError?.message || "Unknown error"}`);
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

  // Get questions for this module
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
        difficulty,
        classification
      )
    `)
    .eq("module_id", currentModule.id)
    .order("order_index", { ascending: true });

  if (questionsError) {
    throw new Error(`Failed to fetch module questions: ${questionsError.message}`);
  }

  // Get responses for this module
  const { data: responses, error: responsesError } = await supabase
    .from("full_length_exam_responses")
    .select("question_id")
    .eq("module_id", currentModule.id);

  if (responsesError) {
    throw new Error(`Failed to fetch responses: ${responsesError.message}`);
  }

  const answeredQuestionIds = new Set(responses?.map((r) => r.question_id) || []);

  // Find first unanswered question
  let currentQuestion = null;
  if (moduleQuestions && moduleQuestions.length > 0) {
    const unanswered = moduleQuestions.find((mq) => !answeredQuestionIds.has(mq.question_id));
    const target = unanswered || moduleQuestions[0];
    
    if (target && (target as any).questions) {
      const q = (target as any).questions;
      currentQuestion = {
        id: q.id,
        stem: q.stem,
        section: q.section,
        type: q.type,
        options: q.type === "mc" ? q.options : null,
        difficulty: q.difficulty,
        classification: q.classification,
        orderIndex: target.order_index,
        moduleQuestionCount: moduleQuestions.length,
        answeredCount: answeredQuestionIds.size,
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

  // If module already submitted, return cached result (idempotent)
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

  // Mark module as submitted
  const { error: updateError } = await supabase
    .from("full_length_exam_modules")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
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
    
    // Update Module 2 difficulty
    const { error: difficultyError } = await supabase
      .from("full_length_exam_modules")
      .update({ difficulty_bucket: difficulty })
      .eq("session_id", params.sessionId)
      .eq("section", currentSection)
      .eq("module_index", 2);

    if (difficultyError) {
      throw new Error(`Failed to set Module 2 difficulty: ${difficultyError.message}`);
    }

    nextModule = { section: currentSection, moduleIndex: 2, difficultyBucket: difficulty };

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

  if (session.status === "completed") {
    throw new Error("Exam already completed");
  }

  // Get all modules
  const { data: modules, error: modulesError } = await supabase
    .from("full_length_exam_modules")
    .select("id, section, module_index")
    .eq("session_id", params.sessionId)
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

  // Mark session as completed
  const completedAt = new Date();
  const { error: updateError } = await supabase
    .from("full_length_exam_sessions")
    .update({
      status: "completed",
      completed_at: completedAt.toISOString(),
      updated_at: completedAt.toISOString(),
    })
    .eq("id", params.sessionId);

  if (updateError) {
    throw new Error(`Failed to complete exam: ${updateError.message}`);
  }

  return {
    sessionId: params.sessionId,
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
