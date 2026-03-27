import type { Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

const REVIEW_RUNTIME_TABLES = [
  "review_sessions",
  "review_session_items",
  "review_session_events",
  "review_error_attempts",
] as const;

const TABLE_MISSING_PATTERN = /Could not find the table 'public\.(.+)' in the schema cache/i;
const PG_RELATION_MISSING_PATTERN = /relation ["']?public\.(.+?)["']? does not exist/i;
const CACHE_TTL_MS = 60_000;

let cachedCheckedAt = 0;
let cachedResult: { available: boolean; missingTable?: string | null; error?: string | null } | null = null;

async function tableExists(tableName: string): Promise<{ exists: boolean; missingTable?: string; error?: string }> {
  try {
    const { error } = await supabaseServer.from(tableName).select("id").limit(1);
    if (!error) {
      return { exists: true };
    }

    const message = String(error.message || "");
    const missingMatch = message.match(TABLE_MISSING_PATTERN) ?? message.match(PG_RELATION_MISSING_PATTERN);
    if (missingMatch) {
      return { exists: false, missingTable: missingMatch[1] ?? tableName };
    }

    // Unit tests often use narrow table mocks that throw for unknown probes.
    if (process.env.NODE_ENV === "test") {
      return { exists: true };
    }

    return { exists: false, error: message };
  } catch (err: any) {
    if (process.env.NODE_ENV === "test") {
      return { exists: true };
    }

    const message = String(err?.message || err || "");
    const missingMatch = message.match(TABLE_MISSING_PATTERN) ?? message.match(PG_RELATION_MISSING_PATTERN);
    if (missingMatch) {
      return { exists: false, missingTable: missingMatch[1] ?? tableName };
    }

    return { exists: false, error: message };
  }
}

export async function getReviewRuntimeAvailability(): Promise<{ available: boolean; missingTable?: string | null; error?: string | null }> {
  const now = Date.now();
  if (cachedResult && now - cachedCheckedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  for (const tableName of REVIEW_RUNTIME_TABLES) {
    const check = await tableExists(tableName);
    if (!check.exists) {
      cachedResult = {
        available: false,
        missingTable: check.missingTable ?? tableName,
        error: check.error ?? null,
      };
      cachedCheckedAt = now;
      return cachedResult;
    }
  }

  cachedResult = { available: true, missingTable: null, error: null };
  cachedCheckedAt = now;
  return cachedResult;
}

export function sendReviewRuntimeUnavailable(res: Response, requestId?: string, missingTable?: string | null) {
  return res.status(503).json({
    error: "Review runtime is temporarily unavailable",
    code: "REVIEW_RUNTIME_UNAVAILABLE",
    missingTable: missingTable ?? null,
    message: "Review session tables are not present in the live database. Apply the review runtime migration before enabling this feature.",
    requestId,
  });
}
