// apps/api/src/services/exams/exam-form-builder.ts
import { seedOffset3, stableSeededShuffle } from './seeded';

export type SectionCode = 'RW' | 'Math';
export type ModuleId = 'RW1' | 'RW2' | 'M1' | 'M2';
export type DifficultyBucket = 'easy' | 'medium' | 'hard';

export type QuestionRow = {
  canonical_id: string;
  section_code: string | null;
  section: string | null;
  type: string | null; // 'mc'
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  difficulty_bucket: string | null; // easy|medium|hard
  difficulty_level: number | null;
  question_type: string | null;
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
  questionType: string | null;
};

export type BuiltForm = {
  form: {
    formKind: 'generated';
    examType: 'full_length';
    constraintVersion: 1;
    selectionSeed: string;
    // Optional: for debugging / determinism proofs
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

function normalizeSectionCode(q: QuestionRow): SectionCode | null {
  const sc = (q.section_code ?? '').trim();
  if (sc === 'RW') return 'RW';
  if (sc === 'Math') return 'Math';

  // fallback on `section` if section_code is not normalized
  const s = (q.section ?? '').toLowerCase();
  if (s.includes('read') || s.includes('writing') || s === 'rw') return 'RW';
  if (s.includes('math')) return 'Math';
  return null;
}

function normalizeBucket(q: QuestionRow): DifficultyBucket | null {
  const b = (q.difficulty_bucket ?? '').trim().toLowerCase();
  if (b === 'easy' || b === 'medium' || b === 'hard') return b;
  return null;
}

function isEligibleBase(q: QuestionRow): boolean {
  if (!q.canonical_id) return false;
  if ((q.type ?? '').trim() !== 'mc') return false;
  const sectionCode = normalizeSectionCode(q);
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
  const dl = q.difficulty_level ?? 999999;
  const skill = q.skill ?? '';
  const cid = q.canonical_id ?? '';
  return `${String(domRank).padStart(3, '0')}:${String(dRank).padStart(1, '0')}:${String(dl).padStart(6, '0')}:${skill}:${cid}`;
}

function sortKeyMath(q: QuestionRow): string {
  const bucket = normalizeBucket(q)!;
  const dRank = bucketRank(bucket);
  const dl = q.difficulty_level ?? 999999;
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

  // Seeded rotation to introduce variation while preserving order constraints.
  // We rotate the ordered list by a stable offset derived from seed+tag.
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

  // Deterministic fallback: if not enough unique questions, fill from original list allowing reuse.
  if (picked.length < count) {
    warnings.push(`${tag}: insufficient unique pool (needed ${count}, got ${picked.length}); falling back to reuse`);
    // Fill remaining with deterministic stable order (no seeded shuffle here)
    for (const q of rotated) {
      if (picked.length >= count) break;
      picked.push(q);
    }
  }

  return picked.slice(0, count);
}

function markPretestPositions(n: number, seed: string, moduleId: ModuleId): Set<number> {
  // Deterministic positions near 33% and 78%, seed-adjusted by at most ±1
  const base1 = Math.floor(n * 0.33);
  const base2 = Math.floor(n * 0.78);
  const off1 = seedOffset3(seed, `${moduleId}:pre1`);
  const off2 = seedOffset3(seed, `${moduleId}:pre2`);

  const p1 = Math.min(n - 1, Math.max(0, base1 + off1));
  const p2 = Math.min(n - 1, Math.max(0, base2 + off2));

  // Ensure distinct
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

  const rwPool = eligible.filter((q) => normalizeSectionCode(q) === 'RW');
  const mathPool = eligible.filter((q) => normalizeSectionCode(q) === 'Math');

  // Order pools deterministically
  const rwOrdered = rwPool.slice().sort((a, b) => sortKeyRW(a).localeCompare(sortKeyRW(b)));
  const mathOrdered = mathPool.slice().sort((a, b) => sortKeyMath(a).localeCompare(sortKeyMath(b)));

  // Enforce uniqueness across modules within a section
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
      const sectionCode = normalizeSectionCode(q)!;
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
        difficultyLevel: q.difficulty_level ?? null,
        questionType: q.question_type ?? null,
      };
    });
  };

  const itemsByModule: BuiltForm['itemsByModule'] = {
    RW1: buildModuleItems('RW1', rw1),
    RW2: buildModuleItems('RW2', rw2),
    M1: buildModuleItems('M1', m1),
    M2: buildModuleItems('M2', m2),
  };

  // Extra deterministic "tie shuffle" within exact ties (optional):
  // If you want to lightly de-correlate repeated tests while staying deterministic,
  // you can shuffle within equal sort-key groups. For v1, we keep it simple.

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
        'type',
        'domain',
        'skill',
        'subskill',
        'difficulty_bucket',
        'difficulty_level',
        'question_type',
      ].join(',')
    )
    .eq('type', 'mc')
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
