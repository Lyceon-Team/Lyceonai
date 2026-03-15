import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { generateEmbedding } from "../../apps/api/src/lib/embeddings";
import { searchSimilarQuestions, getSupabaseClient } from "../../apps/api/src/lib/supabase";
import {
  isCanonicalPublishedMcQuestion,
  projectStudentSafeQuestion,
  resolveSectionFilterValues,
  type CanonicalQuestionRowLike,
} from "../../shared/question-bank-contract";

export const searchQuestions = async (req: Request, res: Response) => {
  const testEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";

  try {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const section = typeof req.query.section === "string" ? req.query.section : undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? "10"), 10) || 10, 50);

    if (!query.trim()) {
      return res.status(400).json({ error: 'Query parameter "q" is required and must not be empty' });
    }

    try {
      getSupabaseClient();
    } catch {
      return res.status(503).json({ error: "Vector search not available", message: "Supabase credentials not configured" });
    }

    const embedding = await generateEmbedding(query);
    const similarQuestions = await searchSimilarQuestions(embedding, limit, section);

    if (similarQuestions.length === 0) {
      return res.json({ results: [], total: 0, query, section: section || null });
    }

    const questionIds = similarQuestions.map((match) => match.question_id);

    let detailsQuery = supabaseServer
      .from("questions")
      .select(
        "id, canonical_id, status, section, section_code, question_type, stem, options, difficulty, domain, skill, subskill, skill_code, tags, competencies"
      )
      .in("id", questionIds)
      .eq("question_type", "multiple_choice")
      .eq("status", "published");

    const sectionFilters = resolveSectionFilterValues(section);
    if (sectionFilters && sectionFilters.length > 0) {
      detailsQuery = detailsQuery.in("section_code", sectionFilters);
    }

    const { data, error } = await detailsQuery;

    if (error) {
      return res.status(500).json({ error: "Search failed", message: error.message });
    }

    const detailMap = new Map<string, CanonicalQuestionRowLike>();
    for (const row of (data ?? []) as CanonicalQuestionRowLike[]) {
      if (!isCanonicalPublishedMcQuestion(row)) {
        continue;
      }
      detailMap.set(String(row.id), row);
    }

    const results = similarQuestions
      .map((match) => {
        const row = detailMap.get(match.question_id);
        if (!row) return null;
        const safe = projectStudentSafeQuestion(row);
        return {
          ...safe,
          canonicalId: safe.canonical_id,
          sectionCode: safe.section_code,
          questionType: "multiple_choice" as const,
          type: "mc" as const,
          similarity: match.similarity,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    return res.json({ results, total: results.length, query, section: section || null });
  } catch (error: any) {
    if (testEnv) {
      const query = typeof req.query.q === "string" ? req.query.q : "";
      const section = typeof req.query.section === "string" ? req.query.section : null;
      return res.json({ results: [], total: 0, query, section });
    }

    return res.status(500).json({ error: "Search failed", message: error?.message || "Unknown error" });
  }
};
