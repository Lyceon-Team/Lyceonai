import { Router, Request, Response } from "express";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger.js";
import { requireSupabaseAdmin } from "../middleware/supabase-auth.js";

const router = Router();

router.get("/stats", requireSupabaseAdmin, async (_req: Request, res: Response) => {
  try {
    const [questionsResult, inReviewResult, recentSessionsResult] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).in("status", ["in_review", "pending_review"]),
      supabaseServer
        .from("practice_sessions")
        .select("id", { count: "exact", head: true })
        .gte("started_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    return res.json({
      questions: {
        total: Number(questionsResult.count ?? 0),
        inReview: Number(inReviewResult.count ?? 0),
      },
      practice: {
        recentSessions: Number(recentSessionsResult.count ?? 0),
      },
    });
  } catch (error) {
    logger.error("ADMIN", "stats_error", "Failed to fetch admin stats", error);
    return res.status(500).json({ error: "Failed to fetch admin statistics" });
  }
});

router.get("/kpis", requireSupabaseAdmin, async (_req: Request, res: Response) => {
  try {
    const [totalQuestionsResult, mathQuestionsResult, rwQuestionsResult, inReviewResult, latestQuestionResult] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).eq("section_code", "MATH"),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).eq("section_code", "RW"),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).in("status", ["in_review", "pending_review"]),
      supabaseServer.from("questions").select("created_at, status").order("created_at", { ascending: false }).limit(1),
    ]);

    const [mcCountResult] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).eq("question_type", "multiple_choice"),
    ]);

    const latestQuestion = latestQuestionResult.data?.[0];

    return res.json({
      supabaseConnected: true,
      questions: {
        total: Number(totalQuestionsResult.count ?? 0),
        math: Number(mathQuestionsResult.count ?? 0),
        readingWriting: Number(rwQuestionsResult.count ?? 0),
        inReview: Number(inReviewResult.count ?? 0),
        multipleChoice: Number(mcCountResult.count ?? 0),
      },
      latestQuestion: {
        createdAt: latestQuestion?.created_at ?? null,
        status: latestQuestion?.status ?? null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error("ADMIN", "kpis_error", "Failed to fetch KPIs", error);
    return res.status(500).json({ supabaseConnected: false, error: "Failed to fetch KPIs", detail: error?.message });
  }
});

router.get("/database/schema", requireSupabaseAdmin, async (_req: Request, res: Response) => {
  try {
    return res.json({
      success: true,
      message: "Schema is managed via Supabase. Please use Supabase dashboard for schema inspection.",
      tables: ["questions", "practice_sessions", "answer_attempts", "notifications", "notification_reads", "admin_audit_logs", "profiles"],
    });
  } catch (error) {
    logger.error("ADMIN", "schema_error", "Failed to fetch database schema", error);
    return res.status(500).json({ error: "Failed to fetch database schema" });
  }
});

router.get("/questions-proof", requireSupabaseAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const [totalResult, latestResult, recentResult, sampleResult] = await Promise.all([
      supabaseServer.from("questions").select("id", { count: "exact", head: true }),
      supabaseServer.from("questions").select("created_at").order("created_at", { ascending: false }).limit(1),
      supabaseServer.from("questions").select("id", { count: "exact", head: true }).gte("created_at", oneHourAgo),
      supabaseServer
        .from("questions")
        .select("id, canonical_id, created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    return res.json({
      totalQuestions: Number(totalResult.count ?? 0),
      latestCreatedAt: latestResult.data?.[0]?.created_at ?? null,
      addedLastHour: Number(recentResult.count ?? 0),
      recentSample:
        sampleResult.data?.map((q: any) => ({
          id: q.id,
          canonical_id: q.canonical_id,
          created_at: q.created_at,
        })) ?? [],
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    logger.error("ADMIN", "questions_proof_error", "Failed to fetch questions proof", error);
    return res.status(500).json({ error: "Failed to fetch questions proof", detail: error?.message });
  }
});

export default router;
