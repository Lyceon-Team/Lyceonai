/**
 * Supabase-backed vector helpers (minimal, safe implementation).
 *
 * This is intentionally conservative:
 * - Exposes supabase for legacy callers.
 * - Exposes matchSimilar used by rag.ts.
 * - Exposes vectorStore as a backward-compatible wrapper.
 *
 * If Supabase env vars are missing, functions log and return empty results
 * instead of crashing.
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export interface MatchResult {
  question_id: string;
  stem: string | null;
  section: string | null;
  exam: string | null;
  metadata: any;
  similarity?: number;
}

// Build Supabase client (service role) if configured
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase: SupabaseClient | null =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

/**
 * Minimal matchSimilar implementation.
 *
 * NOTE: This is deliberately simple and fail-safe:
 * - If Supabase is not configured, it returns [].
 * - If the `question_embeddings` table or query fails, it returns [].
 * - You can later wire this to your real pgvector / RPC-based search.
 */
export async function matchSimilar(
  embedding: number[],
  topK: number,
  section?: string
): Promise<MatchResult[]> {
  if (!supabase) {
    console.warn("[VECTOR] Supabase client not configured; returning no matches");
    return [];
  }

  try {
    // Basic placeholder query: you can later replace this with a real
    // pgvector `<->` similarity query or RPC.
    let query = supabase
      .from("question_embeddings")
      .select("question_id, stem, section, exam, metadata")
      .limit(Math.max(1, Math.min(topK || 5, 50)));

    if (section) {
      query = query.eq("section", section);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[VECTOR] Supabase query failed:", error.message);
      return [];
    }

    if (!data || data.length === 0) {
      console.warn("[VECTOR] No embeddings found in database");
      return [];
    }

    // We are not computing similarity here; this is a safe, unranked set.
    return data as any as MatchResult[];
  } catch (err: any) {
    console.error("[VECTOR] matchSimilar exception:", err.message || err);
    return [];
  }
}

/**
 * Backwards-compatible vectorStore wrapper retained for legacy callers.
 */
export const vectorStore = {
  matchSimilar,
};
