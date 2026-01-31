import { dequeueNext, completeQueueItem, failQueueItem } from "./v4Queue";
import { runBatchForJob } from "./v4Runner";
import { renderPagesForPdf } from "./v4PageRenderer";
import { BatchRunRequestSchema, QueueRenderPagesRequestSchema } from "../types/schemas";
import { v4 as uuidv4 } from "uuid";
import { isV4GeminiEnabled } from "./gemini";
import { clusterBatch } from "./v4Clustering";
import { normalizeSection } from "../utils/section";

export interface ProcessResult {
  processed: boolean;
  queueId?: string;
  type?: string;
  result?: Record<string, unknown>;
  error?: string;
}

export async function processNextQueueItem(): Promise<ProcessResult> {
  const workerId = `worker-${uuidv4().slice(0, 8)}`;
  
  const item = await dequeueNext(workerId);
  
  if (!item) {
    return { processed: false };
  }
  
  // Guard against null payload (should not happen after dequeueNext fix, but be defensive)
  if (!item.payload) {
    console.error(`[V4Worker] Dequeued item ${item.id} has null payload, marking as FAILED`);
    await failQueueItem(item.id, workerId, "dequeued item had null payload");
    return {
      processed: true,
      queueId: item.id,
      type: "unknown",
      error: "dequeued item had null payload",
    };
  }
  
  const payload = item.payload as Record<string, unknown>;
  const payloadType = (payload.type as string) || "batch_generate";
  
  try {
    let result: Record<string, unknown>;
    
    if (payloadType === "render_pages") {
      const parsed = QueueRenderPagesRequestSchema.safeParse(payload);
      
      if (!parsed.success) {
        throw new Error(`Invalid render_pages payload: ${parsed.error.message}`);
      }
      
      const renderResult = await renderPagesForPdf({
        bucket: parsed.data.bucket,
        pdfPath: parsed.data.pdfPath,
        exam: parsed.data.exam,
        section: parsed.data.section,
        dpi: parsed.data.dpi,
        maxPages: parsed.data.maxPages,
        overwrite: parsed.data.overwrite,
        pageMode: parsed.data.pageMode,
        pageStart: parsed.data.pageStart,
        pageEnd: parsed.data.pageEnd,
      });
      
      result = {
        type: "render_pages",
        pdfPath: renderResult.pdfPath,
        totalPages: renderResult.totalPages,
        renderedPages: renderResult.renderedPages,
        skippedPages: renderResult.skippedPages,
      };
      
      // Auto-cluster after successful render (best-effort, don't fail the queue item)
      if (isV4GeminiEnabled() && renderResult.renderedPages > 0) {
        const section = normalizeSection(parsed.data.section);
        if (section) {
          try {
            const clusterResult = await clusterBatch(section, 10);
            console.log(`[V4Worker] Auto-clustered after render: ${clusterResult.clusteredCount} pages, ${clusterResult.createdClusters} new clusters`);
            (result as Record<string, unknown>).autoClustering = {
              clusteredCount: clusterResult.clusteredCount,
              createdClusters: clusterResult.createdClusters,
              failedCount: clusterResult.failedCount,
            };
          } catch (clusterErr: any) {
            console.warn(`[V4Worker] Auto-clustering failed (non-fatal): ${clusterErr.message}`);
            (result as Record<string, unknown>).autoClustering = { error: clusterErr.message };
          }
        }
      }
    } else {
      const parsed = BatchRunRequestSchema.safeParse(payload);

      if (!parsed.success) {
        throw new Error(`Invalid batch_generate payload: ${parsed.error.message}`);
      }

      const batchResult = await runBatchForJob(item.job_id, parsed.data);
      
      result = {
        type: "batch_generate",
        generated: batchResult.generated,
        passed: batchResult.qaPassed,
        failed: batchResult.qaFailed,
        stopped: batchResult.stoppedReason !== null,
      };
    }
    
    await completeQueueItem(item.id, workerId, result);
    
    return {
      processed: true,
      queueId: item.id,
      type: payloadType,
      result,
    };
  } catch (err: any) {
    await failQueueItem(item.id, workerId, err.message || "Unknown error");
    
    return {
      processed: true,
      queueId: item.id,
      type: payloadType,
      error: err.message,
    };
  }
}
