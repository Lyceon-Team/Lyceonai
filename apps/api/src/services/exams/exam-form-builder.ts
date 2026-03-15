// apps/api/src/services/exams/exam-form-builder.ts
import { seedOffset3 } from './seeded';
import { normalizeSectionCode as normalizeCanonicalSectionCode } from '../../../../../shared/question-bank-contract';

export type SectionCode = 'RW' | 'MATH';
export type ModuleId = 'RW1' | 'RW2' | 'M1' | 'M2';
export type DifficultyBucket = 'easy' | 'medium' | 'hard';

export type QuestionRow = {
  canonical_id: string;
  section_code: string | null;
  section: string | null;
  question_type: 'multiple_choice' | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  difficulty: string | null;
};

export type BuiltFormItem = {
  moduleId: ModuleId;
  position: number;
  canonicalId: string;
  isOperational: boolean;
  sectionCode: SectionCode;
  domain: string;
  skill: string;
  subskill: string | null;
  difficultyBucket: DifficultyBucket;
  difficultyLevel: number | null;
  questionType: 'multiple_choice';
};

export type BuiltForm = {
  form: {
    formKind: 'generated';
    examType: 'full_length';
    constraintVersion: 1;
    selectionSeed: string;
    warnings: string[];
  };
  itemsByModule: Record<ModuleId, BuiltFormItem[]>;
};

const RW_DOMAIN_ORDER = [
  'Craft and Structure',
  'Information and Ideas',
  'Standard English Conventions',
  'Expression of Ideas',
] as const;

function bucketRank(b: DifficultyBucket): number {
  if (b === 'easy') return 1;
  if (b === 'medium') return 2;
  return 3;
}

function normalizeExamSectionCode(q: QuestionRow): SectionCode | null {
  const normalized = normalizeCanonicalSectionCode(q.section_code ?? q.section ?? null);
  if (!normalized) return null;
  return normalized === 'M' ? 'MATH' : 'RW';
}

function normalizeBucket(q: QuestionRow): DifficultyBucket | null {
  const b = (q.difficulty ?? '').trim().toLowerCase();
  if (b === 'easy' || b === 'medium' || b === 'hard') return b;
  return null;
}

function toDifficultyLevel(bucket: DifficultyBucket): number {
  if (bucket === 'easy') return 1;
  if (bucket === 'medium') return 2;
  return 3;
}

function isEligibleBase(q: QuestionRow): boolean {
  if (!q.canonical_id) return false;
  if (q.question_type !== 'multiple_choice') return false;
  const sectionCode = normalizeExamSectionCode(q);
  if (!sectionCode) return false;
  if (!q.domain || !q.skill) return false;
  const b = normalizeBucket(q);
  if (!b) return false;
  return true;
}

function sortKeyRW(q: QuestionRow): string {
  const bucket = normalizeBucket(q)!;
  const dRank = bucketRank(bucket);
  const domain = q.domain ?? '';
  const domainIndex = RW_DOMAIN_ORDER.indexOf(domain as any);
  const domRank = domainIndex >= 0 ? domainIndex : 999;
  const dl = toDifficultyLevel(bucket);
  const skill = q.skill ?? '';
  const cid = q.canonical_id ?? '';
  return `${String(domRank).padStart(3, '0')}:${String(dRank).padStart(1, '0')}:${String(dl).padStart(6, '0')}:${skill}:${cid}`;
}

function sortKeyMath(q: QuestionRow): string {
  const bucket = normalizeBucket(q)!;
  const dRank = bucketRank(bucket);
  const dl = toDifficultyLevel(bucket);
  const domain = q.domain ?? '';
  const skill = q.skill ?? '';
  const cid = q.canonical_id ?? '';
  return `${String(dRank).padStart(1, '0')}:${String(dl).padStart(6, '0')}:${domain}:${skill}:${cid}`;
}

function pickDistinct(
  ordered: QuestionRow[],
  count: number,
  seed: string,
  tag: string,
  alreadyUsed: Set<string>,
  warnings: string[]
): QuestionRow[] {
  if (ordered.length === 0) {
    warnings.push(`${tag}: empty eligible pool`);
    return [];
  }

  const rot = Math.abs(seedOffset3(seed, tag)) % ordered.length;
  const rotated = ordered.slice(rot).concat(ordered.slice(0, rot));

  const picked: QuestionRow[] = [];
  for (const q of rotated) {
    if (picked.length >= count) break;
    const cid = q.canonical_id;
    if (alreadyUsed.has(cid)) continue;
    picked.push(q);
    alreadyUsed.add(cid);
  }

  if (picked.length < count) {
    warnings.push(`${tag}: insufficient unique pool (needed ${count}, got ${picked.length}); falling back to reuse`);
    for (const q of rotated) {
      if (picked.length >= count) break;
      picked.push(q);
    }
  }

  return picked.slice(0, count);
}

function markPretestPositions(n: number, seed: string, moduleId: ModuleId): Set<number> {
  const base1 = Math.floor(n * 0.33);
  const base2 = Math.floor(n * 0.78);
  const off1 = seedOffset3(seed, `${moduleId}:pre1`);
  const off2 = seedOffset3(seed, `${moduleId}:pre2`);

  const p1 = Math.min(n - 1, Math.max(0, base1 + off1));
  const p2 = Math.min(n - 1, Math.max(0, base2 + off2));

  if (p1 === p2) {
    const alt = Math.min(n - 1, p2 + 1);
    return new Set([p1, alt]);
  }
  return new Set([p1, p2]);
}

export function buildGeneratedFullLengthFormFromPool(args: {
  seed: string;
  constraintVersion: 1;
  questions: QuestionRow[];
}): BuiltForm {
  const { seed, questions } = args;

  const warnings: string[] = [];

  const eligible = questions.filter(isEligibleBase);

  const rwPool = eligible.filter((q) => normalizeExamSectionCode(q) === 'RW');
  const mathPool = eligible.filter((q) => normalizeExamSectionCode(q) === 'MATH');

  const rwOrdered = rwPool.slice().sort((a, b) => sortKeyRW(a).localeCompare(sortKeyRW(b)));
  const mathOrdered = mathPool.slice().sort((a, b) => sortKeyMath(a).localeCompare(sortKeyMath(b)));

  const usedRW = new Set<string>();
  const usedMath = new Set<string>();

  const RW_COUNT = 27;
  const M_COUNT = 22;

  const rw1 = pickDistinct(rwOrdered, RW_COUNT, seed, 'RW1', usedRW, warnings);
  const rw2 = pickDistinct(rwOrdered, RW_COUNT, seed, 'RW2', usedRW, warnings);

  const m1 = pickDistinct(mathOrdered, M_COUNT, seed, 'M1', usedMath, warnings);
  const m2 = pickDistinct(mathOrdered, M_COUNT, seed, 'M2', usedMath, warnings);

  const buildModuleItems = (moduleId: ModuleId, picked: QuestionRow[]): BuiltFormItem[] => {
    const pretestPos = markPretestPositions(picked.length, seed, moduleId);

    return picked.map((q, idx) => {
      const sectionCode = normalizeExamSectionCode(q)!;
      const diff = normalizeBucket(q)!;
      return {
        moduleId,
        position: idx,
        canonicalId: q.canonical_id,
        isOperational: !pretestPos.has(idx),
        sectionCode,
        domain: q.domain!,
        skill: q.skill!,
        subskill: q.subskill ?? null,
        difficultyBucket: diff,
        difficultyLevel: toDifficultyLevel(diff),
        questionType: 'multiple_choice',
      };
    });
  };

  const itemsByModule: BuiltForm['itemsByModule'] = {
    RW1: buildModuleItems('RW1', rw1),
    RW2: buildModuleItems('RW2', rw2),
    M1: buildModuleItems('M1', m1),
    M2: buildModuleItems('M2', m2),
  };

  return {
    form: {
      formKind: 'generated',
      examType: 'full_length',
      constraintVersion: 1,
      selectionSeed: seed,
      warnings,
    },
    itemsByModule,
  };
}

/**
 * Fetch eligible questions for exam generation (server-side only).
 * The passed client must already be authenticated as service role (server).
 */
export async function fetchEligibleQuestionsForExam(supabaseServer: any): Promise<QuestionRow[]> {
  const { data, error } = await supabaseServer
    .from('questions')
    .select(
      [
        'canonical_id',
        'section_code',
        'section',
        'question_type',
        'domain',
        'skill',
        'subskill',
        'difficulty',
      ].join(',')
    )
    .eq('question_type', 'multiple_choice')
    .eq('status', 'published')
    .not('canonical_id', 'is', null);

  if (error) throw new Error(`fetchEligibleQuestionsForExam failed: ${error.message}`);
  return (data ?? []) as QuestionRow[];
}

/**
 * Main entry: builds a generated full-length form from DB.
 */
export async function buildGeneratedFullLengthForm(args: {
  seed: string;
  constraintVersion: 1;
  supabaseServer: any;
}): Promise<BuiltForm> {
  const pool = await fetchEligibleQuestionsForExam(args.supabaseServer);
  return buildGeneratedFullLengthFormFromPool({
    seed: args.seed,
    constraintVersion: args.constraintVersion,
    questions: pool,
  });
}
