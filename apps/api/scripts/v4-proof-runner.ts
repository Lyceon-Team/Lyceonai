#!/usr/bin/env npx tsx
/**
 * V4 Proof Runner Script
 * 
 * Runs the full V4 ingestion flow end-to-end:
 * 1. GET /worker/config - Check worker and Gemini configuration
 * 2. POST /admin/fanout-pdfs - Discover and enqueue PDFs for processing
 * 3. POST /queue/tick (loop) - Process queue items
 * 4. POST /style-bank/cluster - Cluster unclustered style pages
 * 5. POST /admin/proof - Run full proof with diagnostics
 * 
 * IMPORTANT: All V4 endpoints require admin authentication.
 * You must provide authentication via one of:
 *   - ADMIN_TOKEN env var (Bearer token for service-to-service auth)
 *   - Log in as admin via browser and copy sb-access-token cookie
 * 
 * Usage:
 *   ADMIN_TOKEN=<your-token> npx tsx apps/api/scripts/v4-proof-runner.ts
 * 
 * Environment:
 *   SITE_URL - Base URL (default: http://localhost:5000)
 *   SECTION - Section to process (default: math)
 *   ADMIN_TOKEN - Admin Bearer token for authentication
 */

const SITE_URL = process.env.SITE_URL || "http://localhost:5000";
const SECTION = process.env.SECTION || "math";
const MAX_TICKS = 8;
const MAX_CLUSTER_PAGES = 20;

interface Summary {
  geminiEnabled?: boolean;
  geminiKeySource?: string;
  build?: string;
  fanout?: { discovered: number; enqueued: number; errors: number };
  ticks?: { processed: number; completed: number; failed: number };
  stylePages?: { total: number; unclustered: number };
  clustering?: { attemptedCount: number; clusteredCount: number; createdClusters: number; failedCount: number; sampleErrors?: string[] };
  clusters?: { before: number; after: number; created: number };
  violations?: string[];
  ok: boolean;
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options?.headers as Record<string, string>,
  };
  
  if (ADMIN_TOKEN) {
    headers["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const data = await response.json() as T;
  if (!response.ok) {
    console.error(`HTTP ${response.status}:`, data);
  }
  return data;
}

async function run() {
  console.log("=".repeat(60));
  console.log("V4 PROOF RUNNER");
  console.log("=".repeat(60));
  console.log(`SITE_URL: ${SITE_URL}`);
  console.log(`SECTION: ${SECTION}`);
  console.log("");

  const summary: Summary = { ok: false };

  // Step 1: Worker Config
  console.log("\n[1/5] GET /worker/config");
  try {
    const config = await fetchJson<any>(`${SITE_URL}/api/ingestion-v4/worker/config`);
    summary.geminiEnabled = config.geminiEnabled;
    summary.geminiKeySource = config.geminiKeySource;
    summary.build = config.build;
    console.log(`  build: ${config.build}`);
    console.log(`  geminiEnabled: ${config.geminiEnabled}`);
    console.log(`  geminiKeySource: ${config.geminiKeySource}`);
  } catch (err: any) {
    console.error("  FAILED:", err.message);
    return printSummary(summary);
  }

  // Step 2: Fanout PDFs
  console.log("\n[2/5] POST /admin/fanout-pdfs");
  try {
    const fanout = await fetchJson<any>(`${SITE_URL}/api/ingestion-v4/admin/fanout-pdfs`, {
      method: "POST",
      body: JSON.stringify({
        section: SECTION,
        dryRun: false,
        overwrite: true,
        dpi: 150,
        maxPages: 2,
        pageMode: "first",
      }),
    });
    summary.fanout = {
      discovered: fanout.discovered || 0,
      enqueued: fanout.enqueued || 0,
      errors: fanout.errors || 0,
    };
    console.log(`  discovered: ${fanout.discovered}`);
    console.log(`  enqueued: ${fanout.enqueued}`);
    console.log(`  errors: ${fanout.errors}`);
  } catch (err: any) {
    console.error("  FAILED:", err.message);
  }

  // Step 3: Worker Ticks
  console.log(`\n[3/5] POST /queue/tick (max ${MAX_TICKS} ticks)`);
  let ticksProcessed = 0;
  let ticksCompleted = 0;
  let ticksFailed = 0;
  for (let i = 0; i < MAX_TICKS; i++) {
    try {
      const tick = await fetchJson<any>(`${SITE_URL}/api/ingestion-v4/queue/tick`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (tick.ran) {
        ticksProcessed++;
        if (tick.result?.stopped || tick.result?.passed) {
          ticksCompleted++;
        }
        if (tick.error) {
          ticksFailed++;
        }
        console.log(`  tick ${i + 1}: processed (queueId: ${tick.queueId})`);
      } else if (tick.deferred) {
        console.log(`  tick ${i + 1}: deferred`);
      } else {
        console.log(`  tick ${i + 1}: no items`);
        break;
      }
    } catch (err: any) {
      console.error(`  tick ${i + 1} FAILED:`, err.message);
      ticksFailed++;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  summary.ticks = { processed: ticksProcessed, completed: ticksCompleted, failed: ticksFailed };

  // Step 4: Clustering
  console.log(`\n[4/5] POST /style-bank/cluster (limitPages: ${MAX_CLUSTER_PAGES})`);
  try {
    const cluster = await fetchJson<any>(`${SITE_URL}/api/ingestion-v4/style-bank/cluster`, {
      method: "POST",
      body: JSON.stringify({
        section: SECTION,
        limitPages: MAX_CLUSTER_PAGES,
      }),
    });
    summary.clustering = {
      attemptedCount: cluster.attemptedCount || 0,
      clusteredCount: cluster.clusteredCount || 0,
      createdClusters: cluster.createdClusters || 0,
      failedCount: cluster.failedCount || 0,
      sampleErrors: cluster.sampleErrors,
    };
    console.log(`  attemptedCount: ${cluster.attemptedCount}`);
    console.log(`  clusteredCount: ${cluster.clusteredCount}`);
    console.log(`  createdClusters: ${cluster.createdClusters}`);
    console.log(`  failedCount: ${cluster.failedCount}`);
    if (cluster.sampleErrors?.length > 0) {
      console.log(`  sampleErrors: ${cluster.sampleErrors.slice(0, 3).join("; ")}`);
    }
  } catch (err: any) {
    console.error("  FAILED:", err.message);
  }

  // Step 5: Proof
  console.log("\n[5/5] POST /admin/proof");
  try {
    const proof = await fetchJson<any>(`${SITE_URL}/api/ingestion-v4/admin/proof`, {
      method: "POST",
      body: JSON.stringify({
        section: SECTION,
        maxTicks: MAX_TICKS,
        maxClusterPages: MAX_CLUSTER_PAGES,
        dryRun: false,
        overwrite: true,
      }),
    });
    summary.ok = proof.ok;
    summary.violations = proof.violations || [];
    summary.stylePages = proof.stylePages;
    summary.clusters = proof.clusters;
    console.log(`  ok: ${proof.ok}`);
    console.log(`  violations: ${proof.violations?.length || 0}`);
    if (proof.violations?.length > 0) {
      proof.violations.forEach((v: string) => console.log(`    - ${v}`));
    }
    console.log(`  stylePages: total=${proof.stylePages?.total}, unclustered=${proof.stylePages?.unclustered}`);
    console.log(`  clusters: before=${proof.clusters?.before}, after=${proof.clusters?.after}, created=${proof.clusters?.created}`);
    if (proof.eligibilityDebug?.firstEligiblePage) {
      const p = proof.eligibilityDebug.firstEligiblePage;
      console.log(`  firstEligiblePage: id=${p.id}, section=${p.section}, domain=${p.domain}`);
    }
  } catch (err: any) {
    console.error("  FAILED:", err.message);
  }

  printSummary(summary);
}

function printSummary(summary: Summary) {
  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`build: ${summary.build || "unknown"}`);
  console.log(`geminiEnabled: ${summary.geminiEnabled}`);
  console.log(`geminiKeySource: ${summary.geminiKeySource}`);
  if (summary.fanout) {
    console.log(`fanout: discovered=${summary.fanout.discovered}, enqueued=${summary.fanout.enqueued}, errors=${summary.fanout.errors}`);
  }
  if (summary.ticks) {
    console.log(`ticks: processed=${summary.ticks.processed}, completed=${summary.ticks.completed}, failed=${summary.ticks.failed}`);
  }
  if (summary.stylePages) {
    console.log(`stylePages: total=${summary.stylePages.total}, unclustered=${summary.stylePages.unclustered}`);
  }
  if (summary.clustering) {
    console.log(`clustering: attempted=${summary.clustering.attemptedCount}, clustered=${summary.clustering.clusteredCount}, created=${summary.clustering.createdClusters}, failed=${summary.clustering.failedCount}`);
    if (summary.clustering.sampleErrors?.length) {
      console.log(`  sampleErrors: ${summary.clustering.sampleErrors.slice(0, 3).join("; ")}`);
    }
  }
  if (summary.clusters) {
    console.log(`clusters: before=${summary.clusters.before}, after=${summary.clusters.after}, created=${summary.clusters.created}`);
  }
  if (summary.violations?.length) {
    console.log(`violations (${summary.violations.length}):`);
    summary.violations.forEach((v) => console.log(`  - ${v}`));
  } else {
    console.log("violations: none");
  }
  console.log(`\nOVERALL: ${summary.ok ? "OK ✓" : "FAILED ✗"}`);
  console.log("=".repeat(60));
}

run().catch(console.error);
