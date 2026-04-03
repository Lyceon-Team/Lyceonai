import { describe, it, expect } from 'vitest';
import { calculateScore } from '../../server/services/score-projection';

describe('Score Estimate Contract', () => {
  it('returns deterministic estimate range for empty mastery input', () => {
    const result = calculateScore([], 0);

    expect(result.composite).toBe(400);
    expect(result.math).toBe(200);
    expect(result.rw).toBe(200);
    expect(result.range).toEqual({ low: 400, high: 500 });
    expect(result.confidence).toBe(0.5);
  });
});
