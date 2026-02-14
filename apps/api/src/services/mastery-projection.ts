/**
 * MASTERY PROJECTION SERVICE - Sprint 3 True Half-Life
 * 
 * Implements projection-only features:
 * - Mastery status labels (derived from mastery_score)
 * 
 * CRITICAL: These are READ-ONLY projections.
 * They NEVER write back to mastery_score columns.
 * 
 * NOTE: Decay is now PERSISTED in the database via True Half-Life formula.
 * No client-side decay calculation needed for mastery scores.
 */

import {
  MASTERY_STATUS_THRESHOLDS,
} from './mastery-constants';
import type { MasteryStatus } from '../types/mastery';

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
 * @param attempts - Number of attempts (effective decayed count)
 * @returns MasteryStatus label
 */
export function getMasteryStatus(
  masteryScore: number,
  attempts: number
): MasteryStatus {
  // Check if effectively zero attempts (accounts for decay to near-zero)
  if (attempts < 0.01) {
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
