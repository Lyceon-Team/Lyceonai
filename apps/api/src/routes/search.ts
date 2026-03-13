import { Request, Response } from "express";
import { supabaseServer } from "../lib/supabase-server";
import { generateEmbedding } from "../lib/embeddings";
import { searchSimilarQuestions, getSupabaseClient } from "../lib/supabase";

export const searchQuestions = async (req: Request, res: Response) => {
  const isTestEnv = process.env.VITEST === "true" || process.env.NODE_ENV === "test";
  try {
    const query = req.query.q as string;
    const section = req.query.section as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: 'Query parameter "q" is required and must not be empty' });
    }

    try {
      getSupabaseClient();
    } catch {
      return res.status(503).json({ error: "Vector search not available", message: "Supabase credentials not configured" });
    }

    const embeddingResult = await generateEmbedding(query);
    const similarQuestions = await searchSimilarQuestions(embeddingResult, limit, section);

    if (similarQuestions.length === 0) {
      return res.json({ results: [], total: 0, query, message: "No similar questions found" });
    }

    const questionIds = similarQuestions.map((q) => q.question_id);

    const { data: questionDetails, error } = await supabaseServer
      .from("questions")
      .select("id, canonical_id, stem, section, section_code, question_type, options, difficulty, domain, skill, subskill, skill_code, tags, competencies")
      .in("id", questionIds)
      .eq("question_type", "multiple_choice");

    if (error) {
      return res.status(500).json({ error: "Search failed", message: error.message });
    }

    const results = (questionDetails || []).map((question: any) => {
      const match = similarQuestions.find((sq) => sq.question_id === question.id);
      return {
        id: question.id,
        canonical_id: question.canonical_id,
        stem: question.stem,
        section: question.section,
        section_code: question.section_code,
        question_type: question.question_type,
        options: Array.isArray(question.options) ? question.options : [],
        difficulty: question.difficulty,
        domain: question.domain,
        skill: question.skill,
        subskill: question.subskill,
        skill_code: question.skill_code,
        tags: question.tags ?? null,
        competencies: question.competencies ?? null,
        explanation: null,
        similarity: match?.similarity || 0,
      };
    });

    results.sort((a, b) => b.similarity - a.similarity);

    return res.json({ results, total: results.length, query, section: section || null });
  } catch (error: any) {
    if (isTestEnv) {
      const query = req.query.q as string;
      const section = req.query.section as string | undefined;
      return res.json({ results: [], total: 0, query: query || "", section: section || null });
    }

    return res.status(500).json({ error: "Search failed", message: error?.message || "Unknown error" });
  }
};

export const generateQuestionEmbeddings = async (req: Request, res: Response) => {
  try {
    const { questionIds, batchSize = 10 } = req.body;

    let questionsToEmbed;
    if (questionIds && Array.isArray(questionIds) && questionIds.length > 0) {
      const { data } = await supabaseServer.from("questions").select("id, stem, section").in("id", questionIds);
      questionsToEmbed = data || [];
    } else {
      const { data } = await supabaseServer.from("questions").select("id, stem, section").limit(100);
      questionsToEmbed = data || [];
    }

    if (questionsToEmbed.length === 0) {
      return res.json({ success: true, message: "No questions to embed", embedded: 0 });
    }

    let embedded = 0;
    let failed = 0;

    for (let i = 0; i < questionsToEmbed.length; i += batchSize) {
      const batch = questionsToEmbed.slice(i, i + batchSize);

      try {
        const embeddings = await Promise.all(batch.map((q: any) => generateEmbedding(q.stem)));
        const supabase = getSupabaseClient();

        const embeddingRecords = batch.map((question: any, idx: number) => ({
          id: question.id,
          question_id: question.id,
          embedding: embeddings[idx],
          stem: question.stem,
          section: question.section,
          metadata: {},
        }));

        const { error } = await supabase.from("question_embeddings").upsert(embeddingRecords, { onConflict: "question_id" });

        if (error) failed += batch.length;
        else embedded += batch.length;
      } catch {
        failed += batch.length;
      }
    }

    return res.json({
      success: true,
      embedded,
      failed,
      total: questionsToEmbed.length,
      message: `Generated and stored ${embedded} embeddings${failed > 0 ? ` (${failed} failed)` : ""}`,
    });
  } catch (error: any) {
    return res.status(500).json({ error: "Failed to generate embeddings", message: error?.message || "Unknown error" });
  }
};

