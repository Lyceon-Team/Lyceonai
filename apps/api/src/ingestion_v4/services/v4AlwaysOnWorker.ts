import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { processNextQueueItem } from "./v4QueueWorker";

const WORKER_NAME = "v4-always-on-worker";
const POLL_INTERVAL_MS = 2000;
const IDLE_POLL_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_ERRORS = 10;
const ERROR_BACKOFF_MS = 10000;

let isRunning = false;
let lastTickAt: Date | null = null;
let consecutiveErrors = 0;
let totalProcessed = 0;
let workerStartedAt: Date | null = null;
let workerEnabledSource: 'env' | 'db' | 'both' | 'none' | 'always-on' = 'always-on';

export function isWorkerEnabledByEnv(): boolean {
  return process.env.V4_WORKER_ENABLED === "true";
}

export async function isWorkerEnabledByDb(): Promise<boolean> {
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("ingestion_v4_settings")
      .select("value")
      .eq("key", "worker_enabled")
      .maybeSingle();
    return data?.value === "true";
  } catch {
    return false;
  }
}

export async function isWorkerEnabled(): Promise<boolean> {
  const envEnabled = isWorkerEnabledByEnv();
  const dbEnabled = await isWorkerEnabledByDb();
  
  if (envEnabled && dbEnabled) {
    workerEnabledSource = 'both';
  } else if (envEnabled) {
    workerEnabledSource = 'env';
  } else if (dbEnabled) {
    workerEnabledSource = 'db';
  } else {
    workerEnabledSource = 'always-on';
  }
  
  return true;
}

export async function setWorkerEnabledInDb(enabled: boolean): Promise<void> {
  const supabase = getSupabaseAdmin();
  await supabase.rpc("set_v4_setting", {
    setting_key: "worker_enabled",
    setting_value: enabled ? "true" : "false"
  });
}

export async function getWorkerConfig(): Promise<{
  workerEnabledSource: 'env' | 'db' | 'both' | 'none' | 'always-on';
  workerEnabled: boolean;
  envEnabled: boolean;
  dbEnabled: boolean;
}> {
  const envEnabled = isWorkerEnabledByEnv();
  const dbEnabled = await isWorkerEnabledByDb();
  
  let source: 'env' | 'db' | 'both' | 'none' | 'always-on' = 'always-on';
  if (envEnabled && dbEnabled) source = 'both';
  else if (envEnabled) source = 'env';
  else if (dbEnabled) source = 'db';
  
  return { workerEnabledSource: source, workerEnabled: true, envEnabled, dbEnabled };
}

export function getWorkerStatus(): {
  enabled: boolean;
  running: boolean;
  lastTickAt: string | null;
  consecutiveErrors: number;
  totalProcessed: number;
  startedAt: string | null;
  enabledSource: 'env' | 'db' | 'both' | 'none' | 'always-on';
} {
  return {
    enabled: true,
    running: isRunning,
    lastTickAt: lastTickAt?.toISOString() || null,
    consecutiveErrors,
    totalProcessed,
    startedAt: workerStartedAt?.toISOString() || null,
    enabledSource: workerEnabledSource,
  };
}

async function acquireWorkerLock(): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const lockExpiry = new Date(Date.now() + 60000).toISOString();
  
  const { data, error } = await supabase.rpc("v4_acquire_worker_lock", {
    p_worker_name: WORKER_NAME,
    p_lock_expiry: lockExpiry,
  });
  
  if (error) {
    console.warn(`[V4Worker] Failed to acquire lock: ${error.message}`);
    return false;
  }
  
  return data === true;
}

async function releaseWorkerLock(): Promise<void> {
  const supabase = getSupabaseAdmin();
  
  await supabase.rpc("v4_release_worker_lock", {
    p_worker_name: WORKER_NAME,
  });
}

async function renewWorkerLock(): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const lockExpiry = new Date(Date.now() + 60000).toISOString();
  
  const { data, error } = await supabase.rpc("v4_renew_worker_lock", {
    p_worker_name: WORKER_NAME,
    p_lock_expiry: lockExpiry,
  });
  
  if (error) {
    console.warn(`[V4Worker] Failed to renew lock: ${error.message}`);
    return false;
  }
  
  return data === true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerLoop(): Promise<void> {
  console.log(`[V4Worker] Starting always-on worker loop`);
  workerStartedAt = new Date();
  isRunning = true;
  
  const hasLock = await acquireWorkerLock();
  if (!hasLock) {
    console.warn(`[V4Worker] Could not acquire lock, another worker may be running`);
    isRunning = false;
    return;
  }
  
  let renewCounter = 0;
  
  try {
    while (isRunning && await isWorkerEnabled()) {
      lastTickAt = new Date();
      
      renewCounter++;
      if (renewCounter >= 10) {
        const renewed = await renewWorkerLock();
        if (!renewed) {
          console.error(`[V4Worker] Lost lock, stopping worker`);
          break;
        }
        renewCounter = 0;
      }
      
      try {
        const result = await processNextQueueItem();
        
        if (result.processed) {
          totalProcessed++;
          consecutiveErrors = 0;
          console.log(`[V4Worker] Processed queue item: type=${result.type}, queueId=${result.queueId}`);
          
          await sleep(POLL_INTERVAL_MS);
        } else {
          await sleep(IDLE_POLL_INTERVAL_MS);
        }
      } catch (err: any) {
        consecutiveErrors++;
        console.error(`[V4Worker] Error processing queue: ${err.message}`);
        
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          console.error(`[V4Worker] Too many consecutive errors (${consecutiveErrors}), stopping`);
          break;
        }
        
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  } finally {
    await releaseWorkerLock();
    isRunning = false;
    console.log(`[V4Worker] Worker loop stopped, totalProcessed=${totalProcessed}`);
  }
}

export function startWorker(): void {
  if (!isWorkerEnabled()) {
    console.log(`[V4Worker] Worker disabled (V4_WORKER_ENABLED != true)`);
    return;
  }
  
  if (isRunning) {
    console.log(`[V4Worker] Worker already running`);
    return;
  }
  
  workerLoop().catch((err) => {
    console.error(`[V4Worker] Fatal error in worker loop:`, err);
    isRunning = false;
  });
}

export function stopWorker(): void {
  console.log(`[V4Worker] Stopping worker...`);
  isRunning = false;
}
