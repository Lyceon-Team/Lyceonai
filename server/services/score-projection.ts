/**
 * Score Projection Engine
 * 
 * DERIVED COMPUTATION MODULE - READ ONLY
 * 
 * This module computes DERIVED SAT score projections from STORED mastery data.
 * It does NOT:
 * - Write to mastery tables
 * - Recalculate mastery_score (uses stored values from student_skill_mastery)
 * - Mutate any mastery state
 * 
 * WHAT IT DOES:
 * - Applies recency decay to stored mastery scores (for projection accuracy)
 * - Weights domains using College Board weights
 * - Projects SAT scores with confidence intervals
 * 
 * SOURCE OF TRUTH: student_skill_mastery table (written by mastery-write.ts)
 * 
 * Implements College Board domain weights for SAT score projection
 * with recency decay and cube root confidence intervals.
 */

const SCORING_MODEL = {
  baseScore: 400, // 200 per section min
  rangePerSection: 600, // 800 max - 200 min
  
  weights: {
    math: {
      'algebra': 0.35,
      'advanced_math': 0.35,
      'problem_solving': 0.15,
      'geometry': 0.15
    },
    rw: {
      'craft_structure': 0.28,
      'information_ideas': 0.26,
      'standard_english': 0.26,
      'expression_ideas': 0.20
    }
  }
};

const DECAY_RATE = 0.95;

export interface DomainMastery {
  domain: string;
  section: 'math' | 'rw';
  mastery_score: number;
  attempts: number;
  last_activity?: Date | string | null;
}

export interface ScoreProjection {
  composite: number;
  math: number;
  rw: number;
  range: {
    low: number;
    high: number;
  };
  confidence: number;
  breakdown: {
    math: DomainBreakdown[];
    rw: DomainBreakdown[];
  };
}

interface DomainBreakdown {
  domain: string;
  weight: number;
  rawMastery: number;
  decayedMastery: number;
  contribution: number;
}

/**
 * Apply recency decay to mastery score based on weeks inactive
 * 
 * DERIVED COMPUTATION: This applies a decay factor for projection purposes.
 * It does NOT mutate stored mastery_score in the database.
 * 
 * Decay_Factor = 0.95 ^ Weeks_Inactive
 */
function applyRecencyDecay(mastery: number, lastActivity: Date | string | null | undefined): number {
  if (!lastActivity) {
    return mastery;
  }
  
  const lastDate = typeof lastActivity === 'string' ? new Date(lastActivity) : lastActivity;
  const now = new Date();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const weeksInactive = Math.floor((now.getTime() - lastDate.getTime()) / msPerWeek);
  
  if (weeksInactive <= 0) {
    return mastery;
  }
  
  const decayFactor = Math.pow(DECAY_RATE, weeksInactive);
  return mastery * decayFactor;
}

/**
 * Calculate cube root variance for confidence interval
 * Variance = 100 / Math.cbrt(totalQuestions)
 */
function calculateVariance(totalQuestions: number): number {
  if (totalQuestions <= 0) {
    return 100;
  }
  return 100 / Math.cbrt(totalQuestions);
}

/**
 * Calculate projected SAT score from mastery data
 * 
 * DERIVED COMPUTATION: Projects SAT score from STORED mastery data.
 * Does NOT recalculate or mutate stored mastery_score values.
 * 
 * Algorithm:
 * 1. Group mastery by domain with recency decay applied (for projection only)
 * 2. Apply College Board weights: Section_Mastery = Sum(Domain_Mastery * Domain_Weight)
 * 3. Calculate raw score: Projected = 200 + (600 * Section_Mastery)
 * 4. Apply cube root variance for confidence intervals
 */
export function calculateScore(masteryData: DomainMastery[], totalQuestions: number): ScoreProjection {
  const mathBreakdown: DomainBreakdown[] = [];
  const rwBreakdown: DomainBreakdown[] = [];
  
  let mathWeightedSum = 0;
  let rwWeightedSum = 0;
  let mathTotalWeight = 0;
  let rwTotalWeight = 0;

  const mathWeights = SCORING_MODEL.weights.math as Record<string, number>;
  const rwWeights = SCORING_MODEL.weights.rw as Record<string, number>;

  for (const domain of Object.keys(mathWeights)) {
    const weight = mathWeights[domain];
    const domainData = masteryData.find(m => m.section === 'math' && m.domain === domain);
    
    const rawMastery = domainData?.mastery_score ?? 0;
    const decayedMastery = domainData 
      ? applyRecencyDecay(rawMastery, domainData.last_activity)
      : 0;
    const contribution = decayedMastery * weight;
    
    mathWeightedSum += contribution;
    mathTotalWeight += weight;
    
    mathBreakdown.push({
      domain,
      weight,
      rawMastery,
      decayedMastery,
      contribution
    });
  }

  for (const domain of Object.keys(rwWeights)) {
    const weight = rwWeights[domain];
    const domainData = masteryData.find(m => m.section === 'rw' && m.domain === domain);
    
    const rawMastery = domainData?.mastery_score ?? 0;
    const decayedMastery = domainData 
      ? applyRecencyDecay(rawMastery, domainData.last_activity)
      : 0;
    const contribution = decayedMastery * weight;
    
    rwWeightedSum += contribution;
    rwTotalWeight += weight;
    
    rwBreakdown.push({
      domain,
      weight,
      rawMastery,
      decayedMastery,
      contribution
    });
  }

  const mathMastery = mathTotalWeight > 0 ? mathWeightedSum / mathTotalWeight : 0;
  const rwMastery = rwTotalWeight > 0 ? rwWeightedSum / rwTotalWeight : 0;

  const mathScore = Math.round(200 + (600 * mathMastery));
  const rwScore = Math.round(200 + (600 * rwMastery));
  const compositeScore = mathScore + rwScore;

  const variance = calculateVariance(totalQuestions);
  const rangeLow = Math.max(400, Math.round(compositeScore - variance));
  const rangeHigh = Math.min(1600, Math.round(compositeScore + variance));

  const confidence = totalQuestions >= 100 ? 0.95 
    : totalQuestions >= 50 ? 0.85 
    : totalQuestions >= 20 ? 0.70 
    : 0.50;

  return {
    composite: compositeScore,
    math: mathScore,
    rw: rwScore,
    range: {
      low: rangeLow,
      high: rangeHigh
    },
    confidence,
    breakdown: {
      math: mathBreakdown,
      rw: rwBreakdown
    }
  };
}

export { SCORING_MODEL, DECAY_RATE };
