import { Router, Request, Response } from "express";
import { 
  parseTeacherDraft, 
  parseQaResult, 
  generateDraftWithTeacher, 
  qaDraftWithTa 
} from "../ingestion_v4/services/v4JobService";
import { 
  CreateJobRequestSchema, 
  CreateStyleLibraryEntrySchema,
  GeneratedQuestionDraftSchema,
  QaResultSchema,
  QueueBatchRequestSchema
} from "../ingestion_v4/types/schemas";
import { getSupabaseAdmin } from "../lib/supabase-admin";
import { runBatchForJob, isLockError } from "../ingestion_v4/services/v4Runner";
import { publishApprovedDraftToQuestions } from "../ingestion_v4/services/v4Publisher";
import { 
  enqueueBatch, 
  dequeueNext, 
  completeQueueItem, 
  failQueueItem, 
  deferQueueItem 
} from "../ingestion_v4/services/v4Queue";
import { 
  scanStyleBank, 
  syncStyleBankToLibrary 
} from "../ingestion_v4/services/styleBankService";
import {
  getUnlinkedPagesWithMetadata,
  repairUnlinkedPages,
} from "../ingestion_v4/services/v4Clustering";
import { normalizeSection, type CanonicalSection } from "../ingestion_v4/utils/section";
import { enqueueRenderPages } from "../ingestion_v4/services/v4Queue";
import { processNextQueueItem } from "../ingestion_v4/services/v4QueueWorker";
import { QueueRenderPagesRequestSchema } from "../ingestion_v4/types/schemas";
import type { V4JobRequest, PdfStyleRef } from "../ingestion_v4/types";
import { v4 as uuidv4 } from "uuid";
import { isV4GeminiEnabled, getGeminiKeySource } from "../ingestion_v4/services/gemini";
import type { NextFunction } from "express";

export const ingestionV4Router = Router();

const V4_BUILD_VERSION = `v4-proof-20251227-robust`;

/**
 * Middleware for defense-in-depth admin check.
 * server/index.ts mounts this router behind requireSupabaseAdmin (admin-only).
 */
function requireAdminOrBypass(req: Request, res: Response, next: NextFunction): void {
  // SINGLE SOURCE OF TRUTH:
  // server/index.ts mounts this router behind requireSupabaseAdmin (admin-only).
  // Defense-in-depth: verify req.user.role is admin.
  const role = (req as any).user?.role;
  if (role === 'admin') {
    next();
    return;
  }

  res.status(401).json({ ok: false, error: "Admin access required" });
}

/**
 * POST /api/ingestion-v4/test
 * Minimal foundation test: validates teacher+qa payloads using zod.
 */
ingestionV4Router.post("/test", async (_req: Request, res: Response) => {
  try {
    const draft = parseTeacherDraft({
      draftId: "draft-1",
      section: "Math",
      skill: "Linear equations",
      difficulty: "medium",
      stem: "If 3x + 2 = 14, what is the value of x?",
      options: [
        { key: "A", text: "3" },
        { key: "B", text: "4" },
        { key: "C", text: "5" },
        { key: "D", text: "6" }
      ],
      correctAnswer: "B",
      explanation: "Subtract 2 from both sides to get 3x = 12, then divide by 3 to get x = 4.",
      inspiration: null,
      assets: []
    });

    const qa = parseQaResult({
      ok: true,
      foundCorrectAnswer: "B",
      issues: []
    });

    return res.status(200).json({
      ok: true,
      draftId: draft.draftId,
      qaOk: qa.ok
    });
  } catch (err: any) {
    return res.status(400).json({
      ok: false,
      error: err?.message ?? "Unknown error"
    });
  }
});

/**
 * POST /api/ingestion-v4/jobs
 * Create a new generation job
 */
ingestionV4Router.post("/jobs", async (req: Request, res: Response) => {
  try {
    const parsed = CreateJobRequestSchema.parse(req.body);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ingestion_v4_jobs")
      .insert({
        test_code: parsed.testCode,
        status: "QUEUED",
        target_count: parsed.targetCount,
        style_refs: parsed.styleRefs,
        stats: { generated: 0, qa_passed: 0, qa_failed: 0 }
      })
      .select("id, status")
      .single();

    if (error) {
      console.error("[V4] Failed to create job:", error);
      return res.status(500).json({ ok: false, error: "Failed to create job" });
    }

    return res.status(201).json({
      ok: true,
      jobId: data.id,
      status: data.status
    });
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ ok: false, error: err.errors });
    }
    console.error("[V4] Job creation error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/jobs
 * List last 50 jobs
 */
ingestionV4Router.get("/jobs", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ingestion_v4_jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[V4] Failed to list jobs:", error);
      return res.status(500).json({ ok: false, error: "Failed to list jobs" });
    }

    return res.status(200).json({ ok: true, jobs: data });
  } catch (err: any) {
    console.error("[V4] List jobs error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/jobs/active
 * Get the currently active (running) job if any
 * NOTE: Must be defined BEFORE /jobs/:jobId to prevent route parameter collision
 */
ingestionV4Router.get("/jobs/active", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    
    const { data: runningJobs, error } = await supabase
      .from("ingestion_v4_jobs")
      .select("*")
      .in("status", ["RUNNING", "QUEUED"])
      .order("created_at", { ascending: false })
      .limit(1);
    
    if (error) {
      console.error("[V4] Jobs active error:", error);
      return res.status(500).json({ ok: false, error: "Failed to get active job" });
    }
    
    const job = runningJobs?.[0];
    
    if (!job) {
      return res.status(200).json({ ok: true, job: null });
    }
    
    const progress = job.target_count > 0 
      ? Math.round(((job.stats?.generated || 0) / job.target_count) * 100)
      : 0;
    
    return res.status(200).json({
      ok: true,
      job: {
        id: job.id,
        section: job.test_code?.includes("RW") ? "rw" : "math",
        status: job.status,
        targetCount: job.target_count,
        generated: job.stats?.generated || 0,
        qaPassed: job.stats?.qa_passed || 0,
        qaFailed: job.stats?.qa_failed || 0,
        createdAt: job.created_at,
        progress,
      },
    });
  } catch (err: any) {
    console.error("[V4] Jobs active error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ingestion-v4/jobs/:jobId
 * Get a specific job by ID
 */
ingestionV4Router.get("/jobs/:jobId", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ingestion_v4_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ ok: false, error: "Job not found" });
      }
      console.error("[V4] Failed to get job:", error);
      return res.status(500).json({ ok: false, error: "Failed to get job" });
    }

    return res.status(200).json({ ok: true, job: data });
  } catch (err: any) {
    console.error("[V4] Get job error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/jobs/:jobId/dry-run
 * Milestone 3 safe executor - creates sample draft without Gemini
 */
ingestionV4Router.post("/jobs/:jobId/dry-run", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const supabase = getSupabaseAdmin();

    // Get current job - distinguish between "not found" and other errors
    const { data: job, error: jobError } = await supabase
      .from("ingestion_v4_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError) {
      if (jobError.code === "PGRST116") {
        return res.status(404).json({ ok: false, error: "Job not found" });
      }
      console.error("[V4] Failed to fetch job:", jobError);
      return res.status(500).json({ ok: false, error: "Failed to fetch job" });
    }

    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    // Set status to RUNNING
    const { error: runningError } = await supabase
      .from("ingestion_v4_jobs")
      .update({ status: "RUNNING" })
      .eq("id", jobId);

    if (runningError) {
      console.error("[V4] Failed to set job to RUNNING:", runningError);
      return res.status(500).json({ ok: false, error: "Failed to update job status" });
    }

    // Create sample draft (same as /test endpoint)
    const sampleDraft = {
      draftId: `draft-${Date.now()}`,
      section: "Math",
      skill: "Linear equations",
      difficulty: "medium",
      stem: "If 3x + 2 = 14, what is the value of x?",
      options: [
        { key: "A", text: "3" },
        { key: "B", text: "4" },
        { key: "C", text: "5" },
        { key: "D", text: "6" }
      ],
      correctAnswer: "B",
      explanation: "Subtract 2 from both sides to get 3x = 12, then divide by 3 to get x = 4.",
      inspiration: null,
      assets: []
    };

    const sampleQa = {
      ok: true,
      foundCorrectAnswer: "B",
      issues: []
    };

    // Validate with parsers
    const validatedDraft = parseTeacherDraft(sampleDraft);
    const validatedQa = parseQaResult(sampleQa);

    // Insert draft into ingestion_v4_drafts
    const { error: draftError } = await supabase
      .from("ingestion_v4_drafts")
      .insert({
        job_id: jobId,
        draft: validatedDraft,
        qa: validatedQa,
        qa_ok: validatedQa.ok
      });

    if (draftError) {
      console.error("[V4] Failed to insert draft:", draftError);
      return res.status(500).json({ ok: false, error: "Failed to insert draft" });
    }

    // Update job stats
    const currentStats = job.stats as { generated: number; qa_passed: number; qa_failed: number };
    const newStats = {
      generated: currentStats.generated + 1,
      qa_passed: currentStats.qa_passed + 1,
      qa_failed: currentStats.qa_failed
    };

    // Check if target reached
    const newStatus = newStats.generated >= job.target_count ? "COMPLETED" : "QUEUED";

    const { error: statsError } = await supabase
      .from("ingestion_v4_jobs")
      .update({ stats: newStats, status: newStatus })
      .eq("id", jobId);

    if (statsError) {
      console.error("[V4] Failed to update job stats:", statsError);
      return res.status(500).json({ ok: false, error: "Failed to update job stats" });
    }

    return res.status(200).json({
      ok: true,
      jobId,
      generated: 1,
      qaPassed: 1
    });
  } catch (err: any) {
    console.error("[V4] Dry-run error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/jobs/:jobId/run-once
 * Milestone 4: Generate + QA + persist a single question using Gemini
 * Requires Gemini API key to be set
 */
ingestionV4Router.post("/jobs/:jobId/run-once", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const supabase = getSupabaseAdmin();

    // 1) Fetch job by id
    const { data: job, error: jobError } = await supabase
      .from("ingestion_v4_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError) {
      if (jobError.code === "PGRST116") {
        return res.status(404).json({ ok: false, error: "Job not found" });
      }
      console.error("[V4] Failed to fetch job:", jobError);
      return res.status(500).json({ ok: false, error: "Failed to fetch job" });
    }

    if (!job) {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    // 2) Set status to RUNNING
    const { error: runningError } = await supabase
      .from("ingestion_v4_jobs")
      .update({ status: "RUNNING" })
      .eq("id", jobId);

    if (runningError) {
      console.error("[V4] Failed to set job to RUNNING:", runningError);
      return res.status(500).json({ ok: false, error: "Failed to update job status" });
    }

    // 3) Build V4JobRequest from job data
    const styleRefs = (job.style_refs as PdfStyleRef[]) || [];
    const jobRequest: V4JobRequest = {
      testCode: job.test_code || "SAT",
      targetCount: job.target_count,
      styleRefs
    };

    // 4) Call Teacher to generate draft
    let draft;
    try {
      draft = await generateDraftWithTeacher(jobRequest);
    } catch (teacherErr: any) {
      console.error("[V4] Teacher generation failed:", teacherErr.message);
      
      // Update job with error
      await supabase
        .from("ingestion_v4_jobs")
        .update({ status: "QUEUED", last_error: teacherErr.message })
        .eq("id", jobId);

      if (teacherErr.message === "V4 Gemini disabled") {
        return res.status(400).json({ ok: false, error: "Missing Gemini API key env var (GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_API_KEY)" });
      }
      return res.status(500).json({ ok: false, error: "Teacher generation failed" });
    }

    // 5) Call TA to QA the draft
    let qaResult;
    try {
      qaResult = await qaDraftWithTa(draft);
    } catch (qaErr: any) {
      console.error("[V4] QA failed:", qaErr.message);
      
      // Still save the draft with empty QA
      const { data: insertedDraft, error: draftInsertError } = await supabase
        .from("ingestion_v4_drafts")
        .insert({
          job_id: jobId,
          draft: draft,
          qa: null,
          qa_ok: false
        })
        .select("id")
        .single();

      const currentStats = job.stats as { generated: number; qa_passed: number; qa_failed: number };
      const newStats = {
        generated: currentStats.generated + 1,
        qa_passed: currentStats.qa_passed,
        qa_failed: currentStats.qa_failed + 1
      };

      await supabase
        .from("ingestion_v4_jobs")
        .update({ stats: newStats, status: "QUEUED", last_error: qaErr.message })
        .eq("id", jobId);

      return res.status(500).json({ 
        ok: false, 
        error: "QA failed", 
        draftId: insertedDraft?.id,
        draftGenerated: true
      });
    }

    // 6) Insert draft into ingestion_v4_drafts
    const { data: insertedDraft, error: draftError } = await supabase
      .from("ingestion_v4_drafts")
      .insert({
        job_id: jobId,
        draft: draft,
        qa: qaResult,
        qa_ok: qaResult.ok
      })
      .select("id")
      .single();

    if (draftError) {
      console.error("[V4] Failed to insert draft:", draftError);
      return res.status(500).json({ ok: false, error: "Failed to persist draft" });
    }

    // 7) Update job stats
    const currentStats = job.stats as { generated: number; qa_passed: number; qa_failed: number };
    const newStats = {
      generated: currentStats.generated + 1,
      qa_passed: currentStats.qa_passed + (qaResult.ok ? 1 : 0),
      qa_failed: currentStats.qa_failed + (qaResult.ok ? 0 : 1)
    };

    // Check if target reached
    const newStatus = newStats.generated >= job.target_count ? "COMPLETED" : "QUEUED";

    const { error: statsError } = await supabase
      .from("ingestion_v4_jobs")
      .update({ stats: newStats, status: newStatus, last_error: null })
      .eq("id", jobId);

    if (statsError) {
      console.error("[V4] Failed to update job stats:", statsError);
      return res.status(500).json({ ok: false, error: "Failed to update job stats" });
    }

    // 8) Publish if QA passed
    let publishedCanonicalId: string | undefined;
    if (qaResult.ok) {
      try {
        const publishResult = await publishApprovedDraftToQuestions(jobId, insertedDraft.id);
        publishedCanonicalId = publishResult.canonical_id;
        console.log(`[V4] Published draft ${insertedDraft.id} as ${publishedCanonicalId}`);
      } catch (publishErr: any) {
        console.error(`[V4] Failed to publish approved draft: ${publishErr.message}`);
      }
    }

    // 9) Return response
    return res.status(200).json({
      ok: true,
      jobId,
      draftId: insertedDraft.id,
      qaOk: qaResult.ok,
      issues: qaResult.issues,
      publishedCanonicalId
    });
  } catch (err: any) {
    console.error("[V4] Run-once error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/jobs/:jobId/run-batch
 * Milestone 5/8: Batch runner with cost controls and queue support
 * Requires Gemini API key to be set
 * If locked and enqueueIfLocked=true, queues the request and returns 202
 */
ingestionV4Router.post("/jobs/:jobId/run-batch", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    const parsed = QueueBatchRequestSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ 
        ok: false, 
        error: "Invalid batch parameters",
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
      });
    }

    const opts = parsed.data;

    console.log(`[V4] run-batch request for job ${jobId}: count=${opts.count}, sleepMs=${opts.sleepMs}, enqueueIfLocked=${opts.enqueueIfLocked}`);

    try {
      const result = await runBatchForJob(jobId, opts);
      return res.status(200).json(result);
    } catch (runErr: any) {
      if (isLockError(runErr) && opts.enqueueIfLocked) {
        const { queueId } = await enqueueBatch(jobId, opts);
        console.log(`[V4] Job ${jobId} locked; queued as ${queueId}`);
        return res.status(202).json({
          ok: true,
          queued: true,
          queueId,
          jobId,
          message: "Job is running; batch request queued."
        });
      }
      throw runErr;
    }
  } catch (err: any) {
    console.error("[V4] Run-batch error:", err.message);

    if (err.message === "Job not found") {
      return res.status(404).json({ ok: false, error: "Job not found" });
    }

    if (err.message.startsWith("Job already")) {
      return res.status(409).json({ ok: false, error: err.message });
    }

    if (err.message === "Job is currently locked/running") {
      return res.status(409).json({ ok: false, error: err.message });
    }

    if (err.message === "V4 Gemini disabled") {
      return res.status(400).json({ ok: false, error: "Missing Gemini API key env var (GEMINI_API_KEY, GOOGLE_AI_API_KEY, or GOOGLE_API_KEY)" });
    }

    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/style-library
 * Create a style library entry
 */
ingestionV4Router.post("/style-library", async (req: Request, res: Response) => {
  try {
    const parsed = CreateStyleLibraryEntrySchema.parse(req.body);
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ingestion_v4_style_library")
      .insert({
        label: parsed.label,
        bucket: parsed.bucket,
        path: parsed.path,
        page_hint: parsed.pageHint ?? null,
        notes: parsed.notes ?? null
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ ok: false, error: "Style entry already exists" });
      }
      console.error("[V4] Failed to create style entry:", error);
      return res.status(500).json({ ok: false, error: "Failed to create style entry" });
    }

    return res.status(201).json({ ok: true, id: data.id });
  } catch (err: any) {
    if (err.name === "ZodError") {
      return res.status(400).json({ ok: false, error: err.errors });
    }
    console.error("[V4] Style library creation error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/style-library
 * List last 200 style library entries
 */
ingestionV4Router.get("/style-library", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ingestion_v4_style_library")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("[V4] Failed to list style library:", error);
      return res.status(500).json({ ok: false, error: "Failed to list style library" });
    }

    return res.status(200).json({ ok: true, entries: data });
  } catch (err: any) {
    console.error("[V4] List style library error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/queue/tick
 * Milestone 8: Queue worker tick - process next queued batch
 */
ingestionV4Router.post("/queue/tick", requireAdminOrBypass, async (_req: Request, res: Response) => {
  try {
    const workerId = `worker-${uuidv4().slice(0, 8)}-${Date.now()}`;
    
    const queueItem = await dequeueNext(workerId);
    
    if (!queueItem) {
      return res.status(200).json({ ok: true, ran: false });
    }

    const { id: queueId, job_id: jobId, payload } = queueItem;

    const parsed = QueueBatchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      await failQueueItem(queueId, workerId, "Invalid payload schema");
      return res.status(500).json({ ok: false, queueId, error: "Invalid payload" });
    }

    const opts = parsed.data;

    try {
      const result = await runBatchForJob(jobId, opts);
      await completeQueueItem(queueId, workerId, result as unknown as Record<string, unknown>);
      return res.status(200).json({ ok: true, ran: true, queueId, jobId, result });
    } catch (runErr: any) {
      if (isLockError(runErr)) {
        await deferQueueItem(queueId, workerId, opts.deferSecondsOnLock, "Job locked; deferred");
        return res.status(200).json({ ok: true, ran: false, deferred: true, queueId });
      }
      
      await failQueueItem(queueId, workerId, runErr.message || "Unknown error");
      return res.status(500).json({ ok: false, queueId, error: "Batch execution failed" });
    }
  } catch (err: any) {
    console.error("[V4] Queue tick error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/queue
 * Milestone 8: List last 50 queue items
 */
ingestionV4Router.get("/queue", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase
      .from("ingestion_v4_queue")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[V4] Failed to list queue:", error);
      return res.status(500).json({ ok: false, error: "Failed to list queue" });
    }

    return res.status(200).json({ ok: true, items: data });
  } catch (err: any) {
    console.error("[V4] List queue error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/style-bank/scan
 * Scans Supabase Storage style bank bucket and returns discovered PDFs
 * Does NOT write to database
 */
ingestionV4Router.get("/style-bank/scan", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 200);
    const sectionRaw = req.query.section as string | undefined;
    const sectionFilter = sectionRaw ? normalizeSection(sectionRaw) : undefined;
    
    if (sectionRaw && !sectionFilter) {
      return res.status(400).json({ ok: false, error: `Invalid section: ${sectionRaw}. Use 'math' or 'rw'` });
    }
    
    const result = await scanStyleBank(limit, sectionFilter ?? undefined);
    
    return res.status(200).json({
      ok: true,
      entries: result.entries,
      totalCount: result.totalCount,
      truncated: result.truncated,
      sectionFilter: sectionFilter ?? 'all'
    });
  } catch (err: any) {
    console.error("[V4] Style bank scan error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to scan style bank" });
  }
});

/**
 * POST /api/ingestion-v4/style-bank/sync
 * Scans Supabase Storage and upserts entries into style library table
 * Accepts optional section filter in body or query param
 */
ingestionV4Router.post("/style-bank/sync", async (req: Request, res: Response) => {
  try {
    const sectionRaw = (req.body?.section || req.query.section) as string | undefined;
    const sectionFilter = sectionRaw ? normalizeSection(sectionRaw) : undefined;
    
    if (sectionRaw && !sectionFilter) {
      return res.status(400).json({ ok: false, error: `Invalid section: ${sectionRaw}. Use 'math' or 'rw'` });
    }
    
    const result = await syncStyleBankToLibrary({ section: sectionFilter ?? undefined });
    
    return res.status(200).json({
      ok: true,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped,
      totalSeen: result.totalSeen,
      sectionFilter: sectionFilter ?? 'all'
    });
  } catch (err: any) {
    console.error("[V4] Style bank sync error:", err.message);
    return res.status(500).json({ ok: false, error: "Failed to sync style bank" });
  }
});

/**
 * POST /api/ingestion-v4/style-bank/render
 * Enqueues PDF→PNG rendering jobs for style bank PDFs
 * Accepts explicit list or scans bucket prefix
 */
ingestionV4Router.post("/style-bank/render", async (req: Request, res: Response) => {
  try {
    const { 
      section: sectionRaw, 
      pdfPaths, 
      dpi = 150, 
      maxPages = 600, 
      maxPdfs = 10,
      overwrite = false,
      pageMode = "all",
      pageStart,
      pageEnd
    } = req.body;

    const section = normalizeSection(sectionRaw);
    if (!section) {
      return res.status(400).json({ 
        ok: false, 
        error: `Invalid section: '${sectionRaw}'. Must be 'math' or 'rw'` 
      });
    }

    let pathsToEnqueue: string[] = [];

    if (pdfPaths && Array.isArray(pdfPaths) && pdfPaths.length > 0) {
      pathsToEnqueue = pdfPaths.slice(0, maxPdfs);
    } else {
      const scanResult = await scanStyleBank(maxPdfs, section);
      pathsToEnqueue = scanResult.entries.map((e) => e.path).slice(0, maxPdfs);
    }

    if (pathsToEnqueue.length === 0) {
      return res.status(200).json({
        ok: true,
        enqueued: 0,
        queueIds: [],
        reason: `No PDFs found for section='${section}' in storage bucket 'lyceon-style-bank' at prefix 'sat/${section}/pdf/'`
      });
    }

    const queueIds: string[] = [];
    const effectiveMaxPages = pageMode === "all" ? 1 : maxPages;

    for (const pdfPath of pathsToEnqueue) {
      const payload = QueueRenderPagesRequestSchema.parse({
        type: "render_pages",
        bucket: "lyceon-style-bank",
        pdfPath,
        exam: "sat",
        section,
        dpi,
        maxPages: effectiveMaxPages,
        overwrite,
        pageMode,
        pageStart,
        pageEnd,
      });

      const { queueId } = await enqueueRenderPages(payload);
      queueIds.push(queueId);
    }

    return res.status(202).json({
      ok: true,
      enqueued: queueIds.length,
      queueIds,
      section,
      pageMode,
    });
  } catch (err: any) {
    console.error("[V4] Style bank render error:", err.message, err.supabaseError || "");
    
    const details: Record<string, unknown> = {
      message: err.message,
    };
    
    if (err.supabaseError) {
      details.code = err.supabaseError.code;
      details.hint = err.supabaseError.hint;
      details.details = err.supabaseError.details;
    }
    
    return res.status(500).json({ 
      ok: false, 
      error: "Failed to enqueue render jobs",
      details
    });
  }
});

/**
 * GET /api/ingestion-v4/style-bank/pages
 * Lists rendered pages from ingestion_v4_style_pages table
 */
ingestionV4Router.get("/style-bank/pages", async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    const section = req.query.section as string | undefined;
    const pdfPath = req.query.pdf_path as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);

    let query = supabase
      .from("ingestion_v4_style_pages")
      .select("*")
      .order("rendered_at", { ascending: false })
      .limit(limit);

    if (section) {
      // Case-insensitive match to handle legacy data (e.g., "MATH" vs "math")
      query = query.ilike("section", section.toLowerCase());
    }
    if (pdfPath) {
      query = query.eq("pdf_path", pdfPath);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[V4] Failed to list pages:", error);
      return res.status(500).json({ ok: false, error: "Failed to list pages" });
    }

    return res.status(200).json({ ok: true, pages: data });
  } catch (err: any) {
    console.error("[V4] List pages error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/style-bank/pages/stats
 * Returns top 50 most-used pages with usage counts and metadata for admin visibility
 */
ingestionV4Router.get("/style-bank/pages/stats", async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    const section = req.query.section as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    let query = supabase
      .from("ingestion_v4_style_pages")
      .select("id, bucket, pdf_path, page_number, image_path, domain, difficulty, skill, tag_confidence, diagram_present, teacher_used_count, qa_used_count, last_teacher_used_at, last_qa_used_at, rendered_at")
      .order("teacher_used_count", { ascending: false })
      .limit(limit);

    if (section) {
      // Case-insensitive match to handle legacy data (e.g., "MATH" vs "math")
      query = query.ilike("section", section.toLowerCase());
    }

    const { data, error } = await query;

    if (error) {
      console.error("[V4] Failed to get page stats:", error);
      return res.status(500).json({ ok: false, error: "Failed to get page stats" });
    }

    const stats = {
      totalPages: data?.length || 0,
      pagesWithDomain: data?.filter((p: any) => p.domain !== null).length || 0,
      pagesWithDifficulty: data?.filter((p: any) => p.difficulty !== null).length || 0,
      totalTeacherUsage: data?.reduce((sum: number, p: any) => sum + (p.teacher_used_count || 0), 0) || 0,
      totalQaUsage: data?.reduce((sum: number, p: any) => sum + (p.qa_used_count || 0), 0) || 0,
    };

    return res.status(200).json({ ok: true, stats, pages: data });
  } catch (err: any) {
    console.error("[V4] Page stats error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ============================================================================
// CLUSTERING ENDPOINTS
// ============================================================================

import {
  listClusters,
  getClusterById,
  getClusterPages,
  clusterStylePage,
  clusterBatch,
  sampleClusterCoherentPack,
  getUnclusteredPages,
  getUnclusteredPagesWithError,
  incrementClusterUsage,
} from "../ingestion_v4/services/v4Clustering";

/**
 * GET /api/ingestion-v4/clusters
 * List clusters for a section
 */
ingestionV4Router.get("/clusters", async (req: Request, res: Response) => {
  try {
    const section = req.query.section as "math" | "rw" | undefined;
    const limit = parseInt(req.query.limit as string) || 100;

    const clusters = await listClusters(section, limit);

    return res.status(200).json({
      ok: true,
      count: clusters.length,
      clusters,
    });
  } catch (err: any) {
    console.error("[V4] List clusters error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/clusters/:clusterId
 * Get a single cluster by ID
 */
ingestionV4Router.get("/clusters/:clusterId", async (req: Request, res: Response) => {
  try {
    const { clusterId } = req.params;
    const cluster = await getClusterById(clusterId);

    if (!cluster) {
      return res.status(404).json({ ok: false, error: "Cluster not found" });
    }

    return res.status(200).json({ ok: true, cluster });
  } catch (err: any) {
    console.error("[V4] Get cluster error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/clusters/:clusterId/pages
 * Get pages in a cluster
 */
ingestionV4Router.get("/clusters/:clusterId/pages", async (req: Request, res: Response) => {
  try {
    const { clusterId } = req.params;
    const limit = parseInt(req.query.limit as string) || 200;

    const pages = await getClusterPages(clusterId, limit);

    return res.status(200).json({
      ok: true,
      count: pages.length,
      pages,
    });
  } catch (err: any) {
    console.error("[V4] Get cluster pages error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/style-bank/pages/:pageId/cluster
 * Cluster a single page using LLM
 */
ingestionV4Router.post("/style-bank/pages/:pageId/cluster", async (req: Request, res: Response) => {
  try {
    const { pageId } = req.params;
    const supabase = getSupabaseAdmin();

    const { data: page, error } = await supabase
      .from("ingestion_v4_style_pages")
      .select("id, bucket, image_path, section, domain, difficulty, skill, primary_cluster_id, structure_signature")
      .eq("id", pageId)
      .single();

    if (error || !page) {
      return res.status(404).json({ ok: false, error: "Page not found" });
    }

    const result = await clusterStylePage(page);

    if (!result) {
      return res.status(500).json({ ok: false, error: "Clustering failed" });
    }

    return res.status(200).json({
      ok: true,
      clusterId: result.clusterId,
      clusterKey: result.clusterKey,
      confidence: result.confidence,
    });
  } catch (err: any) {
    console.error("[V4] Cluster page error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/style-bank/cluster
 * Cluster a batch of unclustered pages
 */
ingestionV4Router.post("/style-bank/cluster", requireAdminOrBypass, async (req: Request, res: Response) => {
  try {
    const section = (req.body.section || "math") as "math" | "rw";
    const limitPages = req.body.limitPages || 25;

    const result = await clusterBatch(section, limitPages);

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[V4] Cluster batch error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/style-bank/repair-links
 * Repair pages that have metadata (domain/skill) but no primary_cluster_id
 * 
 * Body:
 *   - section: "math" | "rw" (required)
 *   - limitPages?: number (default 50)
 * 
 * Returns:
 *   - attempted: number of pages found
 *   - linked: number successfully linked
 *   - createdClusters: number of new clusters created
 *   - failed: number of failures
 *   - sampleErrors: first 5 error messages
 */
ingestionV4Router.post("/style-bank/repair-links", requireAdminOrBypass, async (req: Request, res: Response) => {
  try {
    const { section, limitPages = 50 } = req.body;
    
    const sectionNormalized = normalizeSection(section);
    if (!sectionNormalized) {
      return res.status(400).json({ 
        ok: false, 
        error: `Invalid section: '${section}'. Must be 'math' or 'rw'` 
      });
    }
    
    const result = await repairUnlinkedPages(sectionNormalized, limitPages);
    
    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[V4] Repair links error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/clusters/sample-pack
 * Sample a coherent pack from a cluster
 */
ingestionV4Router.post("/clusters/sample-pack", async (req: Request, res: Response) => {
  try {
    const { section, clusterId, domain, difficulty, targetCount } = req.body;

    if (!section || !["math", "rw"].includes(section)) {
      return res.status(400).json({ ok: false, error: "Invalid section (must be 'math' or 'rw')" });
    }

    const supabase = getSupabaseAdmin();
    
    const { count: stylePagesCount } = await supabase
      .from("ingestion_v4_style_pages")
      .select("id", { count: "exact", head: true })
      .ilike("section", section);
      
    const { count: clusteredCount } = await supabase
      .from("ingestion_v4_style_pages")
      .select("id", { count: "exact", head: true })
      .ilike("section", section)
      .not("primary_cluster_id", "is", null);
      
    const { count: clusterCount } = await supabase
      .from("ingestion_v4_style_clusters")
      .select("id", { count: "exact", head: true })
      .ilike("section", section)
      .eq("active", true);

    const result = await sampleClusterCoherentPack(section, {
      clusterId,
      domain,
      difficulty,
      targetCount,
    });

    if (!result) {
      let reason = "Unknown issue";
      if ((stylePagesCount || 0) === 0) {
        reason = "no_style_pages: Run render first to create style pages";
      } else if ((clusteredCount || 0) === 0) {
        reason = "no_clustered_pages: Style pages exist but none are clustered. Run clustering first.";
      } else if ((clusterCount || 0) === 0) {
        reason = "no_clusters: Clustered pages exist but no active clusters found";
      } else {
        reason = "empty_clusters: Clusters exist but could not sample pages (may need more pages per cluster)";
      }
      
      return res.status(404).json({ 
        ok: false, 
        error: "No cluster or pages available",
        reason,
        stats: {
          stylePagesCount: stylePagesCount || 0,
          clusteredCount: clusteredCount || 0,
          clusterCount: clusterCount || 0,
        }
      });
    }

    await incrementClusterUsage(result.clusterId, 1);

    return res.status(200).json({
      ok: true,
      clusterId: result.clusterId,
      clusterKey: result.clusterKey,
      confidence: result.confidence,
      pageCount: result.pages.length,
      pages: result.pages.map(p => ({
        id: p.id,
        bucket: p.bucket,
        imagePath: p.image_path,
        section: p.section,
        domain: p.domain,
        difficulty: p.difficulty,
      })),
    });
  } catch (err: any) {
    console.error("[V4] Sample pack error:", err);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/style-bank/unclustered
 * Get unclustered pages for a section
 */
ingestionV4Router.get("/style-bank/unclustered", async (req: Request, res: Response) => {
  try {
    const section = (req.query.section || "math") as "math" | "rw";
    const limit = parseInt(req.query.limit as string) || 25;

    const result = await getUnclusteredPagesWithError(section, limit);

    if (result.error) {
      return res.status(200).json({
        ok: false,
        count: 0,
        pages: [],
        error: result.error,
      });
    }

    return res.status(200).json({
      ok: true,
      count: result.pages.length,
      pages: result.pages,
    });
  } catch (err: any) {
    console.error("[V4] Get unclustered pages error:", err);
    return res.status(500).json({ ok: false, error: err.message || "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/queue/tick-worker
 * Processes next queue item using v4QueueWorker (handles both batch_generate and render_pages)
 */
ingestionV4Router.post("/queue/tick-worker", async (_req: Request, res: Response) => {
  try {
    const result = await processNextQueueItem();

    if (!result.processed) {
      return res.status(200).json({ ok: true, ran: false, message: "No items to process" });
    }

    if (result.error) {
      return res.status(200).json({ 
        ok: true, 
        ran: true, 
        queueId: result.queueId,
        type: result.type,
        error: result.error 
      });
    }

    return res.status(200).json({
      ok: true,
      ran: true,
      queueId: result.queueId,
      type: result.type,
      result: result.result,
    });
  } catch (err: any) {
    console.error("[V4] Queue tick-worker error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ============================================================================
// ADMIN DASHBOARD ENDPOINT
// ============================================================================

/**
 * GET /api/ingestion-v4/admin/dashboard
 * Get comprehensive dashboard stats for admin UI
 */
ingestionV4Router.get("/admin/dashboard", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    
    const [
      { count: jobsQueuedCount },
      { count: jobsRunningCount },
      { count: jobsCompletedCount },
      { count: queuePendingCount },
      { count: clustersCount },
      { count: stylePagesCount },
      { count: unclusteredCount },
      workerStatus
    ] = await Promise.all([
      supabase.from("ingestion_v4_jobs").select("*", { count: "exact", head: true }).eq("status", "QUEUED"),
      supabase.from("ingestion_v4_jobs").select("*", { count: "exact", head: true }).eq("status", "RUNNING"),
      supabase.from("ingestion_v4_jobs").select("*", { count: "exact", head: true }).eq("status", "COMPLETED"),
      supabase.from("ingestion_v4_queue").select("*", { count: "exact", head: true }).eq("status", "QUEUED"),
      supabase.from("ingestion_v4_style_clusters").select("*", { count: "exact", head: true }).eq("active", true),
      supabase.from("ingestion_v4_style_pages").select("*", { count: "exact", head: true }),
      supabase.from("ingestion_v4_style_pages").select("*", { count: "exact", head: true }).is("primary_cluster_id", null),
      Promise.resolve(getWorkerStatus())
    ]);
    
    const { data: recentJobs } = await supabase
      .from("ingestion_v4_jobs")
      .select("id, test_code, status, target_count, stats, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(5);
    
    const { data: recentDrafts } = await supabase
      .from("ingestion_v4_drafts")
      .select("id, job_id, qa_ok, style_cluster_key, used_cluster_sampling, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    
    return res.status(200).json({
      ok: true,
      worker: workerStatus,
      jobs: {
        queued: jobsQueuedCount || 0,
        running: jobsRunningCount || 0,
        completed: jobsCompletedCount || 0,
        recent: recentJobs || []
      },
      queue: {
        pending: queuePendingCount || 0
      },
      clusters: {
        total: clustersCount || 0,
        stylePages: stylePagesCount || 0,
        unclustered: unclusteredCount || 0
      },
      recentDrafts: recentDrafts || [],
      config: {
        workerEnabled: process.env.V4_WORKER_ENABLED === "true",
        geminiEnabled: isV4GeminiEnabled(),
        geminiKeySource: getGeminiKeySource(),
        clusterSamplingEnabled: process.env.V4_USE_CLUSTER_SAMPLING === "true"
      }
    });
  } catch (err: any) {
    console.error("[V4] Dashboard error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ============================================================================
// ALWAYS-ON WORKER ENDPOINTS
// ============================================================================

import { getWorkerStatus, startWorker, stopWorker, getWorkerConfig, setWorkerEnabledInDb } from "../ingestion_v4/services/v4AlwaysOnWorker";
import { runPdfFanout } from "../ingestion_v4/services/v4PdfFanout";

/**
 * GET /api/ingestion-v4/worker/status
 * Get always-on worker health status
 */
ingestionV4Router.get("/worker/status", async (_req: Request, res: Response) => {
  try {
    const status = getWorkerStatus();
    return res.status(200).json({ ok: true, ...status });
  } catch (err: any) {
    console.error("[V4] Worker status error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/worker/start
 * Start the always-on worker (if enabled)
 */
ingestionV4Router.post("/worker/start", async (_req: Request, res: Response) => {
  try {
    startWorker();
    const status = getWorkerStatus();
    return res.status(200).json({ ok: true, message: "Worker start initiated", ...status });
  } catch (err: any) {
    console.error("[V4] Worker start error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/worker/stop
 * Stop the always-on worker
 */
ingestionV4Router.post("/worker/stop", async (_req: Request, res: Response) => {
  try {
    stopWorker();
    const status = getWorkerStatus();
    return res.status(200).json({ ok: true, message: "Worker stop initiated", ...status });
  } catch (err: any) {
    console.error("[V4] Worker stop error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * GET /api/ingestion-v4/worker/config
 * Get worker enabled configuration (env + db)
 */
ingestionV4Router.get("/worker/config", requireAdminOrBypass, async (_req: Request, res: Response) => {
  try {
    const config = await getWorkerConfig();
    return res.status(200).json({ 
      ok: true, 
      build: V4_BUILD_VERSION,
      geminiEnabled: isV4GeminiEnabled(),
      geminiKeySource: getGeminiKeySource(),
      ...config 
    });
  } catch (err: any) {
    console.error("[V4] Worker config error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/worker/config
 * Set worker enabled in database (admin toggle)
 */
ingestionV4Router.post("/worker/config", async (req: Request, res: Response) => {
  try {
    const { workerEnabled } = req.body;
    
    if (typeof workerEnabled !== "boolean") {
      return res.status(400).json({ ok: false, error: "workerEnabled must be a boolean" });
    }
    
    await setWorkerEnabledInDb(workerEnabled);
    const config = await getWorkerConfig();
    
    return res.status(200).json({ 
      ok: true, 
      message: `Worker enabled set to ${workerEnabled} in database`,
      ...config 
    });
  } catch (err: any) {
    console.error("[V4] Worker config update error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ============================================================================
// ADMIN FANOUT ENDPOINT
// ============================================================================

/**
 * POST /api/ingestion-v4/admin/fanout-pdfs
 * Scans Supabase Storage for all PDFs and enqueues render_pages jobs
 * for any PDFs that don't already have a pending/running queue item.
 * 
 * Body:
 *   - section?: "math" | "rw" (optional, defaults to all)
 *   - dpi?: number (default 150)
 *   - maxPages?: number (default 60)
 *   - pageMode?: "first" | "all" | "range" (default "first")
 *   - dryRun?: boolean (default false)
 * 
 * Returns:
 *   - discovered: number of PDFs found in storage
 *   - enqueued: number of new queue items created
 *   - skipped: number of PDFs already queued or dry run
 *   - errors: number of failures
 *   - details: array of per-PDF results
 */
ingestionV4Router.post("/admin/fanout-pdfs", requireAdminOrBypass, async (req: Request, res: Response) => {
  try {
    const { section, dpi, maxPages, pageMode, dryRun, overwrite } = req.body;
    
    const sectionNormalized = section ? normalizeSection(section) : undefined;
    if (section && !sectionNormalized) {
      return res.status(400).json({ 
        ok: false, 
        error: `Invalid section: '${section}'. Must be 'math' or 'rw'` 
      });
    }

    const result = await runPdfFanout({
      section: sectionNormalized,
      dpi: typeof dpi === "number" ? dpi : undefined,
      maxPages: typeof maxPages === "number" ? maxPages : undefined,
      pageMode: pageMode === "first" || pageMode === "all" || pageMode === "range" ? pageMode : undefined,
      dryRun: typeof dryRun === "boolean" ? dryRun : false,
      overwrite: typeof overwrite === "boolean" ? overwrite : false,
    });

    return res.status(200).json({
      ok: result.ok,
      discovered: result.discovered,
      enqueued: result.enqueued,
      skipped: result.skipped,
      errors: result.errors,
      details: result.details,
    });
  } catch (err: any) {
    console.error("[V4] Admin fanout-pdfs error:", err.message);
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

/**
 * POST /api/ingestion-v4/admin/proof
 * End-to-end proof path: fanout → tick worker → verify style_pages → cluster
 * 
 * Returns a full debug snapshot with:
 *   - ok: boolean
 *   - violations: string[] (each violation message)
 *   - counts snapshot: stylePages, clustering, clusters
 *   - sampleErrors (max 5) from clustering if any
 *   - geminiUsed flag
 *   - workerTicks summary
 *   - eligibility debug info (first eligible page sample)
 * 
 * Body:
 *   - section: "math" | "rw" (required)
 *   - limit?: number (default 1) - how many PDFs to fanout
 *   - maxTicks?: number (default 5) - max worker ticks
 *   - maxClusterPages?: number (default 10) - max pages to cluster
 *   - dryRun?: boolean (default false)
 */
ingestionV4Router.post("/admin/proof", requireAdminOrBypass, async (req: Request, res: Response) => {
  try {
    const { section, limit = 1, maxTicks = 5, maxClusterPages = 10, dryRun = false } = req.body;
    
    const sectionNormalized = normalizeSection(section);
    if (!sectionNormalized) {
      return res.status(400).json({ 
        ok: false, 
        violations: [`Invalid or missing section: '${section}'. Must be 'math' or 'rw'`],
        error: `Invalid or missing section: '${section}'. Must be 'math' or 'rw'` 
      });
    }

    const errors: string[] = [];
    const violations: string[] = [];
    const summary: Record<string, unknown> = {
      build: V4_BUILD_VERSION,
      section: sectionNormalized,
      geminiEnabled: isV4GeminiEnabled(),
      geminiKeySource: getGeminiKeySource(),
    };

    // Step 1: Fanout PDFs
    let fanoutResult;
    try {
      fanoutResult = await runPdfFanout({
        section: sectionNormalized,
        dryRun,
        dpi: 150,
        maxPages: 600,
      });
      summary.fanout = {
        discovered: fanoutResult.discovered,
        enqueued: fanoutResult.enqueued,
        skipped: fanoutResult.skipped,
        errors: fanoutResult.errors,
      };
    } catch (err: any) {
      errors.push(`Fanout failed: ${err.message}`);
      summary.fanout = { error: err.message };
    }

    // Step 2: Tick worker with rich results
    let ticksProcessed = 0;
    let queueItemsCompleted = 0;
    let queueItemsFailed = 0;
    const tickDetails: Array<{queueId?: string; type?: string; status: string; error?: string}> = [];
    
    if (!dryRun) {
      for (let i = 0; i < maxTicks; i++) {
        try {
          const tickResult = await processNextQueueItem();
          if (tickResult.processed) {
            ticksProcessed++;
            if (tickResult.error) {
              queueItemsFailed++;
              tickDetails.push({
                queueId: tickResult.queueId,
                type: tickResult.type,
                status: "FAILED",
                error: tickResult.error,
              });
            } else {
              queueItemsCompleted++;
              tickDetails.push({
                queueId: tickResult.queueId,
                type: tickResult.type,
                status: "COMPLETED",
              });
            }
          } else {
            break; // No more items to process
          }
          await new Promise(r => setTimeout(r, 500));
        } catch (err: any) {
          errors.push(`Tick ${i + 1} failed: ${err.message}`);
          break;
        }
      }
    }
    summary.workerTicks = { 
      processed: ticksProcessed, 
      completed: queueItemsCompleted, 
      failed: queueItemsFailed,
      details: tickDetails.slice(0, 5), // cap at 5 for response size
    };

    // Step 3: Check style_pages count with section normalization debugging
    const supabase = getSupabaseAdmin();
    
    // Get total style pages for this section (case-insensitive to handle legacy data)
    const { count: stylePagesCount } = await supabase
      .from("ingestion_v4_style_pages")
      .select("*", { count: "exact", head: true })
      .ilike("section", sectionNormalized);
    
    // Get unclustered pages (case-insensitive)
    const { count: unclusteredCount } = await supabase
      .from("ingestion_v4_style_pages")
      .select("*", { count: "exact", head: true })
      .ilike("section", sectionNormalized)
      .is("primary_cluster_id", null);

    // Eligibility debug: Also check case-insensitive counts to detect section mismatch
    const { count: stylePagesCountIlike } = await supabase
      .from("ingestion_v4_style_pages")
      .select("*", { count: "exact", head: true })
      .ilike("section", sectionNormalized);
    
    const { count: unclusteredCountIlike } = await supabase
      .from("ingestion_v4_style_pages")
      .select("*", { count: "exact", head: true })
      .ilike("section", sectionNormalized)
      .is("primary_cluster_id", null);
    
    // Get first eligible page sample for debugging
    const { data: firstEligiblePages } = await supabase
      .from("ingestion_v4_style_pages")
      .select("id, section, domain, skill, image_path")
      .is("primary_cluster_id", null)
      .limit(1);
    
    const firstEligiblePage = firstEligiblePages?.[0] || null;
    
    // Check for section normalization mismatch
    const exactTotal = stylePagesCount || 0;
    const ilikeTotal = stylePagesCountIlike || 0;
    const hasSectionMismatch = ilikeTotal > exactTotal;
    
    if (hasSectionMismatch) {
      violations.push(
        `SECTION_NORMALIZATION_MISMATCH: Found ${ilikeTotal} pages with section ILIKE '${sectionNormalized}' ` +
        `but only ${exactTotal} with exact match. Some pages may have non-lowercase section values.`
      );
    }

    summary.stylePages = {
      total: stylePagesCount || 0,
      unclustered: unclusteredCount || 0,
    };
    
    summary.eligibilityDebug = {
      eligibleUnclusteredCount: unclusteredCount || 0,
      ilikeMatchTotal: ilikeTotal,
      ilikeMatchUnclustered: unclusteredCountIlike || 0,
      sectionMismatch: hasSectionMismatch,
      firstEligiblePage: firstEligiblePage ? {
        id: firstEligiblePage.id,
        section: firstEligiblePage.section,
        domain: firstEligiblePage.domain,
        skill: firstEligiblePage.skill,
        image_path: firstEligiblePage.image_path,
      } : null,
    };

    // Count clusters BEFORE clustering
    const { count: clustersBefore } = await supabase
      .from("ingestion_v4_style_clusters")
      .select("*", { count: "exact", head: true })
      .eq("section", sectionNormalized);

    // Step 4: Attempt clustering (now works even without Gemini via fallback)
    let clusteringResult;
    if (!dryRun && (unclusteredCount || 0) > 0) {
      try {
        clusteringResult = await clusterBatch(sectionNormalized, Math.min(maxClusterPages, unclusteredCount || 10));
        summary.clustering = {
          attemptedCount: clusteringResult.attemptedCount,
          clusteredCount: clusteringResult.clusteredCount,
          createdClusters: clusteringResult.createdClusters,
          failedCount: clusteringResult.failedCount,
          fallbackCount: clusteringResult.fallbackCount,
          geminiUsed: isV4GeminiEnabled(),
        };
      } catch (err: any) {
        errors.push(`Clustering failed: ${err.message}`);
        summary.clustering = { error: err.message };
      }
    } else {
      summary.clustering = {
        attemptedCount: 0,
        clusteredCount: 0,
        createdClusters: 0,
        failedCount: 0,
        skipped: true,
        reason: dryRun ? "dry_run" : "no_unclustered_pages",
      };
    }

    // Count clusters AFTER clustering
    const { count: clustersAfter } = await supabase
      .from("ingestion_v4_style_clusters")
      .select("*", { count: "exact", head: true })
      .eq("section", sectionNormalized);
    
    const clustersCreated = (clustersAfter || 0) - (clustersBefore || 0);
    
    summary.clusters = {
      before: clustersBefore || 0,
      after: clustersAfter || 0,
      created: clustersCreated,
    };
    
    // Include sample errors (max 5) if present
    const sampleErrors: string[] = clusteringResult?.sampleErrors || [];
    if (sampleErrors.length > 0) {
      summary.sampleErrors = sampleErrors.slice(0, 5);
    }
    summary.errors = errors;

    // Step 5: Check for unlinked pages (pages with ANY metadata but no primary_cluster_id)
    const unlinkedPages = await getUnlinkedPagesWithMetadata(sectionNormalized, 3);
    const { count: unlinkedAfterClusteringCount } = await supabase
      .from("ingestion_v4_style_pages")
      .select("*", { count: "exact", head: true })
      .ilike("section", sectionNormalized)
      .is("primary_cluster_id", null)
      .or("domain.not.is.null,skill.not.is.null,difficulty.not.is.null");
    
    summary.unlinkedPages = {
      count: unlinkedAfterClusteringCount || 0,
      samplePages: unlinkedPages.slice(0, 3).map(p => ({
        id: p.id,
        imagePath: p.image_path,
        domain: p.domain,
        skill: p.skill,
        difficulty: p.difficulty,
      })),
    };
    
    if ((unlinkedAfterClusteringCount || 0) > 0) {
      violations.push(
        `UNLINKED_PAGES_AFTER_CLUSTERING: ${unlinkedAfterClusteringCount} pages have metadata (domain/skill) but no primary_cluster_id. ` +
        `Run POST /style-bank/repair-links to fix.`
      );
    }

    // INVARIANT VALIDATION: Assert clustering invariants and collect violations
    if (!dryRun && clusteringResult) {
      // Invariant 1: attemptedCount > 0 when unclustered pages exist and were fetched
      // BUT only if exact section match found unclustered pages
      if (clusteringResult.attemptedCount === 0 && (unclusteredCount || 0) > 0) {
        violations.push(
          `CLUSTERING_INVARIANT_VIOLATION: attemptedCount === 0 but ${unclusteredCount} unclustered pages existed. ` +
          `This indicates clusterBatch() did not fetch or process any pages. ` +
          `Check eligibilityDebug for section mismatch.`
        );
      }
      
      // Invariant 2: clusters.created > 0 when pages were successfully clustered and none existed before
      if (clusteringResult.attemptedCount > 0 && 
          clusteringResult.clusteredCount > 0 && 
          (clustersBefore || 0) === 0 && 
          clustersCreated === 0) {
        violations.push(
          `CLUSTERING_INVARIANT_VIOLATION: clusters.created === 0 but ${clusteringResult.attemptedCount} pages ` +
          `were attempted with ${clusteringResult.clusteredCount} clustered, and no clusters existed before. ` +
          `This indicates cluster creation failed silently.`
        );
      }
      
      // Invariant 3: If all pages failed (100% failure rate), that's a violation
      if (clusteringResult.attemptedCount > 0 && 
          clusteringResult.clusteredCount === 0 && 
          clusteringResult.failedCount === clusteringResult.attemptedCount) {
        const errorSummary = sampleErrors.length > 0 
          ? sampleErrors.slice(0, 3).join("; ") 
          : "No sample errors captured";
        violations.push(
          `CLUSTERING_INVARIANT_VIOLATION: All ${clusteringResult.attemptedCount} attempted pages failed to cluster. ` +
          `Sample errors: ${errorSummary}`
        );
      }
    }
    
    // Add violations to summary
    summary.violations = violations;
    
    // Return 200 with ok:false if violations exist (NOT 500 - that's for true server exceptions)
    const overallOk = errors.length === 0 && violations.length === 0;

    return res.status(200).json({
      ok: overallOk,
      violations,
      ...summary,
    });
  } catch (err: any) {
    // True server exception - 500
    console.error("[V4] Admin proof error:", err.message);
    return res.status(500).json({ 
      ok: false, 
      violations: [`SERVER_EXCEPTION: ${err.message}`],
      error: err.message 
    });
  }
});

/**
 * GET /api/ingestion-v4/catalog/status
 * Real-time catalog status for the admin UI
 */
ingestionV4Router.get("/catalog/status", async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    
    const [mathPages, rwPages, mathClusters, rwClusters, mathUnclustered, rwUnclustered, queuePending] = await Promise.all([
      supabase.from("ingestion_v4_style_pages").select("*", { count: "exact", head: true }).ilike("section", "math"),
      supabase.from("ingestion_v4_style_pages").select("*", { count: "exact", head: true }).ilike("section", "rw"),
      supabase.from("ingestion_v4_style_clusters").select("*", { count: "exact", head: true }).eq("section", "math").eq("active", true),
      supabase.from("ingestion_v4_style_clusters").select("*", { count: "exact", head: true }).eq("section", "rw").eq("active", true),
      supabase.from("ingestion_v4_style_pages").select("*", { count: "exact", head: true }).ilike("section", "math").is("primary_cluster_id", null),
      supabase.from("ingestion_v4_style_pages").select("*", { count: "exact", head: true }).ilike("section", "rw").is("primary_cluster_id", null),
      supabase.from("ingestion_v4_queue").select("*", { count: "exact", head: true }).eq("status", "QUEUED"),
    ]);
    
    const mathRendered = mathPages.count || 0;
    const rwRendered = rwPages.count || 0;
    const mathClusterCount = mathClusters.count || 0;
    const rwClusterCount = rwClusters.count || 0;
    const mathUnclusteredCount = mathUnclustered.count || 0;
    const rwUnclusteredCount = rwUnclustered.count || 0;
    
    const getMathStatus = () => {
      if (mathRendered === 0) return "empty";
      if (mathUnclusteredCount > 0) return "clustering";
      return "ready";
    };
    
    const getRwStatus = () => {
      if (rwRendered === 0) return "empty";
      if (rwUnclusteredCount > 0) return "clustering";
      return "ready";
    };
    
    const getOverallStatus = () => {
      if (mathRendered === 0 && rwRendered === 0) return "empty";
      if (mathUnclusteredCount > 0 || rwUnclusteredCount > 0 || (queuePending.count || 0) > 0) return "processing";
      return "ready";
    };
    
    return res.status(200).json({
      ok: true,
      math: {
        pdfCount: 0,
        renderedPages: mathRendered,
        clusteredPages: mathRendered - mathUnclusteredCount,
        unclusteredPages: mathUnclusteredCount,
        clusterCount: mathClusterCount,
        status: getMathStatus(),
        progress: mathRendered > 0 ? Math.round(((mathRendered - mathUnclusteredCount) / mathRendered) * 100) : 0,
      },
      rw: {
        pdfCount: 0,
        renderedPages: rwRendered,
        clusteredPages: rwRendered - rwUnclusteredCount,
        unclusteredPages: rwUnclusteredCount,
        clusterCount: rwClusterCount,
        status: getRwStatus(),
        progress: rwRendered > 0 ? Math.round(((rwRendered - rwUnclusteredCount) / rwRendered) * 100) : 0,
      },
      overallStatus: getOverallStatus(),
      queuePending: queuePending.count || 0,
    });
  } catch (err: any) {
    console.error("[V4] Catalog status error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ingestion-v4/domains
 * Get available domains and skills for question generation filters
 */
ingestionV4Router.get("/domains", async (req: Request, res: Response) => {
  try {
    const section = normalizeSection(req.query.section as string) || "math";
    const supabase = getSupabaseAdmin();
    
    const { data: pages } = await supabase
      .from("ingestion_v4_style_pages")
      .select("domain, skill")
      .ilike("section", section)
      .not("domain", "is", null);
    
    const domainMap = new Map<string, Set<string>>();
    const domainCounts = new Map<string, number>();
    
    for (const page of pages || []) {
      if (page.domain) {
        if (!domainMap.has(page.domain)) {
          domainMap.set(page.domain, new Set());
          domainCounts.set(page.domain, 0);
        }
        domainCounts.set(page.domain, (domainCounts.get(page.domain) || 0) + 1);
        if (page.skill) {
          domainMap.get(page.domain)!.add(page.skill);
        }
      }
    }
    
    const domains = Array.from(domainMap.entries()).map(([domain, skills]) => ({
      domain,
      skills: Array.from(skills).sort(),
      count: domainCounts.get(domain) || 0,
    })).sort((a, b) => b.count - a.count);
    
    return res.status(200).json({ ok: true, domains });
  } catch (err: any) {
    console.error("[V4] Domains error:", err.message);
    return res.status(500).json({ ok: false, error: err.message, domains: [] });
  }
});

/**
 * POST /api/ingestion-v4/generate
 * Start question generation with optional filters
 */
ingestionV4Router.post("/generate", async (req: Request, res: Response) => {
  try {
    const { section = "math", count = 10, domain, skill, difficulty } = req.body;
    const sectionNormalized = normalizeSection(section);
    
    if (!sectionNormalized) {
      return res.status(400).json({ ok: false, error: "Invalid section" });
    }
    
    const supabase = getSupabaseAdmin();
    
    const testCode = `SAT-${sectionNormalized.toUpperCase()}-${Date.now().toString(36)}`;
    const { data: job, error: jobError } = await supabase
      .from("ingestion_v4_jobs")
      .insert({
        test_code: testCode,
        status: "QUEUED",
        target_count: count,
        stats: { generated: 0, qa_passed: 0, qa_failed: 0, domain, skill, difficulty },
      })
      .select()
      .single();
    
    if (jobError) {
      console.error("[V4] Create job error:", jobError);
      return res.status(500).json({ ok: false, error: "Failed to create job" });
    }
    
    const batchSize = 10;
    const batches = Math.ceil(count / batchSize);
    
    for (let i = 0; i < batches; i++) {
      const batchCount = Math.min(batchSize, count - (i * batchSize));
      await supabase.from("ingestion_v4_queue").insert({
        type: "batch_generate",
        status: "QUEUED",
        payload: {
          type: "batch_generate",
          count: batchCount,
          section: sectionNormalized,
          sleepMs: 1000,
          domain,
          skill,
          difficulty,
          jobId: job.id,
        },
      });
    }
    
    return res.status(200).json({
      ok: true,
      jobId: job.id,
      testCode,
      targetCount: count,
      batchesQueued: batches,
    });
  } catch (err: any) {
    console.error("[V4] Generate error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/ingestion-v4/jobs/:jobId/cancel
 * Cancel a running job
 */
ingestionV4Router.post("/jobs/:jobId/cancel", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const supabase = getSupabaseAdmin();
    
    const { error } = await supabase
      .from("ingestion_v4_jobs")
      .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
      .eq("id", jobId);
    
    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to cancel job" });
    }
    
    await supabase
      .from("ingestion_v4_queue")
      .update({ status: "CANCELLED" })
      .eq("status", "QUEUED")
      .contains("payload", { jobId });
    
    return res.status(200).json({ ok: true, cancelled: true });
  } catch (err: any) {
    console.error("[V4] Cancel job error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * POST /api/ingestion-v4/queue/:itemId/retry
 * Retry a failed queue item
 */
ingestionV4Router.post("/queue/:itemId/retry", async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const supabase = getSupabaseAdmin();
    
    const { error } = await supabase
      .from("ingestion_v4_queue")
      .update({ 
        status: "QUEUED", 
        error_message: null,
        retry_count: 0,
        updated_at: new Date().toISOString() 
      })
      .eq("id", itemId);
    
    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to retry item" });
    }
    
    return res.status(200).json({ ok: true, requeued: true });
  } catch (err: any) {
    console.error("[V4] Retry queue item error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/ingestion-v4/queue/:itemId
 * Delete a queue item
 */
ingestionV4Router.delete("/queue/:itemId", async (req: Request, res: Response) => {
  try {
    const { itemId } = req.params;
    const supabase = getSupabaseAdmin();
    
    const { error } = await supabase
      .from("ingestion_v4_queue")
      .delete()
      .eq("id", itemId);
    
    if (error) {
      return res.status(500).json({ ok: false, error: "Failed to delete item" });
    }
    
    return res.status(200).json({ ok: true, deleted: true });
  } catch (err: any) {
    console.error("[V4] Delete queue item error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ingestion-v4/errors/recent
 * Get recent errors from failed queue items
 */
ingestionV4Router.get("/errors/recent", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const supabase = getSupabaseAdmin();
    
    const { data: items } = await supabase
      .from("ingestion_v4_queue")
      .select("id, type, error_message, updated_at")
      .eq("status", "FAILED")
      .order("updated_at", { ascending: false })
      .limit(limit);
    
    const errors = (items || []).map(item => ({
      id: item.id,
      type: item.type,
      error: item.error_message || "Unknown error",
      timestamp: item.updated_at,
    }));
    
    return res.status(200).json({ ok: true, errors });
  } catch (err: any) {
    console.error("[V4] Recent errors error:", err.message);
    return res.status(500).json({ ok: false, error: err.message, errors: [] });
  }
});

/**
 * POST /api/ingestion-v4/catalog/reset
 * Reset the style catalog (debug action)
 */
ingestionV4Router.post("/catalog/reset", requireAdminOrBypass, async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabaseAdmin();
    
    await supabase.from("ingestion_v4_queue").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("ingestion_v4_style_pages").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("ingestion_v4_style_clusters").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    
    console.log("[V4] Catalog reset completed");
    return res.status(200).json({ ok: true, reset: true });
  } catch (err: any) {
    console.error("[V4] Catalog reset error:", err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});
