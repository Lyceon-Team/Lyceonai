/**
 * True Half-Life Mastery Edge Cases Test
 * 
 * Sprint 3 PR-3: Deterministic tests for True Half-Life mastery formula edge cases.
 * 
 * Tests the mathematical properties of the exponential decay formula:
 * - decay = 0.5^(dt_days / HALF_LIFE_DAYS)
 * - E = (attempts * decay) + (event_weight * question_weight)
 * - C = (correct * decay) + (event_weight * question_weight * is_correct)
 * - p = (C + ALPHA0) / (E + ALPHA0 + BETA0)
 * - mastery_score = round(100 * p, 2)
 * 
 * EDGE CASES COVERED:
 * 1. Deep Freeze: high p + huge dt → p regresses toward prior mean
 * 2. Perfect Prodigy: 1000 correct → p approaches 1.0 (but not exactly)
 * 3. Event Weight Bias: different event weights yield equivalent p
 * 4. Underflow: single attempt + 500 days → stable, no NaN/Infinity
 */

import { describe, it, expect } from "vitest";

// Constants from DB migration (mirrored for deterministic testing)
const HALF_LIFE_DAYS = 21;
const ALPHA0 = 2;
const BETA0 = 2;
const EVENT_WEIGHTS = {
  PRACTICE_SUBMIT: 1.0,
  DIAGNOSTIC_SUBMIT: 1.25,
  FULL_LENGTH_SUBMIT: 1.5,
  TUTOR_RETRY_SUBMIT: 1.0,
};

/**
 * Simulate the True Half-Life formula locally
 * (matches the SQL logic in upsert_skill_mastery/upsert_cluster_mastery)
 */
interface SimulateParams {
  existingAttempts: number;
  existingCorrect: number;
  dtDays: number;
  eventWeight: number;
  questionWeight: number;
  isCorrect: boolean;
}

interface SimulateResult {
  E: number;
  C: number;
  p: number;
  masteryScore: number;
}

function simulateTrueHalfLife(params: SimulateParams): SimulateResult {
  const {
    existingAttempts,
    existingCorrect,
    dtDays,
    eventWeight,
    questionWeight,
    isCorrect,
  } = params;

  // Compute decay factor
  const decay = Math.pow(0.5, dtDays / HALF_LIFE_DAYS);

  // Apply exponential decay and add new evidence
  const E = existingAttempts * decay + eventWeight * questionWeight;
  const C = existingCorrect * decay + eventWeight * questionWeight * (isCorrect ? 1 : 0);

  // Compute probability with Beta priors
  const p = (C + ALPHA0) / (E + ALPHA0 + BETA0);

  // Convert to mastery_score on [0, 100] scale
  const masteryScore = Math.round(100 * p * 100) / 100; // round to 2 decimal places

  return { E, C, p, masteryScore };
}

describe("True Half-Life Mastery Edge Cases", () => {
  describe("1. Deep Freeze - Regression to Prior Mean", () => {
    it("should regress high mastery toward prior mean after huge time gap", () => {
      // Scenario: Student has 50 correct out of 50 attempts (p ≈ 0.96)
      // Then 500 days pass with no activity
      const result = simulateTrueHalfLife({
        existingAttempts: 50,
        existingCorrect: 50,
        dtDays: 500, // ~23.8 half-lives
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        questionWeight: 1.0,
        isCorrect: true,
      });

      // After 500 days, effective E and C should decay to near-zero
      // New attempt adds 1.0 to both E and C
      // With priors (ALPHA0=2, BETA0=2), p should be close to prior mean
      const priorMean = ALPHA0 / (ALPHA0 + BETA0); // = 0.5
      
      // Expected: p should be close to (1 + 2) / (1 + 2 + 2) = 0.6 (not stuck at 0.96)
      expect(result.p).toBeGreaterThan(0.5);
      expect(result.p).toBeLessThan(0.7);
      expect(result.masteryScore).toBeGreaterThan(50);
      expect(result.masteryScore).toBeLessThan(70);
      
      // Must not be NaN, Infinity, or stuck at extreme
      expect(result.p).toBeGreaterThan(0);
      expect(result.p).toBeLessThan(1);
      expect(Number.isFinite(result.p)).toBe(true);
      expect(Number.isNaN(result.p)).toBe(false);
    });

    it("should not produce NaN or Infinity even with extreme decay", () => {
      const result = simulateTrueHalfLife({
        existingAttempts: 1000,
        existingCorrect: 900,
        dtDays: 1000, // ~47.6 half-lives (decay ≈ 1.7e-14)
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        questionWeight: 1.0,
        isCorrect: false,
      });

      // After 1000 days, effective E and C are essentially zero
      // New attempt adds 1.0 to E only (incorrect)
      // p = (0 + 2) / (1 + 2 + 2) = 2/5 = 0.4
      expect(result.p).toBeCloseTo(0.4, 1);
      expect(result.masteryScore).toBeCloseTo(40, 0);
      expect(Number.isFinite(result.p)).toBe(true);
      expect(Number.isNaN(result.p)).toBe(false);
    });
  });

  describe("2. Perfect Prodigy - Asymptotic Approach to p=1", () => {
    it("should approach p=1 with 1000 correct attempts but not exactly reach it", () => {
      // Start cold, then add 1000 correct attempts
      let E = 0;
      let C = 0;
      
      // Simulate 1000 correct attempts with no time gap (dt=0, decay=1)
      for (let i = 0; i < 1000; i++) {
        E += 1.0;
        C += 1.0;
      }

      // Compute p with Beta priors
      const p = (C + ALPHA0) / (E + ALPHA0 + BETA0);
      const masteryScore = Math.round(100 * p * 100) / 100;

      // p = (1000 + 2) / (1000 + 2 + 2) = 1002/1004 ≈ 0.998
      expect(p).toBeGreaterThan(0.99);
      expect(p).toBeLessThan(1.0);
      expect(masteryScore).toBeGreaterThan(99);
      expect(masteryScore).toBeLessThan(100);

      // Verify SD/range does not collapse to exactly 0 width
      // (Beta distribution has non-zero variance even with large n)
      const variance = ((C + ALPHA0) * (E - C + BETA0)) / 
                       (Math.pow(E + ALPHA0 + BETA0, 2) * (E + ALPHA0 + BETA0 + 1));
      expect(variance).toBeGreaterThan(0);
    });

    it("should handle 1000 incorrect attempts without underflow", () => {
      let E = 0;
      let C = 0;
      
      // Simulate 1000 incorrect attempts
      for (let i = 0; i < 1000; i++) {
        E += 1.0;
        C += 0.0;
      }

      const p = (C + ALPHA0) / (E + ALPHA0 + BETA0);
      const masteryScore = Math.round(100 * p * 100) / 100;

      // p = (0 + 2) / (1000 + 2 + 2) = 2/1004 ≈ 0.002
      expect(p).toBeLessThan(0.01);
      expect(p).toBeGreaterThan(0);
      expect(masteryScore).toBeLessThan(1);
      expect(masteryScore).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(p)).toBe(true);
    });
  });

  describe("3. Event Weight Bias - Equivalent Impact", () => {
    it("should yield same p for 10 practice vs 8 diagnostic (weighted)", () => {
      // Practice: 10 correct with weight 1.0 → E=10, C=10
      const practice = simulateTrueHalfLife({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0,
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        questionWeight: 1.0,
        isCorrect: true,
      });
      
      // Simulate 9 more practice attempts
      let E_practice = practice.E;
      let C_practice = practice.C;
      for (let i = 0; i < 9; i++) {
        E_practice += 1.0;
        C_practice += 1.0;
      }
      const p_practice = (C_practice + ALPHA0) / (E_practice + ALPHA0 + BETA0);

      // Diagnostic: 8 correct with weight 1.25 → E=10, C=10
      let E_diagnostic = 0;
      let C_diagnostic = 0;
      for (let i = 0; i < 8; i++) {
        E_diagnostic += EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT * 1.0;
        C_diagnostic += EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT * 1.0;
      }
      const p_diagnostic = (C_diagnostic + ALPHA0) / (E_diagnostic + ALPHA0 + BETA0);

      // Both should yield same p (within floating point tolerance)
      expect(Math.abs(p_practice - p_diagnostic)).toBeLessThan(0.01);
    });

    it("should respect event weight differences for same attempt count", () => {
      // 5 practice correct (weight 1.0)
      const practice = {
        E: 5 * EVENT_WEIGHTS.PRACTICE_SUBMIT,
        C: 5 * EVENT_WEIGHTS.PRACTICE_SUBMIT,
      };
      const p_practice = (practice.C + ALPHA0) / (practice.E + ALPHA0 + BETA0);

      // 5 diagnostic correct (weight 1.25)
      const diagnostic = {
        E: 5 * EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT,
        C: 5 * EVENT_WEIGHTS.DIAGNOSTIC_SUBMIT,
      };
      const p_diagnostic = (diagnostic.C + ALPHA0) / (diagnostic.E + ALPHA0 + BETA0);

      // 5 full-length correct (weight 1.5)
      const fullLength = {
        E: 5 * EVENT_WEIGHTS.FULL_LENGTH_SUBMIT,
        C: 5 * EVENT_WEIGHTS.FULL_LENGTH_SUBMIT,
      };
      const p_fullLength = (fullLength.C + ALPHA0) / (fullLength.E + ALPHA0 + BETA0);

      // Higher weights → stronger evidence → p further from prior mean
      // All have 100% accuracy, so p should increase with weight
      expect(p_diagnostic).toBeGreaterThan(p_practice);
      expect(p_fullLength).toBeGreaterThan(p_diagnostic);
    });
  });

  describe("4. Underflow - Single Attempt + Long Gap", () => {
    it("should remain stable with single attempt + 500 day gap", () => {
      const result = simulateTrueHalfLife({
        existingAttempts: 1,
        existingCorrect: 1,
        dtDays: 500, // ~23.8 half-lives
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        questionWeight: 1.0,
        isCorrect: false,
      });

      // After 500 days, existing E=1, C=1 decay to near-zero
      // New attempt adds E=1, C=0 (incorrect)
      // p = (0 + 2) / (1 + 2 + 2) = 0.4
      expect(result.E).toBeCloseTo(1.0, 0); // Decayed old + new attempt ≈ 1
      expect(result.C).toBeCloseTo(0.0, 0); // Decayed old + new (incorrect) ≈ 0
      expect(result.p).toBeCloseTo(0.4, 1);
      expect(result.masteryScore).toBeCloseTo(40, 0);
      
      // Must not produce NaN, Infinity, or zombie drift
      expect(Number.isFinite(result.E)).toBe(true);
      expect(Number.isFinite(result.C)).toBe(true);
      expect(Number.isFinite(result.p)).toBe(true);
      expect(Number.isNaN(result.p)).toBe(false);
    });

    it("should handle zero existing attempts gracefully (cold start)", () => {
      const result = simulateTrueHalfLife({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 0, // Cold start, no time gap
        eventWeight: EVENT_WEIGHTS.PRACTICE_SUBMIT,
        questionWeight: 1.0,
        isCorrect: true,
      });

      // Cold start: E=1, C=1
      // p = (1 + 2) / (1 + 2 + 2) = 3/5 = 0.6
      expect(result.E).toBe(1.0);
      expect(result.C).toBe(1.0);
      expect(result.p).toBeCloseTo(0.6, 2);
      expect(result.masteryScore).toBeCloseTo(60, 0);
    });

    it("should never produce divide-by-zero with priors", () => {
      // Edge case: zero evidence + zero priors would cause division by zero
      // Our formula has ALPHA0=2, BETA0=2, so denominator is always >= 4
      const result = simulateTrueHalfLife({
        existingAttempts: 0,
        existingCorrect: 0,
        dtDays: 1000000, // Extreme decay
        eventWeight: 0.0, // Zero event weight (hypothetical)
        questionWeight: 1.0,
        isCorrect: false,
      });

      // E=0, C=0, but denominator = 0 + 2 + 2 = 4
      // p = (0 + 2) / (0 + 2 + 2) = 0.5 (prior mean)
      expect(result.p).toBeCloseTo(0.5, 2);
      expect(result.masteryScore).toBeCloseTo(50, 0);
      expect(Number.isFinite(result.p)).toBe(true);
      expect(Number.isNaN(result.p)).toBe(false);
    });
  });

  describe("5. Formula Invariants - Sanity Checks", () => {
    it("should always produce p in (0, 1) range", () => {
      const scenarios = [
        { E: 0, C: 0 },
        { E: 1, C: 0 },
        { E: 1, C: 1 },
        { E: 100, C: 0 },
        { E: 100, C: 50 },
        { E: 100, C: 100 },
        { E: 1000, C: 0 },
        { E: 1000, C: 1000 },
      ];

      for (const { E, C } of scenarios) {
        const p = (C + ALPHA0) / (E + ALPHA0 + BETA0);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(1);
        expect(Number.isFinite(p)).toBe(true);
      }
    });

    it("should produce mastery_score in [0, 100] range", () => {
      const scenarios = [
        { E: 0, C: 0 },
        { E: 1, C: 0 },
        { E: 1, C: 1 },
        { E: 100, C: 0 },
        { E: 100, C: 100 },
        { E: 1000, C: 1000 },
      ];

      for (const { E, C } of scenarios) {
        const p = (C + ALPHA0) / (E + ALPHA0 + BETA0);
        const masteryScore = Math.round(100 * p * 100) / 100;
        expect(masteryScore).toBeGreaterThanOrEqual(0);
        expect(masteryScore).toBeLessThanOrEqual(100);
      }
    });

    it("should ensure p increases monotonically with C for fixed E", () => {
      const E = 10;
      let prevP = 0;
      
      for (let C = 0; C <= E; C++) {
        const p = (C + ALPHA0) / (E + ALPHA0 + BETA0);
        expect(p).toBeGreaterThanOrEqual(prevP);
        prevP = p;
      }
    });

    it("should ensure decay factor decreases exponentially with time", () => {
      const decayFactors = [
        { days: 0, expected: 1.0 },
        { days: HALF_LIFE_DAYS, expected: 0.5 },
        { days: 2 * HALF_LIFE_DAYS, expected: 0.25 },
        { days: 3 * HALF_LIFE_DAYS, expected: 0.125 },
      ];

      for (const { days, expected } of decayFactors) {
        const decay = Math.pow(0.5, days / HALF_LIFE_DAYS);
        expect(decay).toBeCloseTo(expected, 3);
      }
    });
  });
});
