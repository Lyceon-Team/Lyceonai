/**
 * MASTERY V1.0 CONSTANTS
 * 
 * Sprint 3: All mastery calculation constants are defined here.
 * These are FIXED values for v1.0 - do not learn/fit them.
 * 
 * This is the single source of truth for mastery algorithm parameters.
 */

// ============================================================================
// A. Event Types (closed set - no free strings allowed)
// ============================================================================

export enum MasteryEventType {
  PRACTICE_SUBMIT = 'PRACTICE_SUBMIT',
  DIAGNOSTIC_SUBMIT = 'DIAGNOSTIC_SUBMIT',
  FULL_LENGTH_SUBMIT = 'FULL_LENGTH_SUBMIT',
  TUTOR_VIEW = 'TUTOR_VIEW',
  TUTOR_RETRY_SUBMIT = 'TUTOR_RETRY_SUBMIT',
}

// ============================================================================
// B. Core Mastery Formula Constants
// ============================================================================

/**
 * ALPHA - Global learning rate for mastery updates
 * Controls how much each new attempt influences the stored mastery score.
 * 
 * Formula: M_new = M_old + ALPHA * delta
 * 
 * Fixed at 0.20 for v1.0 (no learning/fitting)
 */
export const ALPHA = 0.20;

/**
 * base_delta - Base magnitude for mastery change per attempt
 * Each correct/incorrect attempt produces a delta of +/- base_delta (before weighting)
 * 
 * Fixed at 10.0 for v1.0
 */
export const BASE_DELTA = 10.0;

/**
 * M_init - Initial mastery score for cold start (no attempts yet)
 * Starting at 50 avoids extreme pessimism before evidence.
 * 
 * Fixed at 50.0 for v1.0
 */
export const M_INIT = 50.0;

/**
 * M_min, M_max - Clamp bounds for mastery_score
 * All mastery scores are clamped to [0, 100]
 */
export const M_MIN = 0;
export const M_MAX = 100;

// ============================================================================
// C. Event Weights (impact multipliers)
// ============================================================================

/**
 * Event weights control how impactful each attempt type is.
 * 
 * Rationale:
 * - Diagnostic is slightly stronger than ordinary practice (sets baseline faster)
 * - Full-length is strongest (higher reliability)
 * - Tutor retry is weaker than raw practice (assisted learning)
 * - Practice is baseline (1.0)
 * 
 * Fixed constants for v1.0 - do not learn/fit
 */
export const EVENT_WEIGHTS: Record<MasteryEventType, number> = {
  [MasteryEventType.PRACTICE_SUBMIT]: 1.00,
  [MasteryEventType.DIAGNOSTIC_SUBMIT]: 1.25,
  [MasteryEventType.FULL_LENGTH_SUBMIT]: 1.50,
  [MasteryEventType.TUTOR_VIEW]: 0.00, // No mastery change
  [MasteryEventType.TUTOR_RETRY_SUBMIT]: 0.75,
};

// ============================================================================
// D. Half-Life Decay (projection-only, never persisted)
// ============================================================================

/**
 * HALF_LIFE_WEEKS - Time window for recency decay
 * After 6 weeks of inactivity, mastery estimate decays to 50%
 * After 12 weeks, decays to 25%, etc.
 * 
 * CRITICAL: Decay is computed for projections/prioritization only.
 * Never write decayed mastery back to mastery_score column.
 */
export const HALF_LIFE_WEEKS = 6.0;

// ============================================================================
// E. Diagnostic Blueprint Constants
// ============================================================================

/**
 * N_TOTAL - Total questions in cold start diagnostic
 * Fixed at 20 for v1.0
 */
export const DIAGNOSTIC_TOTAL_QUESTIONS = 20;

/**
 * DIAGNOSTIC_LOOKBACK_DAYS - Exclude recently attempted questions
 * Don't reuse questions attempted in the last 30 days
 */
export const DIAGNOSTIC_LOOKBACK_DAYS = 30;

/**
 * DIAGNOSTIC_BLUEPRINT_VERSION - Version identifier for diagnostic structure
 * Stored in diagnostic_sessions.blueprint_version
 */
export const DIAGNOSTIC_BLUEPRINT_VERSION = 'diag_v1';

// ============================================================================
// F. Mastery Status Thresholds (UI labels, derived from mastery_score)
// ============================================================================

/**
 * Thresholds for mastery status labels
 * These are pure functions of mastery_score, not stored values
 */
export const MASTERY_STATUS_THRESHOLDS = {
  WEAK: 40,        // < 40 = weak
  IMPROVING: 70,   // < 70 = improving, >= 70 = proficient
} as const;

// ============================================================================
// G. Default Values
// ============================================================================

/**
 * Default question weight (difficulty calibration)
 * Fixed at 1.0 for v1.0 - do not use difficulty-based weighting yet
 */
export const DEFAULT_QUESTION_WEIGHT = 1.0;
