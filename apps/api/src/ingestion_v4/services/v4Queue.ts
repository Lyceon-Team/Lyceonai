import { getSupabaseAdmin } from "../../lib/supabase-admin";
import type { QueueBatchRequest, QueueRenderPagesRequest } from "../types/schemas";

/**
 * System job ID for render_pages queue items that don't belong to a generation job.
 * This is a well-known UUID that we ensure exists in ingestion_v4_jobs.
 */
export const SYSTEM_JOB_ID = "00000000-0000-0000-0000-000000000001";

let systemJobChecked = false;

/**
 * Ensures the system job exists in ingestion_v4_jobs.
 * This is idempotent and safe to call multiple times.
 * Uses ON CONFLICT DO NOTHING to avoid race conditions.
 */
export async function ensureSystemJobExists(): Promise<void> {
  if (systemJobChecked) return;
  
  const supabase = getSupabaseAdmin();
  
  const { error } = await supabase
    .from("ingestion_v4_jobs")
    .upsert(
      {
        id: SYSTEM_JOB_ID,
        test_code: "SYSTEM",
        status: "COMPLETED",
        target_count: 1,
        style_refs: [],
        stats: { generated: 0, qa_passed: 0, qa_failed: 0 },
        last_error: null,
      },
      { onConflict: "id", ignoreDuplicates: true }
    );
    
  if (error) {
    console.error("[V4Queue] Failed to ensure system job exists:", error.message);
    throw new Error(`Failed to ensure system job exists: ${error.message}`);
  }
  
  systemJobChecked = true;
  console.log("[V4Queue] System job verified/created:", SYSTEM_JOB_ID);
}

export interface QueueRow {
  id: string;
  job_id: string;
  payload: Record<string, unknown>;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  not_before: string;
  attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function enqueueBatch(
  jobId: string,
  payload: QueueBatchRequest
): Promise<{ queueId: string }> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("ingestion_v4_queue")
    .insert({
      job_id: jobId,
      payload: payload,
      status: "QUEUED",
      not_before: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to enqueue batch: ${error?.message || "Unknown error"}`);
  }

  return { queueId: data.id };
}

export async function dequeueNext(runnerId: string): Promise<QueueRow | null> {
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc("ingestion_v4_dequeue_next", {
    queue_runner: runnerId,
  });

  if (error) {
    console.error("[V4Queue] Dequeue RPC error:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  // PostgREST may return a truthy object with all fields null when no row is found.
  // Treat as "no item" if id or payload is null/undefined/empty.
  const row = data as QueueRow;
  if (!row.id || row.payload == null) {
    return null;
  }

  return row;
}

export async function completeQueueItem(
  queueId: string,
  runnerId: string,
  _result: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("ingestion_v4_queue")
    .update({
      status: "COMPLETED",
      completed_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", queueId)
    .eq("locked_by", runnerId);

  if (error) {
    console.error("[V4Queue] Complete error:", error.message);
  }
}

export async function failQueueItem(
  queueId: string,
  runnerId: string,
  errMsg: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from("ingestion_v4_queue")
    .update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      last_error: errMsg,
    })
    .eq("id", queueId)
    .eq("locked_by", runnerId);

  if (error) {
    console.error("[V4Queue] Fail error:", error.message);
  }
}

export async function deferQueueItem(
  queueId: string,
  runnerId: string,
  deferSeconds: number,
  reason: string
): Promise<void> {
  const supabase = getSupabaseAdmin();

  const notBefore = new Date(Date.now() + deferSeconds * 1000).toISOString();

  const { error } = await supabase
    .from("ingestion_v4_queue")
    .update({
      status: "QUEUED",
      not_before: notBefore,
      last_error: reason,
      locked_by: null,
      locked_at: null,
    })
    .eq("id", queueId)
    .eq("locked_by", runnerId);

  if (error) {
    console.error("[V4Queue] Defer error:", error.message);
  }
}

export interface EnqueueRenderResult {
  queueId: string;
}

export interface EnqueueRenderError {
  message: string;
  code?: string;
  hint?: string;
  details?: string;
}

export async function enqueueRenderPages(
  payload: QueueRenderPagesRequest
): Promise<EnqueueRenderResult> {
  await ensureSystemJobExists();
  
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("ingestion_v4_queue")
    .insert({
      job_id: SYSTEM_JOB_ID,
      payload: payload,
      status: "QUEUED",
      not_before: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    const errInfo: EnqueueRenderError = {
      message: error?.message || "Unknown error",
      code: error?.code,
      hint: error?.hint,
      details: error?.details,
    };
    console.error("[V4Queue] Failed to enqueue render pages:", errInfo);
    const err = new Error(`Failed to enqueue render pages: ${errInfo.message}`);
    (err as any).supabaseError = errInfo;
    throw err;
  }

  return { queueId: data.id };
}
