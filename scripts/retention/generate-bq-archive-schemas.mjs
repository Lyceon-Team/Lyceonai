#!/usr/bin/env node
/**
 * @spec [Doc-03_V1.1 §14.2; Doc-07B_V1.0 §dataset naming]
 * @implemented 2026-08-26
 *
 * plain English: Reads Postgres column definitions for the four retention
 * source tables and emits BigQuery JSON schema files. Karl runs this once
 * to generate the `bq mk` input; the output is checked in so CI can
 * drift-check against the live Postgres schema without BigQuery credentials.
 *
 * expected outcome: one JSON schema file per table in ./schemas/, each
 * containing the BigQuery field definitions with Postgres → BigQuery type
 * mapping applied, plus two metadata columns (_archived_at, _source_table).
 *
 * trade-offs:
 *  - Reads from information_schema.columns (Postgres catalog). Requires a
 *    DATABASE_URL connection string. Can run against the local dev DB or
 *    the Supabase staging DB — never prod.
 *  - Output is JSON, not bq mk commands, because JSON can be version-
 *    controlled and diffed. The bq mk command per table is printed to
 *    stdout for Karl.
 *  - Type mapping is explicit and conservative — unknown types cause an
 *    error, not a silent STRING fallback.
 *
 * usage:
 *   DATABASE_URL=postgresql://... node scripts/retention/generate-bq-archive-schemas.mjs
 *
 * prerequisites:
 *   pnpm add -D pg  (or use an existing pg installation)
 */

import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, "schemas");

// ── Source tables ────────────────────────────────────────────────────

/** Must match ARCHIVE_TABLE_MAP in server/services/retention-archive.ts */
const SOURCE_TABLES = [
  "tutor_instruction_assignments",
  "tutor_instruction_exposures",
  "crisis_review_cases",
  "tutor_injection_log",
];

/** BigQuery table naming: retention__<source_table> (Doc 07B §table naming) */
const toBqTableName = (sourceTable) => `retention__${sourceTable}`;

// ── Postgres → BigQuery type mapping ─────────────────────────────────
//
// This mapping is explicit. Any Postgres type not listed here causes an
// error — no silent fallback to STRING. Update the mapping when a new
// Postgres type is encountered.
//
// Reference: https://cloud.google.com/bigquery/docs/reference/standard-sql/data-types
//
// | Postgres type           | BigQuery type | Rationale                           |
// |-------------------------|---------------|-------------------------------------|
// | uuid                    | STRING        | BQ has no native UUID; stored as    |
// |                         |               | 36-char hyphenated string           |
// | text                    | STRING        | Direct mapping                      |
// | character varying       | STRING        | Direct mapping                      |
// | jsonb / json            | JSON          | BQ native JSON (GA since 2022).     |
// |                         |               | Preserves queryability vs STRING    |
// | timestamp with time zone| TIMESTAMP     | BQ TIMESTAMP is UTC-normalized,     |
// |   (timestamptz)         |               | same semantics as Postgres timestamptz |
// | integer / int4          | INT64         | BQ has no INT32; INT64 is the       |
// |                         |               | standard integer type               |
// | smallint / int2         | INT64         | Widened to INT64 (BQ minimum)       |
// | bigint / int8           | INT64         | Direct mapping                      |
// | numeric / decimal       | NUMERIC       | BQ NUMERIC: 38 digits, 9 decimal.   |
// |                         |               | Sufficient for model_confidence     |
// | boolean / bool          | BOOL          | Direct mapping                      |
// | text[]                  | STRING (REP.) | REPEATED STRING. None of the four   |
// |                         |               | tables currently use arrays, but    |
// |                         |               | included for completeness           |
// | bytea                   | BYTES         | Not used, included for safety       |
//

const PG_TO_BQ_TYPE = {
  // String types
  uuid: "STRING",
  text: "STRING",
  "character varying": "STRING",
  // JSON types
  jsonb: "JSON",
  json: "JSON",
  // Temporal types
  "timestamp with time zone": "TIMESTAMP",
  "timestamp without time zone": "TIMESTAMP",
  date: "DATE",
  // Numeric types
  integer: "INT64",
  smallint: "INT64",
  bigint: "INT64",
  numeric: "NUMERIC",
  "double precision": "FLOAT64",
  real: "FLOAT64",
  // Boolean
  boolean: "BOOL",
  // Binary
  bytea: "BYTES",
};

// Array types: Postgres reports these in information_schema as the base
// type with data_type = 'ARRAY' and udt_name = '_text', '_uuid', etc.
const PG_ARRAY_BASE_TO_BQ = {
  _text: "STRING",
  _uuid: "STRING",
  _int4: "INT64",
  _int8: "INT64",
};

// ── Metadata columns appended to every archive table ─────────────────
//
// These match what archiveRows() in retention-archive.ts adds at runtime.

const METADATA_COLUMNS = [
  {
    name: "_archived_at",
    type: "TIMESTAMP",
    mode: "REQUIRED",
    description: "ISO timestamp of the archive operation (set by retention sweep)",
  },
  {
    name: "_source_table",
    type: "STRING",
    mode: "REQUIRED",
    description: "Supabase source table name (provenance for dedup at query time)",
  },
];

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "DATABASE_URL is required.\n" +
        "Point it at a dev or staging Supabase DB — never prod.\n\n" +
        "Usage:\n" +
        "  DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres \\\n" +
        "    node scripts/retention/generate-bq-archive-schemas.mjs",
    );
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    mkdirSync(SCHEMAS_DIR, { recursive: true });

    const bqMkCommands = [];

    for (const table of SOURCE_TABLES) {
      console.log(`\n── ${table} ──`);

      // Query information_schema for column definitions
      const { rows } = await client.query(
        `SELECT
           column_name,
           data_type,
           udt_name,
           is_nullable,
           column_default
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
         ORDER BY ordinal_position`,
        [table],
      );

      if (rows.length === 0) {
        console.error(`  ERROR: table '${table}' not found in public schema`);
        process.exit(1);
      }

      console.log(`  ${rows.length} columns found in Postgres`);

      // Map each column to BigQuery schema
      const bqFields = [];
      for (const col of rows) {
        const { column_name, data_type, udt_name, is_nullable } = col;

        let bqType;
        let bqMode;

        if (data_type === "ARRAY") {
          // Array column
          bqType = PG_ARRAY_BASE_TO_BQ[udt_name];
          if (!bqType) {
            console.error(
              `  ERROR: unknown array base type '${udt_name}' for column '${column_name}'`,
            );
            process.exit(1);
          }
          bqMode = "REPEATED";
        } else {
          bqType = PG_TO_BQ_TYPE[data_type];
          if (!bqType) {
            console.error(
              `  ERROR: unknown Postgres type '${data_type}' (udt: ${udt_name}) ` +
                `for column '${column_name}'. Add it to PG_TO_BQ_TYPE.`,
            );
            process.exit(1);
          }
          // BigQuery mode: REQUIRED for NOT NULL, NULLABLE for nullable
          bqMode = is_nullable === "YES" ? "NULLABLE" : "REQUIRED";
        }

        bqFields.push({
          name: column_name,
          type: bqType,
          mode: bqMode,
        });

        console.log(
          `  ${column_name}: ${data_type}${data_type === "ARRAY" ? ` (${udt_name})` : ""} → ${bqType} ${bqMode}`,
        );
      }

      // Append metadata columns
      bqFields.push(...METADATA_COLUMNS);
      console.log(`  _archived_at: (metadata) → TIMESTAMP REQUIRED`);
      console.log(`  _source_table: (metadata) → STRING REQUIRED`);
      console.log(`  Total: ${bqFields.length} columns (${rows.length} source + 2 metadata)`);

      // Write JSON schema file
      const bqTableName = toBqTableName(table);
      const schemaPath = join(SCHEMAS_DIR, `${bqTableName}.json`);
      writeFileSync(schemaPath, JSON.stringify(bqFields, null, 2) + "\n");
      console.log(`  Written: ${schemaPath}`);

      // Collect bq mk command
      bqMkCommands.push(
        `bq mk --table \\`,
        `  "$PROJECT:$DATASET.${bqTableName}" \\`,
        `  scripts/retention/schemas/${bqTableName}.json`,
        ``,
      );
    }

    // Print bq mk commands for Karl
    console.log(`\n${"═".repeat(60)}`);
    console.log("Commands for Karl (run from repo root):");
    console.log(`${"═".repeat(60)}\n`);
    console.log("# Set these to your target:");
    console.log("PROJECT=replit-cop");
    console.log("DATASET=lyceon_analytics_archive_prod\n");
    for (const line of bqMkCommands) {
      console.log(line);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
