import { getSupabaseAdmin } from "./supabase-admin";
import {
  buildCanonicalId,
  generateCanonicalIdSuffix,
  isValidCanonicalId as isValidCanonicalIdShared,
  normalizeSectionCode,
} from "../../../../shared/question-bank-contract";

export type TestCode = "SAT";
export type SectionCode = "M" | "RW";
export type SourceCode = "1" | "2";

const UNIQUE_LENGTH = 6;

export function generateUniqueToken(length: number = UNIQUE_LENGTH): string {
  return generateCanonicalIdSuffix(length);
}

export function generateCanonicalId(
  test: TestCode,
  section: SectionCode,
  source: SourceCode
): string {
  if (test !== "SAT") {
    throw new Error(`Unsupported test code: ${test}`);
  }
  return buildCanonicalId(section, Number(source) as 1 | 2);
}

export function isValidCanonicalId(id: string): boolean {
  return isValidCanonicalIdShared(id);
}

export function parseCanonicalId(id: string): {
  test: string;
  section: string;
  source: string;
  unique: string;
} | null {
  if (!isValidCanonicalId(id)) return null;

  const test = "SAT";
  const rest = id.slice(3);
  const section = rest.startsWith("RW") ? "RW" : "M";
  const source = section === "RW" ? rest[2] : rest[1];
  const unique = section === "RW" ? rest.slice(3) : rest.slice(2);

  return {
    test,
    section,
    source,
    unique,
  };
}

export function mapSectionToCode(section: string): SectionCode {
  const normalized = normalizeSectionCode(section);
  return normalized ?? "RW";
}

export interface InsertWithRetryOptions<T> {
  generateRow: (canonicalId: string) => T;
  insertFn: (row: T) => Promise<{ error: any; data: any }>;
  test: TestCode;
  section: SectionCode;
  source: SourceCode;
  maxRetries?: number;
}

export async function insertWithCanonicalIdRetry<T>(
  options: InsertWithRetryOptions<T>
): Promise<{ canonicalId: string; data: any }> {
  const { generateRow, insertFn, test, section, source, maxRetries = 5 } = options;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const canonicalId = generateCanonicalId(test, section, source);
    const row = generateRow(canonicalId);

    const { error, data } = await insertFn(row);

    if (!error) {
      return { canonicalId, data };
    }

    const isDuplicateError =
      error.code === "23505" ||
      error.message?.includes("duplicate key") ||
      error.message?.includes("unique constraint") ||
      error.message?.includes("canonical_id");

    if (isDuplicateError) {
      console.warn(`[CQID] Collision on attempt ${attempt + 1}, retrying...`);
      continue;
    }

    throw new Error(`Insert failed: ${error.message}`);
  }

  throw new Error(`Failed to generate unique canonical_id after ${maxRetries} retries`);
}

export async function upsertQuestionWithCanonicalId(
  row: Record<string, any>,
  test: TestCode,
  section: SectionCode,
  source: SourceCode
): Promise<{ canonicalId: string; questionId: string }> {
  const supabase = getSupabaseAdmin();

  const result = await insertWithCanonicalIdRetry({
    test,
    section,
    source,
    generateRow: (canonicalId) => ({
      ...row,
      canonical_id: canonicalId,
    }),
    insertFn: async (rowWithCqid) => {
      const { data, error } = await supabase
        .from("questions")
        .insert(rowWithCqid)
        .select("id, canonical_id")
        .single();
      return { data, error };
    },
  });

  return {
    canonicalId: result.canonicalId,
    questionId: result.data.id,
  };
}
