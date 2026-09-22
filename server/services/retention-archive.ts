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
 *    includes `event_date`, `_archived_at` and `_source_table` metadata
 *    columns.
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
 * provisioning (Karl, via `terraform apply` in infra/terraform):
 *  - Dataset: lyceon_analytics_archive_<env> (Doc 07B naming) — imported
 *  - Tables: `google_bigquery_table.retention_archive[*]` in bigquery.tf,
 *    one per ARCHIVE_TABLE_MAP entry, DAY-partitioned on `event_date` with
 *    a 730-day partition expiration. The column set comes from the
 *    checked-in `scripts/retention/schemas/*.json`, so Terraform and the
 *    `retention-archive-drift-check` gate read the same file and there is
 *    no second schema to keep in sync.
 *  - IAM: bigquery.dataEditor on the archive dataset for the Cloud Run
 *    service account
 *  - Env var: BIGQUERY_ARCHIVE_DATASET set on the Cloud Run service —
 *    emitted as the `bigquery_archive_dataset` Terraform output
 *
 * NOT YET RUNNABLE. `createBigQueryArchiveClient()` below requires
 * `@google-cloud/bigquery`, which is in no package.json and not in
 * pnpm-lock.yaml (it appears only as `--external` in the build:vercel
 * esbuild line). The require therefore throws, `getArchiveClient()` in
 * internal-retention-routes.ts catches it, and the 90d/180d tiers return
 * `archive_client_not_configured` — with or without the env var set.
 * Adding the dependency needs owner approval; reported 2026-09-22.
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

/**
 * @spec [Doc-07B_V1.0 §5.3 partition column + §13 archive timestamp semantics;
 *   Privacy Policy v4 §6.6; owner ruling 2026-09-22 B3] | @implemented [2026-09-22]
 *
 * plain English: the DATE column each archive table is partitioned by, and how
 * long a partition lives before BigQuery drops it.
 *
 * WHY A PARTITION COLUMN AT ALL. The published policy (§6.6) promises analytics
 * data separated from anything identifying is kept "up to 24 months." Until this
 * change nothing in the archive expired: `bigquery.tf` deliberately omitted
 * expiration, citing Doc 07B §5.1/§5.3 ("retention is 'forever' for the
 * pseudonymized 13+ class"). Partition expiration is BigQuery's native
 * mechanism for that promise, and it needs a partition column to run from.
 *
 * WHY `event_date` AND NOT THE SOURCE ROW'S OWN TIMESTAMP. Doc 07B §13 names
 * the shape for archive tables directly: "every archived aggregate carries the
 * `event_date` partition + an `_archived_at` timestamp". `event_date` is the UTC
 * calendar date of the archive operation — `DATE(_archived_at)` — not the date
 * the source row was created. That choice is the whole point: the 24-month clock
 * the policy promises starts when the row lands in BigQuery. Partitioning on
 * `created_at` instead would drop a row 90 days into its life straight into a
 * partition already 90 days old, and a row archived from an older backlog into
 * a partition that had already expired.
 *
 * trade-offs:
 *  - 730 days, not 731. "Up to 24 months" is an upper bound, so the conservative
 *    reading (2 x 365) is inside the promise for every start date; a
 *    leap-inclusive 731 would sit one day outside it in the worst case.
 *  - Expiration is set PER TABLE, not as a dataset default. The archive dataset
 *    is also the declared home of the Doc 07B §13 system-state-archive
 *    aggregates, which §5.3 says carry no partition expiration. A dataset
 *    default would silently expire those too. See `infra/terraform/bigquery.tf`.
 *  - Setting expiration at all diverges from Doc 07B §5.3 and Doc 07E §5.2.
 *    Filed as SCL-106 (PROPOSED) — the code implements the published policy and
 *    the register carries the conflict; the spec is not edited.
 *
 * edge cases:
 *  - A partition expires 730 days after the PARTITION's date, not 730 days after
 *    each row's insert, so a row inserted late into an older partition gets the
 *    remainder of that partition's life. Every row this writer produces carries
 *    `event_date = DATE(_archived_at)`, so "late into an older partition" cannot
 *    happen on this path.
 */
export const ARCHIVE_PARTITION_FIELD = "event_date";

/**
 * 24 months as the policy's conservative upper bound: 2 x 365 days.
 * Privacy Policy v4 §6.6 — "up to 24 months, then only in aggregate."
 */
export const ARCHIVE_PARTITION_EXPIRATION_DAYS = 730;

/**
 * The same window in milliseconds, which is the unit BigQuery's
 * `timePartitioning.expirationMs` (Terraform: `expiration_ms`) takes.
 * Derived, never retyped — `infra/terraform/bigquery.tf` must carry this exact
 * number and a contract test asserts it does.
 */
export const ARCHIVE_PARTITION_EXPIRATION_MS =
  ARCHIVE_PARTITION_EXPIRATION_DAYS * 24 * 60 * 60 * 1000;

// ── Archive helper ────────────────────────────────────────────────────

/**
 * Archive rows to BigQuery before deletion.
 *
 * Each row is enriched with:
 *  - `event_date`: UTC calendar date of the archive operation — the
 *    BigQuery partition key, and therefore what the 730-day partition
 *    expiration runs from (see ARCHIVE_PARTITION_FIELD)
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

  // `event_date` is the partition key (see ARCHIVE_PARTITION_FIELD). It is
  // derived from the SAME `archivedAt` instant as `_archived_at`, so the two can
  // never disagree: slicing the ISO-8601 string at 10 characters takes the UTC
  // calendar date, and `toISOString()` is always UTC.
  const archivedAtIso = archivedAt.toISOString();
  const enrichedRows = rows.map((row) => ({
    ...row,
    [ARCHIVE_PARTITION_FIELD]: archivedAtIso.slice(0, 10),
    _archived_at: archivedAtIso,
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
