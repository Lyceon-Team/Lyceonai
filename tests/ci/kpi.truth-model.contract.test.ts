import { describe, it, expect } from 'vitest';
import {
  buildFullTestKpis,
  fullTestMeasurementModel,
} from '../../server/services/canonical-runtime-views';

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
      expect(metric.explanation.whatThisMeans).toEqual(expect.stringMatching(/\S/));
      expect(metric.explanation.whyThisChanged).toEqual(expect.stringMatching(/\S/));
      expect(metric.explanation.whatToDoNext).toEqual(expect.stringMatching(/\S/));
    }
  });
});
