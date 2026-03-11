import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "./supabase-admin";

export type TestCode = "SAT";
export type SectionCode = "MATH" | "RW";
export type SourceCode = 0 | 1 | 2 | 3;

const UNIQUE_LENGTH = 6;
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateUniqueToken(length: number = UNIQUE_LENGTH): string {
  const bytes = randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
}

export function generateCanonicalId(
  test: TestCode,
  section: SectionCode,
  source: SourceCode,
): string {
  const unique = generateUniqueToken();
  return `${test}${section}${source}${unique}`;
}

export function isValidCanonicalId(id: string): boolean {
  const pattern = /^SAT(MATH|RW)[0-3][A-Z0-9]{6}$/;
  return pattern.test(id);
}

export function parseCanonicalId(id: string): {
  test: TestCode;
  section: SectionCode;
  source: SourceCode;
  unique: string;
} | null {
  const match = id.match(/^(SAT)(MATH|RW)([0-3])([A-Z0-9]{6})$/);
  if (!match) return null;

  return {
    test: "SAT",
    section: match[2] as SectionCode,
    source: Number(match[3]) as SourceCode,
    unique: match[4],
  };
}

export function mapSectionToCode(section: string): SectionCode {
  const normalized = section.toLowerCase();
  if (normalized.includes("math")) return "MATH";
  return "RW";
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
  options: InsertWithRetryOptions<T>,
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
  source: SourceCode,
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
      const { data, error } = await supabase.from("questions").insert(rowWithCqid).select("id, canonical_id").single();
      return { data, error };
    },
  });

  return {
    canonicalId: result.canonicalId,
    questionId: result.data.id,
  };
}
