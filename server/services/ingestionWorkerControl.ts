import { IngestionWorker, memoryJobs } from "./ingestionWorker";

let worker: IngestionWorker | null = null;
let workerStartedAt: Date | null = null;

export function isWorkerEnabled(): boolean {
  return process.env.INGESTION_ENABLED === "true";
}

export function startWorker(): void {
  if (!isWorkerEnabled()) {
    throw new Error("INGESTION_ENABLED is not true");
  }

  if (worker) return;

  worker = new IngestionWorker();
  workerStartedAt = new Date();
  console.log("[WORKER] Ingestion worker started");
}

export function stopWorker(): void {
  if (!worker) return;

  worker = null;
  workerStartedAt = null;
  console.log("[WORKER] Ingestion worker stopped");
}

export function getWorkerStatus() {
  return {
    enabled: isWorkerEnabled(),
    running: Boolean(worker),
    startedAt: workerStartedAt?.toISOString() ?? null,
    memoryJobs: memoryJobs.size,
  };
}
