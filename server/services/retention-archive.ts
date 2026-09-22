/**
 * @spec [Doc-03_V1.1 §14.2, Doc-07B_V1.0 §dataset naming]
 * @implemented 2026-08-26
 *
 * plain English: BigQuery archive client for LISA retention sweep.
 * Before deleting expired rows, each tier exports them to BigQuery
 * for analytics (§14.2: "archived data is moved to cold storage in
 * aggregated form for analytics; raw records deleted"). Karl ruling:
 * aggregation at query time in BigQuery, so we export raw rows.
 *
 * expected outcome: expired rows are inserted into BigQuery before
 * deletion from Supabase. If the BigQuery insert fails, the Supabase
 * delete is blocked — no data loss.
 *
 * trade-offs:
 *  - Uses BigQuery streaming insert (insertRows) rather than load jobs.
 *    Streaming insert has per-row cost but is simpler and appropriate
 *    for the expected volume (daily sweep of a small number of expired
 *    rows). Load jobs require a GCS staging bucket — unnecessary at V1.
 *  - Archive client is injectable (same pattern as SupabaseClient in
 *    retention-sweep.ts). Tests pass a mock; the route handler passes
 *    the real BigQuery client.
 *  - Duplicate archival is tolerated: if a previous run archived rows
 *    but the delete failed, the next run re-archives the same rows.
 *    BigQuery dedup is at query time (Karl ruling). Each archived row
 *    includes `_archived_at` and `_source_table` metadata columns.
 *  - Crisis review cases are minors' data (students 13–18). The
 *    archived copy in BigQuery is subject to Doc 07E retention classes
 *    and COPPA hard-delete rules for under-13 (which this platform
 *    does not serve, but the constraint is documented for auditability).
 *
 * edge cases:
 *  - Empty result set: no rows to archive → returns { archivedCount: 0 }.
 *    The sweep function then returns deleted_count: 0 (no-op).
 *  - BigQuery insert partial failure: BigQuery streaming insert is
 *    all-or-nothing per call. A partial failure throws, which blocks
 *    the delete.
 *  - Missing archive client: if opts.archiveClient is undefined, sweep
 *    returns ok: false with reason "archive_client_not_configured" —
 *    same safe-default as the previous "archival_destination_pending."
 *
 * provisioning (Karl):
 *  - Dataset: lyceon_analytics_archive_<env> (Doc 07B naming)
 *  - Tables: retention__<source_table> for each archived table
 *  - IAM: bigquery.dataEditor on the archive dataset for the Cloud Run
 *    service account
 *  - Env var: BIGQUERY_ARCHIVE_DATASET set on the Cloud Run service
 */
import { getGcpCredentials } from "../lib/gcp-credentials";
import { logger } from "../logger";

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Injectable archive client interface. The real implementation wraps
 * @google-cloud/bigquery; tests provide a recording mock.
 */
export type ArchiveClient = {
  insertRows(
    datasetId: string,
    tableId: string,
    rows: Record<string, unknown>[],
  ): Promise<{ insertedCount: number }>;
};

export type ArchiveResult =
  | { ok: true; archivedCount: number; table: string }
  | { ok: false; reason: string; table: string };

// ── Constants ─────────────────────────────────────────────────────────

/**
 * @spec [Doc-07B_V1.0 §dataset naming]
 *
 * Dataset naming convention: lyceon_analytics_<layer>_<env>.
 * Archive layer: lyceon_analytics_archive_<env>.
 *
 * The dataset name is an env var because it includes the environment
 * suffix (prod, staging, dev).
 */
export const ARCHIVE_DATASET_ENV_KEY = "BIGQUERY_ARCHIVE_DATASET";

/**
 * @spec [Doc-07B_V1.0 §table naming]
 *
 * Table naming convention: <event_class>__<event_name>.
 * Archive tables use "retention" as the event class.
 *
 * Maps Supabase source table → BigQuery archive table.
 */
export const ARCHIVE_TABLE_MAP: Record<string, string> = {
  tutor_instruction_assignments: "retention__tutor_instruction_assignments",
  tutor_instruction_exposures: "retention__tutor_instruction_exposures",
  crisis_review_cases: "retention__crisis_review_cases",
  tutor_injection_log: "retention__tutor_injection_log",
};

// ── Archive helper ────────────────────────────────────────────────────

/**
 * Archive rows to BigQuery before deletion.
 *
 * Each row is enriched with:
 *  - `_archived_at`: ISO timestamp of the archive operation
 *  - `_source_table`: the Supabase table the row came from
 *
 * These metadata columns support dedup at query time and provenance
 * tracking (Karl ruling: aggregation/dedup at query time).
 */
export async function archiveRows(
  archiveClient: ArchiveClient,
  sourceTable: string,
  rows: Record<string, unknown>[],
  archivedAt: Date,
): Promise<ArchiveResult> {
  const bqTable = ARCHIVE_TABLE_MAP[sourceTable];
  if (!bqTable) {
    return {
      ok: false,
      reason: `no_archive_table_mapping: ${sourceTable}`,
      table: sourceTable,
    };
  }

  const datasetId = process.env[ARCHIVE_DATASET_ENV_KEY];
  if (!datasetId) {
    return {
      ok: false,
      reason: `${ARCHIVE_DATASET_ENV_KEY}_not_set`,
      table: sourceTable,
    };
  }

  if (rows.length === 0) {
    return { ok: true, archivedCount: 0, table: sourceTable };
  }

  const enrichedRows = rows.map((row) => ({
    ...row,
    _archived_at: archivedAt.toISOString(),
    _source_table: sourceTable,
  }));

  try {
    const result = await archiveClient.insertRows(
      datasetId,
      bqTable,
      enrichedRows,
    );

    logger.info(
      "RETENTION_ARCHIVE",
      "archive_completed",
      `Archived ${result.insertedCount} rows from ${sourceTable} to ${bqTable}`,
      {
        sourceTable,
        bqTable,
        datasetId,
        archivedCount: result.insertedCount,
      },
    );

    return {
      ok: true,
      archivedCount: result.insertedCount,
      table: sourceTable,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error(
      "RETENTION_ARCHIVE",
      "archive_failed",
      `Failed to archive rows from ${sourceTable} to ${bqTable}`,
      err instanceof Error ? err : undefined,
      { sourceTable, bqTable, datasetId, rowCount: rows.length },
    );

    return {
      ok: false,
      reason: `archive_insert_failed: ${message}`,
      table: sourceTable,
    };
  }
}

// ── BigQuery client factory ───────────────────────────────────────────

/**
 * Create a real BigQuery archive client.
 *
 * Uses Application Default Credentials (ADC), which are automatically
 * available on Cloud Run. The project ID is auto-detected from the
 * environment.
 *
 * Requires: @google-cloud/bigquery (peer dependency — must be installed
 * before this function is called).
 */
export function createBigQueryArchiveClient(): ArchiveClient {
  // Dynamic import to avoid hard dependency at module load time.
  // The @google-cloud/bigquery package is only needed when the archive
  // client is actually created (production), not when the module is
  // imported (tests mock the client).
  //
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BigQuery } = require("@google-cloud/bigquery") as {
    BigQuery: new (options?: {
      projectId?: string;
      credentials?: Record<string, unknown>;
    }) => {
      dataset(id: string): {
        table(id: string): {
          insert(
            rows: Record<string, unknown>[],
            options?: { raw?: boolean },
          ): Promise<void>;
        };
      };
    };
  };

  // Explicit credential injection — ADC is removed from the BFF path.
  // The credential and the project come from the same service-account key.
  const creds = getGcpCredentials();
  const bq = new BigQuery({
    projectId: creds.project_id,
    credentials: creds,
  });

  return {
    async insertRows(
      datasetId: string,
      tableId: string,
      rows: Record<string, unknown>[],
    ): Promise<{ insertedCount: number }> {
      await bq.dataset(datasetId).table(tableId).insert(rows);
      return { insertedCount: rows.length };
    },
  };
}
