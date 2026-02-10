/**
 * DIAGNOSTIC SERVICE - Mastery v1.0
 * 
 * Implements deterministic cold-start diagnostic assessment.
 * 
 * Key requirements:
 * - N_TOTAL = 20 questions
 * - Even split between Math and RW (10 each)
 * - Even distribution across domains within each section
 * - Deterministic question selection (sort by difficulty/ID, no RNG)
 * - Idempotent session management
 */

import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  DIAGNOSTIC_TOTAL_QUESTIONS,
  DIAGNOSTIC_LOOKBACK_DAYS,
  DIAGNOSTIC_BLUEPRINT_VERSION,
} from "./mastery-constants";

/**
 * SAT Taxonomy - defines sections and domains for diagnostic blueprint
 */
const SAT_TAXONOMY = {
  math: {
    section_code: 'M',
    domains: [
      'algebra',
      'advanced_math',
      'problem_solving',
      'geometry',
    ],
  },
  rw: {
    section_code: 'RW',
    domains: [
      'craft_structure',
      'information_ideas',
      'standard_english',
      'expression_ideas',
    ],
  },
};

interface DomainAllocation {
  section: string;
  domain: string;
  count: number;
}

/**
 * Compute deterministic domain allocation for diagnostic blueprint
 * 
 * Algorithm:
 * - Split total questions evenly between Math and RW (10 each if both exist)
 * - Within each section, distribute evenly across domains
 * - Use floor division with remainder distributed to first domains (deterministic)
 */
function computeDomainAllocations(): DomainAllocation[] {
  const allocations: DomainAllocation[] = [];
  
  const sectionsEnabled = ['math', 'rw']; // Both sections enabled for v1.0
  const questionsPerSection = Math.floor(DIAGNOSTIC_TOTAL_QUESTIONS / sectionsEnabled.length);
  
  for (const sectionKey of sectionsEnabled) {
    const taxonomy = SAT_TAXONOMY[sectionKey as keyof typeof SAT_TAXONOMY];
    const domains = taxonomy.domains.sort(); // Deterministic order
    
    const baseCount = Math.floor(questionsPerSection / domains.length);
    const remainder = questionsPerSection % domains.length;
    
    domains.forEach((domain, index) => {
      allocations.push({
        section: sectionKey,
        domain,
        count: baseCount + (index < remainder ? 1 : 0),
      });
    });
  }
  
  return allocations;
}

/**
 * Select questions deterministically for a specific domain allocation
 * 
 * Selection algorithm:
 * 1. Filter candidates by section + domain, active, not used in prior diagnostic, not attempted recently
 * 2. Sort by (difficulty ASC, question_id ASC) for determinism
 * 3. Take first k questions
 */
async function selectQuestionsForDomain(
  studentId: string,
  section: string,
  domain: string,
  count: number
): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  
  // Get recently attempted question IDs (last LOOKBACK_DAYS days)
  const lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - DIAGNOSTIC_LOOKBACK_DAYS);
  
  const { data: recentAttempts } = await supabase
    .from('student_question_attempts')
    .select('question_canonical_id')
    .eq('user_id', studentId)
    .gte('attempted_at', lookbackDate.toISOString());
  
  const recentQuestionIds = new Set(
    (recentAttempts || []).map(a => a.question_canonical_id)
  );
  
  // Get questions used in prior diagnostic sessions
  const { data: priorSessions } = await supabase
    .from('diagnostic_sessions')
    .select('question_ids')
    .eq('student_id', studentId);
  
  const priorDiagnosticIds = new Set<string>();
  (priorSessions || []).forEach(session => {
    (session.question_ids || []).forEach(id => priorDiagnosticIds.add(id));
  });
  
  // Query questions for this section/domain
  // Note: Assuming section is stored as "Math" or "Reading & Writing" in DB
  const sectionName = section === 'math' ? 'Math' : 'Reading & Writing';
  
  const { data: candidates, error } = await supabase
    .from('questions')
    .select('canonical_id, difficulty_bucket, id')
    .eq('section', sectionName)
    .eq('domain', domain)
    .eq('needs_review', false) // Only active/servable questions
    .order('difficulty_bucket', { ascending: true })
    .order('id', { ascending: true });
  
  if (error) {
    console.error(`[Diagnostic] Failed to query questions for ${section}/${domain}:`, error);
    return [];
  }
  
  // Filter out recently attempted and prior diagnostic questions
  const filtered = (candidates || [])
    .filter(q => q.canonical_id)
    .filter(q => !recentQuestionIds.has(q.canonical_id))
    .filter(q => !priorDiagnosticIds.has(q.canonical_id));
  
  // Take first k (already sorted deterministically)
  return filtered.slice(0, count).map(q => q.canonical_id);
}

/**
 * Build complete diagnostic question set deterministically
 */
async function buildDiagnosticQuestionSet(studentId: string): Promise<string[]> {
  const allocations = computeDomainAllocations();
  const questionIds: string[] = [];
  
  for (const allocation of allocations) {
    const selected = await selectQuestionsForDomain(
      studentId,
      allocation.section,
      allocation.domain,
      allocation.count
    );
    
    questionIds.push(...selected);
  }
  
  // If we didn't get enough questions (e.g., insufficient question bank),
  // we could implement borrowing from other domains here.
  // For v1.0, we'll just return what we got and log a warning.
  if (questionIds.length < DIAGNOSTIC_TOTAL_QUESTIONS) {
    console.warn(
      `[Diagnostic] Only selected ${questionIds.length}/${DIAGNOSTIC_TOTAL_QUESTIONS} questions for student ${studentId}`
    );
  }
  
  return questionIds;
}

/**
 * Start a new diagnostic session for a student
 * 
 * Idempotent: If an incomplete session exists, returns it instead of creating a new one
 */
export async function startDiagnosticSession(studentId: string): Promise<{
  sessionId: string;
  questionIds: string[];
  currentIndex: number;
  error?: string;
}> {
  const supabase = getSupabaseAdmin();
  
  // Check for existing incomplete session
  const { data: existingSessions } = await supabase
    .from('diagnostic_sessions')
    .select('id, question_ids, current_index, completed_at')
    .eq('student_id', studentId)
    .is('completed_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (existingSessions && existingSessions.length > 0) {
    const session = existingSessions[0];
    return {
      sessionId: session.id,
      questionIds: session.question_ids,
      currentIndex: session.current_index,
    };
  }
  
  // Build deterministic question set
  const questionIds = await buildDiagnosticQuestionSet(studentId);
  
  if (questionIds.length === 0) {
    return {
      sessionId: '',
      questionIds: [],
      currentIndex: 0,
      error: 'No suitable questions found for diagnostic',
    };
  }
  
  // Create new session
  const { data: newSession, error } = await supabase
    .from('diagnostic_sessions')
    .insert({
      student_id: studentId,
      blueprint_version: DIAGNOSTIC_BLUEPRINT_VERSION,
      question_ids: questionIds,
      current_index: 0,
    })
    .select('id, question_ids, current_index')
    .single();
  
  if (error || !newSession) {
    console.error('[Diagnostic] Failed to create session:', error);
    return {
      sessionId: '',
      questionIds: [],
      currentIndex: 0,
      error: 'Failed to create diagnostic session',
    };
  }
  
  return {
    sessionId: newSession.id,
    questionIds: newSession.question_ids,
    currentIndex: newSession.current_index,
  };
}

/**
 * Get the current question in a diagnostic session (idempotent)
 * 
 * Returns the same question until it's answered
 */
export async function getCurrentDiagnosticQuestion(sessionId: string): Promise<{
  questionId: string | null;
  questionIndex: number;
  totalQuestions: number;
  isComplete: boolean;
  error?: string;
}> {
  const supabase = getSupabaseAdmin();
  
  const { data: session, error } = await supabase
    .from('diagnostic_sessions')
    .select('question_ids, current_index, completed_at')
    .eq('id', sessionId)
    .single();
  
  if (error || !session) {
    return {
      questionId: null,
      questionIndex: 0,
      totalQuestions: 0,
      isComplete: false,
      error: 'Session not found',
    };
  }
  
  if (session.completed_at) {
    return {
      questionId: null,
      questionIndex: session.current_index,
      totalQuestions: session.question_ids.length,
      isComplete: true,
    };
  }
  
  const currentIndex = session.current_index;
  const questionIds = session.question_ids;
  
  if (currentIndex >= questionIds.length) {
    return {
      questionId: null,
      questionIndex: currentIndex,
      totalQuestions: questionIds.length,
      isComplete: true,
    };
  }
  
  return {
    questionId: questionIds[currentIndex],
    questionIndex: currentIndex,
    totalQuestions: questionIds.length,
    isComplete: false,
  };
}

/**
 * Record a diagnostic answer and advance to next question
 * 
 * This is NOT idempotent - it advances the session state
 */
export async function recordDiagnosticAnswer(
  sessionId: string,
  questionCanonicalId: string,
  isCorrect: boolean,
  selectedChoice: string | null,
  timeSpentMs: number | null
): Promise<{
  success: boolean;
  nextQuestionId: string | null;
  isComplete: boolean;
  error?: string;
}> {
  const supabase = getSupabaseAdmin();
  
  // Get current session state
  const { data: session, error: sessionError } = await supabase
    .from('diagnostic_sessions')
    .select('student_id, question_ids, current_index, completed_at')
    .eq('id', sessionId)
    .single();
  
  if (sessionError || !session) {
    return {
      success: false,
      nextQuestionId: null,
      isComplete: false,
      error: 'Session not found',
    };
  }
  
  if (session.completed_at) {
    return {
      success: false,
      nextQuestionId: null,
      isComplete: true,
      error: 'Session already completed',
    };
  }
  
  const currentIndex = session.current_index;
  const questionIds = session.question_ids;
  
  // Verify this is the current question
  if (questionIds[currentIndex] !== questionCanonicalId) {
    return {
      success: false,
      nextQuestionId: null,
      isComplete: false,
      error: 'Question mismatch - not the current question',
    };
  }
  
  // Record the response
  const { error: responseError } = await supabase
    .from('diagnostic_responses')
    .insert({
      session_id: sessionId,
      question_canonical_id: questionCanonicalId,
      question_index: currentIndex,
      is_correct: isCorrect,
      selected_choice: selectedChoice,
      time_spent_ms: timeSpentMs,
    });
  
  if (responseError) {
    console.error('[Diagnostic] Failed to record response:', responseError);
    return {
      success: false,
      nextQuestionId: null,
      isComplete: false,
      error: 'Failed to record answer',
    };
  }
  
  // Advance to next question
  const nextIndex = currentIndex + 1;
  const isComplete = nextIndex >= questionIds.length;
  
  const { error: updateError } = await supabase
    .from('diagnostic_sessions')
    .update({
      current_index: nextIndex,
      completed_at: isComplete ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);
  
  if (updateError) {
    console.error('[Diagnostic] Failed to update session:', updateError);
    return {
      success: false,
      nextQuestionId: null,
      isComplete: false,
      error: 'Failed to advance session',
    };
  }
  
  return {
    success: true,
    nextQuestionId: isComplete ? null : questionIds[nextIndex],
    isComplete,
  };
}
