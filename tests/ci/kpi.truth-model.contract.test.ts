import { describe, it, expect } from 'vitest';
import {
  buildStudentKpiView,
  buildFullTestKpis,
  fullTestMeasurementModel,
  type CanonicalPracticeKpiSnapshot,
} from '../../server/services/kpi-truth-layer';

function assertDisjoint(groups: Record<string, string[]>) {
  const seen = new Map<string, string>();
  for (const [group, ids] of Object.entries(groups)) {
    for (const id of ids) {
      const prior = seen.get(id);
      if (prior) {
        throw new Error(`metric ${id} appears in both ${prior} and ${group}`);
      }
      seen.set(id, group);
    }
  }
}

describe('KPI Truth Model Contract', () => {
  const snapshot: CanonicalPracticeKpiSnapshot = {
    modelVersion: 'kpi_truth_v1',
    timezone: 'America/Chicago',
    generatedAt: '2026-03-10T00:00:00.000Z',
    currentWeek: {
      practiceSessions: 4,
      practiceMinutes: 120,
      questionsSolved: 72,
      accuracyPercent: 68,
      avgSecondsPerQuestion: 81.4,
    },
    previousWeek: {
      practiceSessions: 2,
      practiceMinutes: 60,
      questionsSolved: 30,
      accuracyPercent: 54,
      avgSecondsPerQuestion: 96.2,
    },
    recency200: {
      totalAttempts: 180,
      accuracyPercent: 66,
      avgSecondsPerQuestion: 84.1,
    },
  };

  it('ensures every user-facing student KPI carries explanation contract fields', () => {
    const view = buildStudentKpiView(snapshot, true);

    expect(view.metrics.length).toBeGreaterThan(0);
    for (const metric of view.metrics) {
      expect(metric.explanation.ruleId).toBeTruthy();
      expect(metric.explanation.whatThisMeans).toBeTruthy();
      expect(metric.explanation.whyThisChanged).toBeTruthy();
      expect(metric.explanation.whatToDoNext).toBeTruthy();
    }

    assertDisjoint(view.measurementModel);
  });

  it('removes historical trend surface for free-tier view output', () => {
    const view = buildStudentKpiView(snapshot, false);

    expect(view.recency).toBeNull();
    expect(view.gating.historicalTrends.allowed).toBe(false);
    expect(view.gating.historicalTrends.requiredPlan).toBe('paid');
  });

  it('separates full-test official, weighted, and diagnostic metrics without conflation', () => {
    const model = fullTestMeasurementModel();
    const kpis = buildFullTestKpis({
      scaledTotal: 1090,
      scaledRw: 550,
      scaledMath: 540,
      totalCorrect: 37,
      totalQuestions: 98,
    });

    assertDisjoint(model);

    const metricById = new Map(kpis.map((metric) => [metric.id, metric]));

    expect(metricById.get('official_sat_score')?.value).toBeNull();
    expect(metricById.get('estimated_scaled_total')?.value).toBe(1090);
    expect(metricById.get('estimated_scaled_rw')?.value).toBe(550);
    expect(metricById.get('estimated_scaled_math')?.value).toBe(540);
    expect(metricById.get('diagnostic_accuracy')?.value).toBe(38);

    for (const id of [...model.official, ...model.weighted, ...model.diagnostic]) {
      expect(metricById.has(id)).toBe(true);
      const metric = metricById.get(id)!;
      expect(metric.explanation.whatThisMeans).toBeTruthy();
      expect(metric.explanation.whyThisChanged).toBeTruthy();
      expect(metric.explanation.whatToDoNext).toBeTruthy();
    }
  });
});

