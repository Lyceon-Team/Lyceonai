/**
 * V4 PDF Fanout Service
 * 
 * Lists PDFs from Supabase Storage (lyceon-style-bank) and enqueues
 * render_pages jobs for each PDF that doesn't already have a pending job.
 */
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { scanStyleBank } from "./styleBankService";
import { SYSTEM_JOB_ID, ensureSystemJobExists } from "./v4Queue";
import type { CanonicalSection } from "../utils/section";

interface EnqueueRpcResult {
  inserted: boolean;
  queue_id: string | null;
  reason: string | null;
}

/**
 * Calls the enqueue RPC with fallback: tries v2 first, then v1.
 * Normalizes the response shape (array vs object).
 */
async function callEnqueueRpc(
  jobId: string,
  payload: Record<string, unknown>,
  overwrite: boolean
): Promise<{ data: EnqueueRpcResult | null; error: Error | null }> {
  const supabase = getSupabaseAdmin();
  
  // Try v2 first (newer RPC name in some Supabase instances)
  const { data: dataV2, error: errorV2 } = await supabase.rpc("enqueue_render_pages_if_missing_v2", {
    p_job_id: jobId,
    p_payload: payload,
    p_overwrite: overwrite,
  });
  
  // Check if v2 RPC doesn't exist (PostgREST "function not found")
  const isV2NotFound = errorV2?.message?.includes("function") && 
    errorV2?.message?.includes("does not exist");
  
  if (!isV2NotFound) {
    // v2 exists, use its result
    if (errorV2) {
      return { data: null, error: new Error(errorV2.message) };
    }
    const row = Array.isArray(dataV2) ? dataV2[0] : dataV2;
    return { data: row as EnqueueRpcResult | null, error: null };
  }
  
  // Fall back to v1
  const { data: dataV1, error: errorV1 } = await supabase.rpc("enqueue_render_pages_if_missing", {
    p_job_id: jobId,
    p_payload: payload,
    p_overwrite: overwrite,
  });
  
  if (errorV1) {
    return { data: null, error: new Error(errorV1.message) };
  }
  
  const row = Array.isArray(dataV1) ? dataV1[0] : dataV1;
  return { data: row as EnqueueRpcResult | null, error: null };
}

export interface FanoutResult {
  ok: boolean;
  discovered: number;
  enqueued: number;
  skipped: number;
  errors: number;
  details: Array<{
    pdfPath: string;
    status: "enqueued" | "skipped" | "error";
    reason?: string;
    queueId?: string;
  }>;
}

export interface FanoutOptions {
  section?: CanonicalSection;
  dpi?: number;
  maxPages?: number;
  pageMode?: "first" | "all" | "range";
  dryRun?: boolean;
  overwrite?: boolean;
}

export async function runPdfFanout(opts: FanoutOptions = {}): Promise<FanoutResult> {
  const {
    section,
    dpi = 150,
    maxPages = 60,
    pageMode = "all",
    dryRun = false,
    overwrite = false,
  } = opts;

  await ensureSystemJobExists();
  
  const scanResult = await scanStyleBank(10000, section);
  const entries = scanResult.entries;

  const result: FanoutResult = {
    ok: true,
    discovered: entries.length,
    enqueued: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  if (entries.length === 0) {
    return result;
  }

  for (const entry of entries) {
    const payload = {
      type: "render_pages" as const,
      bucket: "lyceon-style-bank" as const,
      pdfPath: entry.path,
      exam: "sat" as const,
      section: entry.section,
      dpi,
      maxPages,
      overwrite,
      pageMode,
    };

    if (dryRun) {
      result.details.push({
        pdfPath: entry.path,
        status: "skipped",
        reason: "dry_run",
      });
      result.skipped++;
      continue;
    }

    try {
      const { data: rpcResult, error } = await callEnqueueRpc(SYSTEM_JOB_ID, payload, overwrite);

      if (error) {
        console.error(`[V4Fanout] RPC error for ${entry.path}:`, error.message);
        result.details.push({
          pdfPath: entry.path,
          status: "error",
          reason: error.message,
        });
        result.errors++;
        continue;
      }
      
      if (!rpcResult) {
        console.error(`[V4Fanout] RPC returned empty for ${entry.path}`);
        result.details.push({
          pdfPath: entry.path,
          status: "error",
          reason: "rpc_return_empty",
        });
        result.errors++;
        continue;
      }

      if (rpcResult.inserted === true) {
        result.details.push({
          pdfPath: entry.path,
          status: "enqueued",
          reason: rpcResult.reason ?? "queued",
          queueId: rpcResult.queue_id ?? undefined,
        });
        result.enqueued++;
        console.log(`[V4Fanout] Enqueued ${entry.path}`);
      } else {
        result.details.push({
          pdfPath: entry.path,
          status: "skipped",
          reason: rpcResult.reason ?? "already_pending",
          queueId: rpcResult.queue_id ?? undefined,
        });
        result.skipped++;
      }
    } catch (err: any) {
      console.error(`[V4Fanout] Exception for ${entry.path}:`, err.message);
      result.details.push({
        pdfPath: entry.path,
        status: "error",
        reason: err.message,
      });
      result.errors++;
    }
  }

  console.log(`[V4Fanout] Queued ${result.enqueued} PDFs (${result.skipped} skipped, ${result.errors} errors) from ${result.discovered} discovered`);
  
  return result;
}
