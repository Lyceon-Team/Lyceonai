import type { GeneratedQuestionDraft, QaResult, PdfStyleRef } from "../types";
import { validateQuestionRow } from "../../ingestion/types/supabaseQuestionsRow";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { 
  generateCanonicalId, 
  mapSectionToCode, 
  type TestCode, 
  type SectionCode 
} from "../../lib/canonicalId";
import type { MathDomain, DifficultyLevel } from "../types/schemas";

export interface V4Provenance {
  jobId: string;
  draftId: string;
  styleRefsUsed: PdfStyleRef[];
  inspirationQuestionIds: string[] | null;
  model: string;
  createdAt: string;
}

export interface PublishResult {
  canonical_id: string;
  questions_id?: string;
}

interface DraftRecord {
  id: string;
  job_id: string;
  draft: GeneratedQuestionDraft;
  qa: QaResult | null;
  qa_ok: boolean;
  style_refs_used: PdfStyleRef[] | null;
}

interface JobRecord {
  id: string;
  test_code: string;
  style_refs: PdfStyleRef[];
}

function mapSectionToSectionCode(section: string): string {
  const normalized = section.toLowerCase();
  if (normalized === "math") return "M";
  if (normalized === "reading" || normalized === "writing") return "RW";
  return "M";
}

function mapDifficultyToLevel(difficulty: string): number {
  switch (difficulty) {
    case "easy": return 1;
    case "medium": return 2;
    case "hard": return 3;
    default: return 2;
  }
}

function mapDifficultyToBucket(difficulty: string): DifficultyLevel {
  if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") {
    return difficulty;
  }
  return "unknown";
}

function hasDiagram(draft: GeneratedQuestionDraft): boolean {
  if (!draft.assets || draft.assets.length === 0) return false;
  return draft.assets.some(a => a.type === "diagram");
}

export interface V4DraftWithMetadata {
  draft: GeneratedQuestionDraft;
  domain?: MathDomain | null;
  subskill?: string | null;
  structureClusterId?: string | null;
  tagConfidence?: number | null;
}

export function buildQuestionRowFromV4(
  draft: GeneratedQuestionDraft,
  qa: QaResult,
  job: { id: string; test_code: string; style_refs: PdfStyleRef[] },
  draftId: string,
  styleRefsUsed: PdfStyleRef[] | null,
  metadata?: V4DraftWithMetadata
): Record<string, any> {
  const optionsByKey: Record<string, string> = {};
  for (const opt of draft.options) {
    optionsByKey[opt.key] = opt.text;
  }

  const requiredKeys = ["A", "B", "C", "D"];
  for (const key of requiredKeys) {
    if (!optionsByKey[key]) {
      throw new Error(`Missing required option key: ${key}`);
    }
  }

  const finalAnswer = qa.foundCorrectAnswer || draft.correctAnswer;
  const finalExplanation = qa.correctedExplanation || draft.explanation;
  const finalDifficulty = qa.correctedDifficulty || draft.difficulty;

  const v4Provenance: V4Provenance = {
    jobId: job.id,
    draftId: draftId,
    styleRefsUsed: styleRefsUsed || job.style_refs || [],
    inspirationQuestionIds: draft.inspiration?.questionIds || null,
    model: "gemini-2.0-flash",
    createdAt: new Date().toISOString(),
  };

  const row: Record<string, any> = {
    stem: draft.stem,
    options: draft.options,
    answer: finalAnswer,
    answer_choice: finalAnswer,
    answer_text: optionsByKey[finalAnswer],
    explanation: finalExplanation,
    section: draft.section,
    difficulty: finalDifficulty,
    difficulty_level: mapDifficultyToLevel(finalDifficulty),
    question_type: "multiple_choice",
    type: "mc",
    ai_generated: true,
    needs_review: false,
    confidence: 0.95,
    tags: [draft.skill],
    unit_tag: draft.skill,
    parsing_metadata: {
      v4: v4Provenance,
      source: "ingestion_v4",
      generatedBy: "gemini-2.0-flash",
      exam: job.test_code || "SAT",
      section_code: mapSectionToSectionCode(draft.section),
      domain: metadata?.domain || null,
      skill: draft.skill,
      subskill: metadata?.subskill || null,
      difficulty_bucket: mapDifficultyToBucket(finalDifficulty),
      structure_cluster_id: metadata?.structureClusterId || null,
      tag_confidence: metadata?.tagConfidence || null,
      diagram_present: hasDiagram(draft),
    },
  };

  return row;
}

export async function getPublishedCanonicalId(draftId: string): Promise<{ canonical_id: string } | null> {
  const supabase = getSupabaseAdmin();
  
  const { data, error } = await supabase
    .from("ingestion_v4_drafts")
    .select("qa")
    .eq("id", draftId)
    .single();
  
  if (error || !data) return null;
  
  const qa = data.qa as QaResult & { 
    questions_canonical_id?: string;
  } | null;
  
  if (qa?.questions_canonical_id) {
    return {
      canonical_id: qa.questions_canonical_id,
    };
  }
  
  return null;
}

const MAX_CQID_RETRIES = 10;

export async function publishApprovedDraftToQuestions(
  jobId: string,
  draftId: string
): Promise<PublishResult> {
  const supabase = getSupabaseAdmin();

  const existing = await getPublishedCanonicalId(draftId);
  if (existing) {
    console.log(`[V4] Draft ${draftId} already published as ${existing.canonical_id}, skipping`);
    return { 
      canonical_id: existing.canonical_id 
    };
  }

  const { data: draftData, error: draftError } = await supabase
    .from("ingestion_v4_drafts")
    .select("id, job_id, draft, qa, qa_ok, style_refs_used")
    .eq("id", draftId)
    .single();

  if (draftError || !draftData) {
    throw new Error(`Draft not found: ${draftId}`);
  }

  const draftRecord = draftData as DraftRecord;

  if (!draftRecord.qa_ok || !draftRecord.qa) {
    throw new Error(`Draft ${draftId} did not pass QA`);
  }

  const qa = draftRecord.qa as QaResult;
  const draft = draftRecord.draft as GeneratedQuestionDraft;

  if (!qa.ok) {
    throw new Error(`QA result indicates failure for draft ${draftId}`);
  }

  const { data: jobData, error: jobError } = await supabase
    .from("ingestion_v4_jobs")
    .select("id, test_code, style_refs")
    .eq("id", jobId)
    .single();

  if (jobError || !jobData) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const job = jobData as JobRecord;

  const rawRow = buildQuestionRowFromV4(
    draft,
    qa,
    job,
    draftId,
    draftRecord.style_refs_used
  );

  const validation = validateQuestionRow(rawRow);

  if (!validation.valid || !validation.cleanedRow) {
    throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
  }

  // Extract base test code (e.g., "SAT" from "SAT-MATH" or "SAT")
  // Validate against known TestCode values, fallback to SAT
  const VALID_TEST_CODES: TestCode[] = ["SAT", "ACT", "AP", "MCAT", "LSAT"];
  const rawTestCode = job.test_code || "SAT";
  const extractedCode = rawTestCode.split("-")[0] || "SAT";
  const testCode: TestCode = VALID_TEST_CODES.includes(extractedCode as TestCode) 
    ? (extractedCode as TestCode) 
    : "SAT";
  const sectionCode = mapSectionToCode(draft.section);
  const sourceCode: "1" | "2" = "2";

  let insertedData: any = null;
  let finalCanonicalId: string = "";
  
  for (let attempt = 0; attempt < MAX_CQID_RETRIES; attempt++) {
    const canonicalId = generateCanonicalId(testCode, sectionCode, sourceCode);
    
    const { data: existingByCqid } = await supabase
      .from("questions")
      .select("id")
      .eq("canonical_id", canonicalId)
      .maybeSingle();
    
    if (existingByCqid) {
      console.warn(`[V4] CQID ${canonicalId} already exists, retrying...`);
      continue;
    }
    
    const rowWithCqid = {
      ...validation.cleanedRow,
      canonical_id: canonicalId,
    };

    const { data, error: insertError } = await supabase
      .from("questions")
      .insert(rowWithCqid)
      .select("id");

    if (!insertError && data && data.length > 0) {
      insertedData = data;
      finalCanonicalId = canonicalId;
      break;
    }

    const isDuplicateError = 
      insertError?.code === "23505" ||
      insertError?.message?.includes("duplicate key") ||
      insertError?.message?.includes("unique constraint") ||
      insertError?.message?.includes("canonical_id");

    if (isDuplicateError) {
      console.warn(`[V4] CQID collision on attempt ${attempt + 1}, retrying... (error: ${insertError?.message})`);
      continue;
    }

    throw new Error(`Failed to publish question: ${insertError?.message}`);
  }

  if (!insertedData || !finalCanonicalId) {
    throw new Error(`Failed to generate unique canonical_id after ${MAX_CQID_RETRIES} retries`);
  }

  const insertedId = insertedData[0].id;
  const now = new Date().toISOString();
  
  await supabase
    .from("ingestion_v4_drafts")
    .update({ 
      qa: { 
        ...qa, 
        published_at: now, 
        questions_canonical_id: finalCanonicalId,
        questions_id: insertedId,
      } 
    })
    .eq("id", draftId);

  console.log(`[V4] Published draft ${draftId} with canonical_id ${finalCanonicalId}`);

  return {
    canonical_id: finalCanonicalId,
    questions_id: insertedId,
  };
}
