import { Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

// @spec [Coding Standards §5.2; student-ui register UI-05] | @implemented [2026-09-29]
// plain English: this module now serves only GET /api/questions/stats, an aggregate count over
// `servable_questions` by section and difficulty. It selects `section, difficulty` and nothing
// else, so no stem, option, answer or explanation column is ever read. The list, recent, random,
// count, feed, :id and feedback handlers (and the by-topic / by-difficulty helpers nothing
// mounted) were deleted as unused; `getQuestionById` was the one that read the raw `questions`
// table rather than `servable_questions`.
const ALLOWED_ITEM_TYPES = ["mcq", "grid_in"] as const;

// GET /api/questions/stats - canonical stats over published MC questions
export const getQuestionStats = async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseServer
      .from("servable_questions")
      .select("section, difficulty")
      .in("item_type", [...ALLOWED_ITEM_TYPES]);

    if (error) {
      return res
        .status(500)
        .json({ error: "Failed to fetch questions", detail: error.message });
    }

    const rows = (data ?? []) as Array<{
      section?: string | null;
      difficulty?: unknown;
    }>;

    let math = 0;
    let readingWriting = 0;
    let easy = 0;
    let medium = 0;
    let hard = 0;

    for (const row of rows) {
      const sectionCode = String(row.section ?? "").toUpperCase();
      if (sectionCode === "M") {
        math += 1;
      } else if (sectionCode === "RW") {
        readingWriting += 1;
      }

      const diff = String(row.difficulty ?? "").toLowerCase();
      if (diff === "easy" || diff === "1") easy += 1;
      else if (diff === "medium" || diff === "2") medium += 1;
      else if (diff === "hard" || diff === "3") hard += 1;
    }

    return res.json({
      total: rows.length,
      math,
      reading_writing: readingWriting,
      byDifficulty: {
        easy,
        medium,
        hard,
      },
      recentlyAdded: 0,
    });
  } catch (error: unknown) {
    return res.status(500).json({
      error: "Failed to fetch questions",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
};
