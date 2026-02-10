/**
 * MASTERY PROJECTION SERVICE - Mastery v1.0
 * 
 * Implements projection-only features:
 * - Half-life decay calculation (never persisted)
 * - Mastery status labels (derived from mastery_score)
 * 
 * CRITICAL: These are READ-ONLY projections.
 * They NEVER write back to mastery_score columns.
 */

import {
  HALF_LIFE_WEEKS,
  MASTERY_STATUS_THRESHOLDS,
} from './mastery-constants';
import type { MasteryStatus, DecayedMastery } from '../types/mastery';

/**
 * Compute half-life decay factor for recency weighting
 * 
 * Formula: decay_factor = 0.5 ** (weeks_inactive / HALF_LIFE_WEEKS)
 * 
 * Examples:
 * - 0 weeks inactive → 1.0 (no decay)
 * - 6 weeks inactive → 0.5 (half)
 * - 12 weeks inactive → 0.25 (quarter)
 * 
 * PROJECTION ONLY: This is computed for prioritization and projections.
 * The decayed value is NEVER written back to mastery_score.
 * 
 * @param updatedAt - The last_attempt_at timestamp from mastery row
 * @returns DecayedMastery object with stored and decayed values
 */
export function computeDecayedMastery(
  storedMastery: number,
  updatedAt: Date | string
): DecayedMastery {
  const now = new Date();
  const lastUpdate = new Date(updatedAt);
  
  // Compute weeks inactive
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksInactive = Math.max(0, (now.getTime() - lastUpdate.getTime()) / msPerWeek);
  
  // Half-life decay: 0.5 ** (weeks / HALF_LIFE_WEEKS)
  const decayFactor = Math.pow(0.5, weeksInactive / HALF_LIFE_WEEKS);
  
  // Decayed mastery = stored * decay_factor
  const decayedMastery = storedMastery * decayFactor;
  
  return {
    stored_mastery: storedMastery,
    weeks_inactive: weeksInactive,
    decay_factor: decayFactor,
    decayed_mastery: decayedMastery,
  };
}

/**
 * Compute mastery status label from mastery_score
 * 
 * Pure function of mastery_score and attempts count.
 * Does NOT recalculate mastery_score itself.
 * 
 * Thresholds (from spec):
 * - not_started: attempts === 0
 * - weak: mastery_score < 40
 * - improving: mastery_score < 70
 * - proficient: mastery_score >= 70
 * 
 * @param masteryScore - The stored mastery_score (0-100)
 * @param attempts - Number of attempts
 * @returns MasteryStatus label
 */
export function getMasteryStatus(
  masteryScore: number,
  attempts: number
): MasteryStatus {
  if (attempts === 0) {
    return 'not_started';
  }
  
  if (masteryScore < MASTERY_STATUS_THRESHOLDS.WEAK) {
    return 'weak';
  }
  
  if (masteryScore < MASTERY_STATUS_THRESHOLDS.IMPROVING) {
    return 'improving';
  }
  
  return 'proficient';
}

/**
 * Apply decay to a mastery score for projection purposes
 * 
 * PROJECTION ONLY: This returns a derived value.
 * The caller MUST NOT write this back to mastery_score.
 * 
 * @param storedMastery - The persisted mastery_score
 * @param updatedAt - The last_attempt_at timestamp
 * @returns Decayed mastery value (0-100)
 */
export function applyDecayForProjection(
  storedMastery: number,
  updatedAt: Date | string
): number {
  const result = computeDecayedMastery(storedMastery, updatedAt);
  return result.decayed_mastery;
}
