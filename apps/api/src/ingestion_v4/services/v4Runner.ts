import type { V4JobRequest, GeneratedQuestionDraft, QaResult, PdfStyleRef } from "../types";
import type { BatchRunRequest } from "../types/schemas";
import { generateDraftWithTeacher, qaDraftWithTa, generateDraftWithStylePages } from "./v4JobService";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { publishApprovedDraftToQuestions } from "./v4Publisher";
import { pickStyleRefsForJob } from "./styleSampler";
import { 
  pickStylePagesForJob, 
  incrementTeacherUsage, 
  incrementQaUsage,
  type StylePackResult 
} from "./stylePageSampler";
import { v4 as uuidv4 } from "uuid";

export interface RunOnceResult {
  draftId: string | null;
  qaOk: boolean;
  issues: string[];
  error?: string;
  publishedCanonicalId?: string;
}

export interface BatchRunResult {
  ok: boolean;
  jobId: string;
  attempted: number;
  generated: number;
  qaPassed: number;
  qaFailed: number;
  published: number;
  completed: boolean;
  stoppedReason?: string;
}

interface JobRecord {
  id: string;
  test_code: string;
  target_count: number;
  style_refs: PdfStyleRef[];
  stats: { generated: number; qa_passed: number; qa_failed: number };
  status: string;
  section?: "math" | "rw" | null;
  locked_at?: string | null;
  locked_by?: string | null;
  lock_heartbeat_at?: string | null;
}

const LOCK_TIMEOUT_MINUTES = 5;
const HEARTBEAT_INTERVAL_ITERATIONS = 5;
const LOCK_ERROR_MESSAGE = "Job is currently locked/running";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateRunnerId(): string {
  return `runner-${uuidv4().slice(0, 8)}-${Date.now()}`;
}

export function isLockError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message === LOCK_ERROR_MESSAGE;
  }
  return false;
}

export async function acquireJobLock(jobId: string, runnerId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const staleTime = new Date(Date.now() - LOCK_TIMEOUT_MINUTES * 60 * 1000).toISOString();
  
  const { data: unlocked, error: unlockedErr } = await supabase
    .from("ingestion_v4_jobs")
    .update({
      locked_at: now,
      locked_by: runnerId,
      lock_heartbeat_at: now,
      started_at: now
    })
    .eq("id", jobId)
    .is("locked_at", null)
    .select("id");
  
  if (!unlockedErr && unlocked && unlocked.length > 0) {
    return true;
  }

  const { data: stale, error: staleErr } = await supabase
    .from("ingestion_v4_jobs")
    .update({
      locked_at: now,
      locked_by: runnerId,
      lock_heartbeat_at: now,
      started_at: now
    })
    .eq("id", jobId)
    .lt("lock_heartbeat_at", staleTime)
    .select("id");
  
  if (!staleErr && stale && stale.length > 0) {
    return true;
  }
  
  return false;
}

export async function updateHeartbeat(jobId: string, runnerId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  
  await supabase
    .from("ingestion_v4_jobs")
    .update({ lock_heartbeat_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("locked_by", runnerId);
}

export async function releaseJobLock(jobId: string, runnerId: string, finalStatus: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  
  await supabase
    .from("ingestion_v4_jobs")
    .update({
      locked_at: null,
      locked_by: null,
      lock_heartbeat_at: null,
      status: finalStatus,
      completed_at: finalStatus === "COMPLETED" || finalStatus === "FAILED" ? now : null
    })
    .eq("id", jobId)
    .eq("locked_by", runnerId);
}

export async function runOnceForJob(jobId: string): Promise<RunOnceResult> {
  const supabase = getSupabaseAdmin();

  const { data: job, error: jobError } = await supabase
    .from("ingestion_v4_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError || !job) {
    throw new Error(jobError?.code === "PGRST116" ? "Job not found" : "Failed to fetch job");
  }

  const requestedRefs = (job.style_refs as PdfStyleRef[]) || [];
  const { refs: sampledRefs } = await pickStyleRefsForJob({
    jobId,
    requested: requestedRefs.length > 0 ? requestedRefs : null,
    fromLibrary: { exam: job.test_code || "SAT" }
  });
  
  const jobRequest: V4JobRequest = {
    testCode: job.test_code || "SAT",
    targetCount: job.target_count,
    styleRefs: requestedRefs
  };

  let draft: GeneratedQuestionDraft;
  try {
    draft = await generateDraftWithTeacher(jobRequest, sampledRefs);
  } catch (teacherErr: any) {
    console.error("[V4] Teacher generation failed:", teacherErr.message);
    await supabase
      .from("ingestion_v4_jobs")
      .update({ last_error: teacherErr.message })
      .eq("id", jobId);
    throw teacherErr;
  }

  let qaResult: QaResult;
  try {
    qaResult = await qaDraftWithTa(draft);
  } catch (qaErr: any) {
    console.error("[V4] QA failed:", qaErr.message);
    
    const { data: insertedDraft } = await supabase
      .from("ingestion_v4_drafts")
      .insert({
        job_id: jobId,
        draft: draft,
        qa: null,
        qa_ok: false,
        style_refs_used: sampledRefs,
        used_cluster_sampling: false
      })
      .select("id")
      .single();

    const currentStats = job.stats as { generated: number; qa_passed: number; qa_failed: number };
    await supabase
      .from("ingestion_v4_jobs")
      .update({
        stats: {
          generated: currentStats.generated + 1,
          qa_passed: currentStats.qa_passed,
          qa_failed: currentStats.qa_failed + 1
        },
        last_error: qaErr.message
      })
      .eq("id", jobId);

    return {
      draftId: insertedDraft?.id || null,
      qaOk: false,
      issues: [],
      error: "QA failed"
    };
  }

  const { data: insertedDraft, error: draftError } = await supabase
    .from("ingestion_v4_drafts")
    .insert({
      job_id: jobId,
      draft: draft,
      qa: qaResult,
      qa_ok: qaResult.ok,
      style_refs_used: sampledRefs,
      used_cluster_sampling: false
    })
    .select("id")
    .single();

  if (draftError) {
    console.error("[V4] Failed to insert draft:", draftError);
    throw new Error("Failed to persist draft");
  }

  const currentStats = job.stats as { generated: number; qa_passed: number; qa_failed: number };
  const newStats = {
    generated: currentStats.generated + 1,
    qa_passed: currentStats.qa_passed + (qaResult.ok ? 1 : 0),
    qa_failed: currentStats.qa_failed + (qaResult.ok ? 0 : 1)
  };

  const newStatus = newStats.generated >= job.target_count ? "COMPLETED" : "QUEUED";

  await supabase
    .from("ingestion_v4_jobs")
    .update({ stats: newStats, status: newStatus, last_error: null })
    .eq("id", jobId);

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

  return {
    draftId: insertedDraft.id,
    qaOk: qaResult.ok,
    issues: qaResult.issues,
    publishedCanonicalId
  };
}

export async function runBatchForJob(
  jobId: string,
  opts: BatchRunRequest
): Promise<BatchRunResult> {
  const supabase = getSupabaseAdmin();
  const runnerId = generateRunnerId();

  const { data: job, error: jobError } = await supabase
    .from("ingestion_v4_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (jobError) {
    if (jobError.code === "PGRST116") {
      throw new Error("Job not found");
    }
    throw new Error("Failed to fetch job");
  }

  if (!job) {
    throw new Error("Job not found");
  }

  if (job.status === "COMPLETED" || job.status === "FAILED") {
    throw new Error(`Job already ${job.status.toLowerCase()}`);
  }

  const lockAcquired = await acquireJobLock(jobId, runnerId);
  if (!lockAcquired) {
    throw new Error("Job is currently locked/running");
  }

  await supabase
    .from("ingestion_v4_jobs")
    .update({ status: "RUNNING" })
    .eq("id", jobId);

  console.log(`[V4] Starting batch run for job ${jobId}: count=${opts.count}, sleepMs=${opts.sleepMs}, section=${opts.section}, runnerId=${runnerId}`);

  const result: BatchRunResult = {
    ok: true,
    jobId,
    attempted: 0,
    generated: 0,
    qaPassed: 0,
    qaFailed: 0,
    published: 0,
    completed: false
  };

  let consecutiveQaFails = 0;

  try {
    for (let i = 0; i < opts.count; i++) {
      result.attempted++;

      if (i > 0 && i % HEARTBEAT_INTERVAL_ITERATIONS === 0) {
        await updateHeartbeat(jobId, runnerId);
      }

      try {
        const runResult = await runOnceInternal(jobId, job as JobRecord, i, opts.section);

        result.generated++;

        if (runResult.qaOk) {
          result.qaPassed++;
          consecutiveQaFails = 0;
          if (runResult.publishedCanonicalId) {
            result.published++;
          }
        } else {
          result.qaFailed++;
          consecutiveQaFails++;

          if (opts.stopOnQaFail) {
            result.stoppedReason = "QA failed (stopOnQaFail=true)";
            break;
          }

          if (consecutiveQaFails >= opts.maxQaFails) {
            result.stoppedReason = `Reached maxQaFails (${opts.maxQaFails})`;
            break;
          }
        }

        const { data: updatedJob } = await supabase
          .from("ingestion_v4_jobs")
          .select("stats, target_count, status")
          .eq("id", jobId)
          .single();

        if (updatedJob?.status === "COMPLETED") {
          result.completed = true;
          result.stoppedReason = "Target count reached";
          break;
        }

        const stats = updatedJob?.stats as { generated: number } | undefined;
        if (stats && stats.generated >= (updatedJob?.target_count || 0)) {
          result.completed = true;
          result.stoppedReason = "Target count reached";
          break;
        }

        if (i < opts.count - 1 && opts.sleepMs > 0) {
          await sleep(opts.sleepMs);
        }
      } catch (err: any) {
        console.error(`[V4] Batch iteration ${i + 1} failed:`, err.message);

        await supabase
          .from("ingestion_v4_jobs")
          .update({ last_error: err.message })
          .eq("id", jobId);

        if (err.message === "V4 Gemini disabled") {
          result.ok = false;
          result.stoppedReason = "V4 Gemini is disabled";
          break;
        }

        const isTransientError = 
          err.message?.includes("Failed to parse Gemini JSON") ||
          err.message?.includes("Gemini returned empty response") ||
          err.message?.includes("Gemini output validation failed") ||
          err.message?.includes("rate limit") ||
          err.message?.includes("timeout") ||
          err.message?.includes("RESOURCE_EXHAUSTED");
        
        if (isTransientError) {
          console.log(`[V4] Transient error, continuing with next iteration after delay...`);
          await sleep(opts.sleepMs * 2);
          continue;
        }

        result.stoppedReason = `Error: ${err.message}`;
        break;
      }
    }
  } finally {
    const finalStatus = result.completed ? "COMPLETED" : "QUEUED";
    await releaseJobLock(jobId, runnerId, finalStatus);
    console.log(`[V4] Batch run complete for job ${jobId}: attempted=${result.attempted}, generated=${result.generated}, runnerId=${runnerId}`);
  }

  return result;
}

function shouldPublish(qaResult: QaResult): boolean {
  if (qaResult.copyRisk === "high") {
    return false;
  }
  return qaResult.ok;
}

async function runOnceInternal(
  jobId: string,
  job: JobRecord,
  iteration: number = 0,
  sectionOverride?: "math" | "rw"
): Promise<{ draftId: string | null; qaOk: boolean; issues: string[]; publishedCanonicalId?: string }> {
  const supabase = getSupabaseAdmin();

  const section = sectionOverride || (job.section || "math") as "math" | "rw";
  
  const useClusterSampling = process.env.V4_USE_CLUSTER_SAMPLING === "true";
  
  const stylePack = await pickStylePagesForJob({
    jobId,
    iteration,
    exam: job.test_code || "SAT",
    section,
    useClusterSampling
  });
  
  await incrementTeacherUsage(stylePack.style_page_ids);
  
  const jobRequest: V4JobRequest = {
    testCode: (job.test_code || "SAT") as "SAT",
    targetCount: job.target_count,
    styleRefs: job.style_refs || []
  };

  let draft: GeneratedQuestionDraft;
  let usedPdfFallback = false;
  let pdfFallbackRefs: PdfStyleRef[] = [];
  
  if (stylePack.pages.length > 0) {
    draft = await generateDraftWithStylePages(jobRequest, stylePack.pages);
    console.log(`[V4] Generated draft using ${stylePack.pages.length} PNG style pages`);
  } else {
    usedPdfFallback = true;
    const requestedRefs = job.style_refs || [];
    const { refs: sampledRefs } = await pickStyleRefsForJob({
      jobId: `${jobId}-${Date.now()}`,
      requested: requestedRefs.length > 0 ? requestedRefs : null,
      fromLibrary: { exam: job.test_code || "SAT" }
    });
    pdfFallbackRefs = sampledRefs;
    draft = await generateDraftWithTeacher(jobRequest, sampledRefs);
    console.log(`[V4] Generated draft using PDF fallback (${sampledRefs.length} refs)`);
  }
  
  const qaResult = await qaDraftWithTa(draft, stylePack.pages.length > 0 ? stylePack.pages : undefined);
  
  await incrementQaUsage(stylePack.style_page_ids);

  const qaOkWithPolicy = shouldPublish(qaResult);
  const issues = [...qaResult.issues];
  
  if (qaResult.copyRisk === "high") {
    issues.push("HARD FAIL: copyRisk=high - draft rejected");
  }
  if (qaResult.styleMatch === "poor") {
    issues.push("WARNING: styleMatch=poor");
  }
  if (qaResult.difficultyMatch === "mismatch") {
    issues.push("WARNING: difficultyMatch=mismatch");
  }

  const styleRefsUsed = usedPdfFallback 
    ? pdfFallbackRefs 
    : stylePack.pages.map(p => ({ bucket: p.bucket, path: p.pdf_path, pageHint: p.page_number }));

  const { data: insertedDraft, error: draftError } = await supabase
    .from("ingestion_v4_drafts")
    .insert({
      job_id: jobId,
      draft: draft,
      qa: qaResult,
      qa_ok: qaOkWithPolicy,
      style_refs_used: styleRefsUsed
    })
    .select("id")
    .single();

  if (draftError) {
    console.error("[V4] Failed to persist draft:", JSON.stringify(draftError));
    throw new Error("Failed to persist draft");
  }

  const { data: currentJob } = await supabase
    .from("ingestion_v4_jobs")
    .select("stats, target_count")
    .eq("id", jobId)
    .single();

  const currentStats = (currentJob?.stats as { generated: number; qa_passed: number; qa_failed: number }) || 
    { generated: 0, qa_passed: 0, qa_failed: 0 };

  const newStats = {
    generated: currentStats.generated + 1,
    qa_passed: currentStats.qa_passed + (qaOkWithPolicy ? 1 : 0),
    qa_failed: currentStats.qa_failed + (qaOkWithPolicy ? 0 : 1)
  };

  const newStatus = newStats.generated >= (currentJob?.target_count || 0) ? "COMPLETED" : "RUNNING";

  await supabase
    .from("ingestion_v4_jobs")
    .update({ stats: newStats, status: newStatus, last_error: null })
    .eq("id", jobId);

  let publishedCanonicalId: string | undefined;
  if (qaOkWithPolicy) {
    try {
      const publishResult = await publishApprovedDraftToQuestions(jobId, insertedDraft.id);
      publishedCanonicalId = publishResult.canonical_id;
      console.log(`[V4] Published draft ${insertedDraft.id} as ${publishedCanonicalId}`);
    } catch (publishErr: any) {
      console.error(`[V4] Failed to publish approved draft: ${publishErr.message}`);
    }
  }

  return {
    draftId: insertedDraft.id,
    qaOk: qaOkWithPolicy,
    issues,
    publishedCanonicalId
  };
}
