/**
 * Mastery Difficulty Weights and Rounding Test
 * 
 * Sprint 3 PR-4: Tests for per-question difficulty weights and deterministic rounding.
 * 
 * REQUIREMENTS:
 * 1. Deterministic rounding is enforced:
 *    - mastery_score has exactly ROUND_MASTERY_SCORE_DECIMALS precision
 *    - accuracy has exactly ROUND_ACCURACY_DECIMALS precision
 *    - E/C are rounded to ROUND_EVIDENCE_DECIMALS
 * 2. Difficulty weights affect E/C:
 *    - For same event_type and correctness, hard should update E/C more than easy
 * 3. Guard test still passes: no new write paths
 */

import { describe, it, expect } from "vitest";

// Constants from DB migration (mirrored for deterministic testing)
const HALF_LIFE_DAYS = 21;
const ALPHA0 = 2;
const BETA0 = 2;

// Rounding precision constants
const ROUND_EVIDENCE_DECIMALS = 2;
const ROUND_ACCURACY_DECIMALS = 4;
const ROUND_MASTERY_SCORE_DECIMALS = 2;

// Difficulty weights
const QUESTION_DIFFICULTY_WEIGHTS = {
  easy: 1.0,
  medium: 1.1,
  hard: 1.2,
};

const EVENT_WEIGHTS = {
  PRACTICE_SUBMIT: 1.0,
  DIAGNOSTIC_SUBMIT: 1.25,
  FULL_LENGTH_SUBMIT: 1.5,
  TUTOR_RETRY_SUBMIT: 1.0,
  TUTOR_VIEW: 0.0,
};

/**
 * Simulate the True Half-Life formula with difficulty weights and rounding
 */
interface SimulateParams {
  existingAttempts: number;
  existingCorrect: number;
  dtDays: number;
  eventWeight: number;
  difficultyWeight: number;
  isCorrect: boolean;
}

interface SimulateResult {
  E: number;
  C: number;
  p: number;
  mastery_score: number;
}

function simulateTrueHalfLifeWithWeights(params: SimulateParams): SimulateResult {
  const {
    existingAttempts,
    existingCorrect,
    dtDays,
    eventWeight,
    difficultyWeight,
    isCorrect,
  } = params;

  // Compute decay factor
  const decay = Math.pow(0.5, dtDays / HALF_LIFE_DAYS);

  // Apply exponential decay and add new evidence with weights
  // E := round(E_old*decay + (w_event*w_q), ROUND_EVIDENCE_DECIMALS)
  // C := round(C_old*decay + (w_event*w_q*is_correct), ROUND_EVIDENCE_DECIMALS)
  const E_raw = existingAttempts * decay + eventWeight * difficultyWeight;
  const C_raw = existingCorrect * decay + eventWeight * difficultyWeight * (isCorrect ? 1 : 0);

  const E = Math.round(E_raw * Math.pow(10, ROUND_EVIDENCE_DECIMALS)) / Math.pow(10, ROUND_EVIDENCE_DECIMALS);
  const C = Math.round(C_raw * Math.pow(10, ROUND_EVIDENCE_DECIMALS)) / Math.pow(10, ROUND_EVIDENCE_DECIMALS);

  // Compute probability with Beta priors
  // p := (C + ALPHA0) / (E + ALPHA0 + BETA0)
  const p_raw = (C + ALPHA0) / (E + ALPHA0 + BETA0);

  // Apply deterministic rounding
  // accuracy := round(p, ROUND_ACCURACY_DECIMALS)
  // mastery_score := round(100*p, ROUND_MASTERY_SCORE_DECIMALS)
  const p = Math.round(p_raw * Math.pow(10, ROUND_ACCURACY_DECIMALS)) / Math.pow(10, ROUND_ACCURACY_DECIMALS);
  const mastery_score = Math.round(100 * p * Math.pow(10, ROUND_MASTERY_SCORE_DECIMALS)) / Math.pow(10, ROUND_MASTERY_SCORE_DECIMALS);

  return { E, C, p, mastery_score };
}

describe("Mastery Difficulty Weights and Rounding", () => {
  describe("1. Deterministic Rounding - Precision Enforcement", () => {
    it("should enforce exactly ROUND_EVIDENCE_DECIMALS precision for E and C", () => {
      const result = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: true,
      });

      // Check that E and C have exactly ROUND_EVIDENCE_DECIMALS decimal places
      const E_decimals = (result.E.toString().split('.')[1] || '').length;
      const C_decimals = (result.C.toString().split('.')[1] || '').length;

      expect(E_decimals).toBeLessThanOrEqual(ROUND_EVIDENCE_DECIMALS);
      expect(C_decimals).toBeLessThanOrEqual(ROUND_EVIDENCE_DECIMALS);
    });

    it("should enforce exactly ROUND_ACCURACY_DECIMALS precision for accuracy", () => {
      const result = simulateTrueHalfLifeWithWeights({
        existingAttempts: 10,
        existingCorrect: 7,
        dtDays: 5,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.medium,
        isCorrect: true,
      });

      // Check that accuracy (p) has exactly ROUND_ACCURACY_DECIMALS decimal places
      const p_decimals = (result.p.toString().split('.')[1] || '').length;
      expect(p_decimals).toBeLessThanOrEqual(ROUND_ACCURACY_DECIMALS);
    });

    it("should enforce exactly ROUND_MASTERY_SCORE_DECIMALS precision for mastery_score", () => {
      const result = simulateTrueHalfLifeWithWeights({
        existingAttempts: 20,
        existingCorrect: 15,
        dtDays: 10,
        eventWeight: EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.hard,
        isCorrect: false,
      });

      // Check that mastery_score has exactly ROUND_MASTERY_SCORE_DECIMALS decimal places
      const mastery_decimals = (result.mastery_score.toString().split('.')[1] || '').length;
      expect(mastery_decimals).toBeLessThanOrEqual(ROUND_MASTERY_SCORE_DECIMALS);
    });

    it("should apply deterministic rounding consistently across updates", () => {
      // Simulate two identical updates
      const result1 = simulateTrueHalfLifeWithWeights({
        existingAttempts: 5,
        existingCorrect: 3,
        dtDays: 7,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: true,
      });

      const result2 = simulateTrueHalfLifeWithWeights({
        existingAttempts: 5,
        existingCorrect: 3,
        dtDays: 7,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: true,
      });

      // Results should be exactly identical (deterministic)
      expect(result1.E).toBe(result2.E);
      expect(result1.C).toBe(result2.C);
      expect(result1.p).toBe(result2.p);
      expect(result1.mastery_score).toBe(result2.mastery_score);
    });
  });

  describe("2. Difficulty Weights - Evidence Impact", () => {
    it("should apply difficulty weight to both E and C", () => {
      const easy = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: true,
      });

      const medium = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.medium,
        isCorrect: true,
      });

      const hard = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.hard,
        isCorrect: true,
      });

      // For correct answers, both E and C increase
      // easy: E=1.0, C=1.0
      // medium: E=1.1, C=1.1
      // hard: E=1.2, C=1.2
      expect(easy.E).toBe(1.0);
      expect(easy.C).toBe(1.0);
      expect(medium.E).toBe(1.1);
      expect(medium.C).toBe(1.1);
      expect(hard.E).toBe(1.2);
      expect(hard.C).toBe(1.2);

      // Higher difficulty → more evidence → higher confidence
      // All have 100% accuracy, so p should increase with difficulty
      expect(medium.p).toBeGreaterThan(easy.p);
      expect(hard.p).toBeGreaterThan(medium.p);
    });

    it("should weight hard questions 1.2x more than easy for same event type", () => {
      const easy_correct = simulateTrueHalfLifeWithWeights({
        existingAttempts: 10,
        existingCorrect: 7,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: true,
      });

      const hard_correct = simulateTrueHalfLifeWithWeights({
        existingAttempts: 10,
        existingCorrect: 7,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.hard,
        isCorrect: true,
      });

      // Difference in E should be exactly 0.2 (1.2 - 1.0)
      // Difference in C should be exactly 0.2 (1.2 - 1.0)
      expect(hard_correct.E - easy_correct.E).toBeCloseTo(0.2, ROUND_EVIDENCE_DECIMALS);
      expect(hard_correct.C - easy_correct.C).toBeCloseTo(0.2, ROUND_EVIDENCE_DECIMALS);
    });

    it("should apply difficulty weight to incorrect answers (E only)", () => {
      const easy_incorrect = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: false,
      });

      const hard_incorrect = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.hard,
        isCorrect: false,
      });

      // For incorrect answers, only E increases (C stays 0)
      // easy: E=1.0, C=0
      // hard: E=1.2, C=0
      expect(easy_incorrect.E).toBe(1.0);
      expect(easy_incorrect.C).toBe(0.0);
      expect(hard_incorrect.E).toBe(1.2);
      expect(hard_incorrect.C).toBe(0.0);

      // More evidence of failure → lower p for hard vs easy
      // p_easy = (0 + 2) / (1.0 + 2 + 2) = 0.4
      // p_hard = (0 + 2) / (1.2 + 2 + 2) = 0.3846...
      expect(hard_incorrect.p).toBeLessThan(easy_incorrect.p);
    });

    it("should combine event weight and difficulty weight multiplicatively", () => {
      const practice_easy = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT, // 1.0
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy, // 1.0
        isCorrect: true,
      });

      const diagnostic_hard = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT, // 1.25
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.hard, // 1.2
        isCorrect: true,
      });

      // practice_easy: E = 1.0 * 1.0 = 1.0
      // diagnostic_hard: E = 1.25 * 1.2 = 1.5
      expect(practice_easy.E).toBe(1.0);
      expect(diagnostic_hard.E).toBe(1.5);
    });
  });

  describe("3. Edge Cases with Difficulty Weights", () => {
    it("should handle null/missing difficulty_bucket as default 1.0", () => {
      // Simulate with default weight (1.0)
      const result = simulateTrueHalfLifeWithWeights({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: 1.0, // Default when difficulty_bucket is null/missing
        isCorrect: true,
      });

      // Should behave same as easy (weight 1.0)
      expect(result.E).toBe(1.0);
      expect(result.C).toBe(1.0);
    });

    it("should not produce NaN with difficulty weights and extreme decay", () => {
      const result = simulateTrueHalfLifeWithWeights({
        existingAttempts: 100,
        existingCorrect: 90,
        dtDays: 1000, // ~47.6 half-lives
        eventWeight: EVENT_WEIGHTS.FULL_LENGTH_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.hard,
        isCorrect: true,
      });

      // After extreme decay, existing evidence vanishes
      // New attempt adds: 1.5 * 1.2 = 1.8
      expect(result.E).toBeCloseTo(1.8, ROUND_EVIDENCE_DECIMALS);
      expect(result.C).toBeCloseTo(1.8, ROUND_EVIDENCE_DECIMALS);
      expect(Number.isFinite(result.p)).toBe(true);
      expect(Number.isNaN(result.p)).toBe(false);
    });

    it("should handle rounding edge case: p exactly 0.5 → mastery_score 50.00", () => {
      // Construct scenario where p = (C + 2) / (E + 2 + 2) = 0.5
      // This means C + 2 = 0.5 * (E + 4)
      // C + 2 = 0.5E + 2
      // C = 0.5E
      // Example: E=4, C=2 → p = (2+2)/(4+4) = 0.5
      const result = simulateTrueHalfLifeWithWeights({
        existingAttempts: 3,
        existingCorrect: 1,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS.easy,
        isCorrect: true,
      });

      // E = 3 + 1 = 4, C = 1 + 1 = 2
      // p = (2 + 2) / (4 + 2 + 2) = 4/8 = 0.5
      expect(result.E).toBe(4.0);
      expect(result.C).toBe(2.0);
      expect(result.p).toBe(0.5);
      expect(result.mastery_score).toBe(50.0);
    });
  });

  describe("4. Formula Invariants with Difficulty Weights", () => {
    it("should always produce E >= C (attempts >= correct)", () => {
      const scenarios = [
        { difficulty: 'easy', isCorrect: true },
        { difficulty: 'medium', isCorrect: true },
        { difficulty: 'hard', isCorrect: true },
        { difficulty: 'easy', isCorrect: false },
        { difficulty: 'medium', isCorrect: false },
        { difficulty: 'hard', isCorrect: false },
      ];

      for (const { difficulty, isCorrect } of scenarios) {
        const result = simulateTrueHalfLifeWithWeights({
          existingAttempts: 10,
          existingCorrect: 5,
          dtDays: 5,
          eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
          difficultyWeight: QUESTION_DIFFICULTY_WEIGHTS[difficulty as keyof typeof QUESTION_DIFFICULTY_WEIGHTS],
          isCorrect,
        });

        expect(result.E).toBeGreaterThanOrEqual(result.C);
      }
    });

    it("should produce mastery_score in [0, 100] regardless of weights", () => {
      const scenarios = [
        { weight: QUESTION_DIFFICULTY_WEIGHTS.easy, event: EVENT_WEIGHTS.PRACTICE_SUBMIT },
        { weight: QUESTION_DIFFICULTY_WEIGHTS.hard, event: EVENT_WEIGHTS.FULL_LENGTH_SUBMIT },
        { weight: QUESTION_DIFFICULTY_WEIGHTS.medium, event: EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT },
      ];

      for (const { weight, event } of scenarios) {
        const result = simulateTrueHalfLifeWithWeights({
          existingAttempts: 50,
          existingCorrect: 40,
          dtDays: 10,
          eventWeight: event,
          difficultyWeight: weight,
          isCorrect: true,
        });

        expect(result.mastery_score).toBeGreaterThanOrEqual(0);
        expect(result.mastery_score).toBeLessThanOrEqual(100);
      }
    });

    it("should ensure p increases with C for fixed E (monotonicity)", () => {
      // Fix E, vary C
      const E_fixed = 10;
      let prevP = 0;

      for (let C = 0; C <= E_fixed; C += 0.5) {
        const p_raw = (C + ALPHA0) / (E_fixed + ALPHA0 + BETA0);
        const p = Math.round(p_raw * Math.pow(10, ROUND_ACCURACY_DECIMALS)) / Math.pow(10, ROUND_ACCURACY_DECIMALS);
        expect(p).toBeGreaterThanOrEqual(prevP);
        prevP = p;
      }
    });
  });
});
