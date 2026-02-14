// apps/api/src/services/exams/__tests__/exam-form-builder.test.ts
import { describe, expect, it } from 'vitest';
import { buildGeneratedFullLengthFormFromPool, type QuestionRow } from '../exam-form-builder';

function q(
  canonical_id: string,
  section_code: 'RW' | 'Math',
  domain: string,
  skill: string,
  difficulty_bucket: 'easy' | 'medium' | 'hard',
  difficulty_level: number
): QuestionRow {
  return {
    canonical_id,
    section_code,
    section: section_code,
    type: 'mc',
    domain,
    skill,
    subskill: null,
    difficulty_bucket,
    difficulty_level,
    question_type: 'mc',
  };
}

function makePool(): QuestionRow[] {
  // Build enough items to satisfy module sizes.
  const out: QuestionRow[] = [];

  const rwDomains = [
    'Craft and Structure',
    'Information and Ideas',
    'Standard English Conventions',
    'Expression of Ideas',
  ];

  let c = 1;

  // RW: 60+ items across domains and buckets
  for (const d of rwDomains) {
    for (let i = 0; i < 40; i++) {
      const bucket = i < 15 ? 'easy' : i < 30 ? 'medium' : 'hard';
      out.push(q(`RW_${d}_${c++}`, 'RW', d, `skill_${i % 5}`, bucket, i + 1));
    }
  }

  // Math: 80+ items mixed domains
  const mathDomains = ['Algebra', 'Advanced Math', 'Problem Solving and Data Analysis', 'Geometry and Trigonometry'];
  for (const d of mathDomains) {
    for (let i = 0; i < 50; i++) {
      const bucket = i < 18 ? 'easy' : i < 36 ? 'medium' : 'hard';
      out.push(q(`M_${d}_${c++}`, 'Math', d, `skill_${i % 7}`, bucket, i + 1));
    }
  }

  return out;
}

it('builds correct module sizes', () => {
  const built = buildGeneratedFullLengthFormFromPool({
    seed: 'seed-1',
    constraintVersion: 1,
    questions: makePool(),
  });

  expect(built.itemsByModule.RW1).toHaveLength(27);
  expect(built.itemsByModule.RW2).toHaveLength(27);
  expect(built.itemsByModule.M1).toHaveLength(22);
  expect(built.itemsByModule.M2).toHaveLength(22);
});

it('no duplicates within RW modules and within Math modules', () => {
  const built = buildGeneratedFullLengthFormFromPool({
    seed: 'seed-1',
    constraintVersion: 1,
    questions: makePool(),
  });

  const rw = [...built.itemsByModule.RW1, ...built.itemsByModule.RW2].map((x) => x.canonicalId);
  const math = [...built.itemsByModule.M1, ...built.itemsByModule.M2].map((x) => x.canonicalId);

  expect(new Set(rw).size).toBe(rw.length);
  expect(new Set(math).size).toBe(math.length);
});

it('marks exactly 2 pretests per module', () => {
  const built = buildGeneratedFullLengthFormFromPool({
    seed: 'seed-2',
    constraintVersion: 1,
    questions: makePool(),
  });

  const countPre = (m: keyof typeof built.itemsByModule) =>
    built.itemsByModule[m].filter((x) => !x.isOperational).length;

  expect(countPre('RW1')).toBe(2);
  expect(countPre('RW2')).toBe(2);
  expect(countPre('M1')).toBe(2);
  expect(countPre('M2')).toBe(2);
});

it('R&W is grouped by domain order (non-decreasing group index)', () => {
  const built = buildGeneratedFullLengthFormFromPool({
    seed: 'seed-3',
    constraintVersion: 1,
    questions: makePool(),
  });

  const domainOrder = [
    'Craft and Structure',
    'Information and Ideas',
    'Standard English Conventions',
    'Expression of Ideas',
  ];

  for (const moduleId of ['RW1', 'RW2'] as const) {
    const domains = built.itemsByModule[moduleId].map((x) => x.domain);
    const idxs = domains.map((d) => domainOrder.indexOf(d));
    for (let i = 1; i < idxs.length; i++) {
      expect(idxs[i]).toBeGreaterThanOrEqual(idxs[i - 1]);
    }
  }
});

it('deterministic: same seed yields same blueprint', () => {
  const pool = makePool();
  const a = buildGeneratedFullLengthFormFromPool({ seed: 'seed-x', constraintVersion: 1, questions: pool });
  const b = buildGeneratedFullLengthFormFromPool({ seed: 'seed-x', constraintVersion: 1, questions: pool });

  expect(a.itemsByModule.RW1.map((x) => x.canonicalId)).toEqual(b.itemsByModule.RW1.map((x) => x.canonicalId));
  expect(a.itemsByModule.M2.map((x) => x.canonicalId)).toEqual(b.itemsByModule.M2.map((x) => x.canonicalId));
});

it('variation: different seeds yield different selection (usually)', () => {
  const pool = makePool();
  const a = buildGeneratedFullLengthFormFromPool({ seed: 'seed-a', constraintVersion: 1, questions: pool });
  const b = buildGeneratedFullLengthFormFromPool({ seed: 'seed-b', constraintVersion: 1, questions: pool });

  // Not guaranteed in pathological pools, but should differ in normal pools.
  expect(a.itemsByModule.RW1.map((x) => x.canonicalId)).not.toEqual(b.itemsByModule.RW1.map((x) => x.canonicalId));
});
