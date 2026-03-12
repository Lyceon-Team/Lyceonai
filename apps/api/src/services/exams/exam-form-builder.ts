// apps/api/src/services/exams/exam-form-builder.ts
import { seedOffset3 } from './seeded';

export type SectionCode = 'RW' | 'MATH';
export type ModuleId = 'RW1' | 'RW2' | 'M1' | 'M2';
export type QuestionDifficulty = 1 | 2 | 3;

export type QuestionRow = {
  canonical_id: string;
  section_code: string | null;
  section: string | null;
<<<<<<< HEAD
  question_type: string | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  skill_code: string | null;
  difficulty: number | null;
  status: string | null;
=======
  question_type: 'multiple_choice' | null;
  domain: string | null;
  skill: string | null;
  subskill: string | null;
  difficulty: string | null;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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
<<<<<<< HEAD
  skillCode: string | null;
  difficulty: QuestionDifficulty;
=======
  difficultyBucket: DifficultyBucket;
  difficultyLevel: number | null;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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

function normalizeSectionCode(q: QuestionRow): SectionCode | null {
  const sc = (q.section_code ?? '').trim().toUpperCase();
  if (sc === 'RW') return 'RW';
  if (sc === 'MATH') return 'MATH';

<<<<<<< HEAD
=======
  // fallback on `section` if section_code is missing/non-canonical
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  const s = (q.section ?? '').toLowerCase();
  if (s.includes('read') || s.includes('writing') || s === 'rw') return 'RW';
  if (s.includes('math')) return 'MATH';
  return null;
}

<<<<<<< HEAD
function normalizeDifficulty(q: QuestionRow): QuestionDifficulty | null {
  return q.difficulty === 1 || q.difficulty === 2 || q.difficulty === 3
    ? (q.difficulty as QuestionDifficulty)
    : null;
=======
function normalizeBucket(q: QuestionRow): DifficultyBucket | null {
  const b = (q.difficulty ?? '').trim().toLowerCase();
  if (b === 'easy' || b === 'medium' || b === 'hard') return b;
  return null;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
}

function toDifficultyLevel(bucket: DifficultyBucket): number {
  if (bucket === 'easy') return 1;
  if (bucket === 'medium') return 2;
  return 3;
}

function isEligibleBase(q: QuestionRow): boolean {
  if (!q.canonical_id) return false;
<<<<<<< HEAD
  if ((q.question_type ?? '').trim() !== 'multiple_choice') return false;
  if (!normalizeSectionCode(q)) return false;
=======
  if (q.question_type !== 'multiple_choice') return false;
  const sectionCode = normalizeSectionCode(q);
  if (!sectionCode) return false;
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  if (!q.domain || !q.skill) return false;
  if (!normalizeDifficulty(q)) return false;
  if ((q.status ?? '').trim().toLowerCase() !== 'published') return false;
  return true;
}

function sortKeyRW(q: QuestionRow): string {
  const d = normalizeDifficulty(q) ?? 999;
  const domain = q.domain ?? '';
  const domainIndex = RW_DOMAIN_ORDER.indexOf(domain as (typeof RW_DOMAIN_ORDER)[number]);
  const domRank = domainIndex >= 0 ? domainIndex : 999;
<<<<<<< HEAD
=======
  const dl = toDifficultyLevel(bucket);
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  const skill = q.skill ?? '';
  const cid = q.canonical_id ?? '';
  return `${String(domRank).padStart(3, '0')}:${String(d).padStart(1, '0')}:${skill}:${cid}`;
}

function sortKeyMath(q: QuestionRow): string {
<<<<<<< HEAD
  const d = normalizeDifficulty(q) ?? 999;
=======
  const bucket = normalizeBucket(q)!;
  const dRank = bucketRank(bucket);
  const dl = toDifficultyLevel(bucket);
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  const domain = q.domain ?? '';
  const skill = q.skill ?? '';
  const cid = q.canonical_id ?? '';
  return `${String(d).padStart(1, '0')}:${domain}:${skill}:${cid}`;
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

  const rwPool = eligible.filter((q) => normalizeSectionCode(q) === 'RW');
  const mathPool = eligible.filter((q) => normalizeSectionCode(q) === 'MATH');

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

<<<<<<< HEAD
    return picked.map((q, idx) => ({
      moduleId,
      position: idx,
      canonicalId: q.canonical_id,
      isOperational: !pretestPos.has(idx),
      sectionCode: normalizeSectionCode(q) as SectionCode,
      domain: q.domain as string,
      skill: q.skill as string,
      subskill: q.subskill ?? null,
      skillCode: q.skill_code ?? null,
      difficulty: normalizeDifficulty(q) as QuestionDifficulty,
      questionType: 'multiple_choice',
    }));
  };

=======
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

>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
  return {
    form: {
      formKind: 'generated',
      examType: 'full_length',
      constraintVersion: 1,
      selectionSeed: seed,
      warnings,
    },
    itemsByModule: {
      RW1: buildModuleItems('RW1', rw1),
      RW2: buildModuleItems('RW2', rw2),
      M1: buildModuleItems('M1', m1),
      M2: buildModuleItems('M2', m2),
    },
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
<<<<<<< HEAD
        'skill_code',
        'difficulty',
        'status',
      ].join(',')
    )
    .eq('question_type', 'multiple_choice')
    .eq('status', 'published')
=======
        'difficulty',
      ].join(',')
    )
    .eq('question_type', 'multiple_choice')
    .eq('status', 'reviewed')
>>>>>>> 3f914bde83e16f71d211c467f10d3aa174d3907f
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