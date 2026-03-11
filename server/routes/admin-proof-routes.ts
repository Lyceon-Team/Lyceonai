import { Router, Request, Response } from "express";
import { csrfGuard } from "../middleware/csrf";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { SUPABASE_QUESTIONS_COLUMNS, validateQuestionRow } from "../../apps/api/src/lib/question-validation";

const router = Router();
const csrfProtection = csrfGuard();

function getSupabaseProjectRef(): string {
  const url = process.env.SUPABASE_URL || "";
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  return match ? match[1] : "unknown";
}

router.get("/questions", async (_req: Request, res: Response) => {
  try {
    const { count, error: countError } = await supabaseServer.from("questions").select("id", { count: "exact", head: true });
    if (countError) {
      return res.status(500).json({ error: "Supabase query failed", code: countError.code, message: countError.message, details: countError.details });
    }

    const { data: latestRows, error: latestError } = await supabaseServer
      .from("questions")
      .select("id, canonical_id, section, section_code, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (latestError) {
      return res.status(500).json({ error: "Supabase query failed", code: latestError.code, message: latestError.message, details: latestError.details });
    }

    return res.json({
      supabaseProjectRef: getSupabaseProjectRef(),
      total: count || 0,
      latestCreatedAt: latestRows?.[0]?.created_at || null,
      latestRows: latestRows || [],
      queriedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", message: err.message });
  }
});

router.post("/insert-smoke", csrfProtection, async (_req: Request, res: Response) => {
  try {
    const uniqueChars = Math.random().toString(36).slice(2, 8).toUpperCase();
    const smokeRow = {
      canonical_id: `SATMATH2SMOKE${uniqueChars}`,
      status: "in_review",
      section: "Math",
      section_code: "MATH",
      question_type: "multiple_choice",
      stem: `Smoke test question inserted at ${new Date().toISOString()}`,
      options: [
        { key: "A", text: "Smoke option A" },
        { key: "B", text: "Smoke option B" },
        { key: "C", text: "Smoke option C" },
        { key: "D", text: "Smoke option D" },
      ],
      correct_answer: "A",
      answer_text: "A",
      explanation: "Smoke explanation",
      option_metadata: {
        A: { role: "correct", error_taxonomy: null },
        B: { role: "distractor", error_taxonomy: null },
        C: { role: "distractor", error_taxonomy: null },
        D: { role: "distractor", error_taxonomy: null },
      },
      domain: "Algebra",
      skill: "Linear equations",
      subskill: "Solve one-variable equations",
      skill_code: "MATH.ALG.LE.1",
      difficulty: 2,
      source_type: 1,
      test_code: "SAT",
      exam: "SAT",
      ai_generated: true,
      diagram_present: false,
      tags: [],
      competencies: [],
      provenance_chunk_ids: [],
    };

    const validation = validateQuestionRow(smokeRow);
    if (!validation.valid) {
      return res.status(400).json({ error: "Validation failed", errors: validation.errors, droppedKeys: validation.droppedKeys });
    }

    const { data, error } = await supabaseServer.from("questions").insert([validation.cleanedRow]).select("id, canonical_id, created_at").single();

    if (error) {
      return res.status(500).json({
        error: "Supabase insert failed",
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        attemptedColumns: Object.keys(validation.cleanedRow || {}),
        schemaColumns: SUPABASE_QUESTIONS_COLUMNS,
      });
    }

    return res.json({ success: true, supabaseProjectRef: getSupabaseProjectRef(), insertedRow: data, message: "Smoke test row inserted successfully" });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", message: err.message });
  }
});

router.delete("/cleanup-smoke", csrfProtection, async (_req: Request, res: Response) => {
  try {
    const { data, error } = await supabaseServer
      .from("questions")
      .delete()
      .like("canonical_id", "%SMOKE%")
      .select("id");

    if (error) {
      return res.status(500).json({ error: "Supabase delete failed", code: error.code, message: error.message });
    }

    return res.json({ success: true, deletedCount: data?.length || 0 });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", message: err.message });
  }
});

export default router;
