#!/usr/bin/env node
/**
 * @spec [Doc-03_V1.1 §14.2; Doc-07B_V1.0 §dataset naming]
 * @implemented 2026-08-27
 *
 * plain English: CI gate that catches column drift between Postgres source
 * tables and BigQuery archive schema files. When a Postgres migration adds
 * a column to a retention source table, this check FAILS — the archive
 * schema must be regenerated before the archive silently drops data.
 *
 * expected outcome:
 *  - PASS if every Postgres column in each source table has a corresponding
 *    entry in the BigQuery JSON schema file.
 *  - FAIL if a Postgres column is missing from the JSON schema (added to
 *    Postgres, not yet added to BigQuery schema).
 *  - WARN (but not fail) if a JSON schema column is absent from Postgres
 *    (column dropped from Postgres — historical archived rows still have
 *    the data; the archive schema should keep it until Karl confirms).
 *  - Metadata columns (_archived_at, _source_table) are expected in the
 *    JSON only and are excluded from the drift comparison.
 *
 * trade-offs:
 *  - Reads genesis-schema.expected.sql (pg_dump format) instead of a live
 *    Postgres. No credentials needed. The genesis file is the authoritative
 *    schema snapshot, already validated by the genesis-fresh-apply CI job.
 *  - Parses CREATE TABLE blocks with a line-by-line regex. This is fragile
 *    if pg_dump output format changes, but the genesis file format has been
 *    stable and the parser is tested by this script's own assertions.
 *  - Does NOT contact BigQuery — compares Postgres columns against the
 *    checked-in JSON files. The JSON IS the contract.
 *
 * fix path (printed on failure):
 *  1. Run: DATABASE_URL=<dev_db> node scripts/retention/generate-bq-archive-schemas.mjs
 *  2. Commit the updated JSON files in scripts/retention/schemas/
 *  3. Karl runs: bq update --table PROJECT:DATASET.TABLE scripts/retention/schemas/TABLE.json
 *
 * usage:
 *   node scripts/ci/retention-archive-drift-check.mjs
 *   (no arguments, no credentials, no env vars required)
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const GENESIS_PATH = join(REPO_ROOT, "scripts/ci/genesis-schema.expected.sql");
const SCHEMAS_DIR = join(REPO_ROOT, "scripts/retention/schemas");

// ── Source tables and their BigQuery archive table names ──────────────
// Must match ARCHIVE_TABLE_MAP in server/services/retention-archive.ts

const TABLE_MAP = {
  tutor_instruction_assignments: "retention__tutor_instruction_assignments",
  tutor_instruction_exposures: "retention__tutor_instruction_exposures",
  crisis_review_cases: "retention__crisis_review_cases",
  tutor_injection_log: "retention__tutor_injection_log",
};

// Metadata columns added by archiveRows() — not in Postgres, expected in JSON only
const METADATA_COLUMNS = new Set(["_archived_at", "_source_table"]);

// ── Postgres type → BigQuery type mapping ────────────────────────────
// Must match PG_TO_BQ_TYPE in generate-bq-archive-schemas.mjs

const PG_TO_BQ_TYPE = {
  uuid: "STRING",
  text: "STRING",
  "character varying": "STRING",
  jsonb: "JSON",
  json: "JSON",
  "timestamp with time zone": "TIMESTAMP",
  "timestamp without time zone": "TIMESTAMP",
  date: "DATE",
  integer: "INT64",
  smallint: "INT64",
  bigint: "INT64",
  numeric: "NUMERIC",
  "double precision": "FLOAT64",
  real: "FLOAT64",
  boolean: "BOOL",
  bytea: "BYTES",
};

// ── Parse genesis-schema.expected.sql ────────────────────────────────

/**
 * Extract column definitions from a pg_dump CREATE TABLE block.
 *
 * pg_dump format (observed in genesis-schema.expected.sql):
 *   CREATE TABLE public.<table_name> (
 *       <column_name> <type> [DEFAULT ...] [NOT NULL],
 *       ...
 *       CONSTRAINT <name> CHECK (...)
 *   );
 *
 * Returns: Map<columnName, { pgType: string, nullable: boolean }>
 */
function parseCreateTable(sql, tableName) {
  // Find the CREATE TABLE block
  const pattern = new RegExp(
    `CREATE TABLE public\\.${tableName}\\s*\\(([\\s\\S]*?)\\);`,
    "m",
  );
  const match = sql.match(pattern);
  if (!match) {
    throw new Error(
      `Table 'public.${tableName}' not found in genesis-schema.expected.sql`,
    );
  }

  const body = match[1];
  const columns = new Map();

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    // Skip empty lines, CONSTRAINT lines, and closing paren
    if (
      !trimmed ||
      trimmed.startsWith("CONSTRAINT") ||
      trimmed === ")" ||
      trimmed === ");"
    ) {
      continue;
    }

    // Parse: column_name type [DEFAULT ...] [NOT NULL][,]
    // The type can be multi-word (e.g., "timestamp with time zone")
    const colMatch = trimmed.match(
      /^(\w+)\s+(uuid|text|character varying(?:\(\d+\))?|jsonb|json|timestamp with time zone|timestamp without time zone|date|integer|smallint|bigint|numeric(?:\(\d+(?:,\s*\d+)?\))?|double precision|real|boolean|bool|bytea)(?:\s|,|$)/i,
    );

    if (!colMatch) continue;

    const colName = colMatch[1];
    let pgType = colMatch[2].toLowerCase();

    // Normalize: strip length from "character varying(N)" and "numeric(P,S)"
    pgType = pgType.replace(/\(\d+(?:,\s*\d+)?\)/, "");
    // Normalize: bool → boolean
    if (pgType === "bool") pgType = "boolean";

    const nullable = !trimmed.includes("NOT NULL");

    columns.set(colName, { pgType, nullable });
  }

  return columns;
}

// ── Read BigQuery JSON schema ────────────────────────────────────────

/**
 * Read a BigQuery JSON schema file and return field definitions.
 * Returns: Map<fieldName, { bqType: string, mode: string }>
 */
function readBqSchema(bqTableName) {
  const schemaPath = join(SCHEMAS_DIR, `${bqTableName}.json`);
  let content;
  try {
    content = readFileSync(schemaPath, "utf-8");
  } catch {
    throw new Error(
      `BigQuery schema file not found: ${schemaPath}\n` +
        `  Run: DATABASE_URL=<dev_db> node scripts/retention/generate-bq-archive-schemas.mjs`,
    );
  }

  const fields = JSON.parse(content);
  const result = new Map();
  for (const field of fields) {
    result.set(field.name, { bqType: field.type, mode: field.mode });
  }
  return result;
}

// ── Main comparison ──────────────────────────────────────────────────

function main() {
  console.log("retention-archive-drift-check: comparing Postgres columns against BigQuery JSON schemas\n");

  const genesisSql = readFileSync(GENESIS_PATH, "utf-8");

  let hasFailure = false;
  let hasWarning = false;

  for (const [pgTable, bqTable] of Object.entries(TABLE_MAP)) {
    console.log(`── ${pgTable} → ${bqTable} ──`);

    // Parse Postgres columns from genesis SQL
    const pgColumns = parseCreateTable(genesisSql, pgTable);

    // Read BigQuery JSON schema
    const bqFields = readBqSchema(bqTable);

    // Remove metadata columns from BQ comparison set
    const bqDataColumns = new Map(
      [...bqFields].filter(([name]) => !METADATA_COLUMNS.has(name)),
    );

    // Check 1: every Postgres column must exist in BQ schema
    for (const [colName, colDef] of pgColumns) {
      const bqField = bqDataColumns.get(colName);

      if (!bqField) {
        console.log(`  FAIL: column "${colName}" (${colDef.pgType}) exists in Postgres but is MISSING from ${bqTable}.json`);
        hasFailure = true;
        continue;
      }

      // Verify type mapping
      const expectedBqType = PG_TO_BQ_TYPE[colDef.pgType];
      if (!expectedBqType) {
        console.log(`  FAIL: column "${colName}" has unmapped Postgres type "${colDef.pgType}" — add it to PG_TO_BQ_TYPE`);
        hasFailure = true;
        continue;
      }

      if (bqField.bqType !== expectedBqType) {
        console.log(`  FAIL: column "${colName}" type mismatch — Postgres ${colDef.pgType} → expected BQ ${expectedBqType}, got ${bqField.bqType}`);
        hasFailure = true;
        continue;
      }

      // Verify nullability
      const expectedMode = colDef.nullable ? "NULLABLE" : "REQUIRED";
      if (bqField.mode !== expectedMode) {
        console.log(`  FAIL: column "${colName}" mode mismatch — Postgres ${colDef.nullable ? "nullable" : "NOT NULL"} → expected BQ ${expectedMode}, got ${bqField.mode}`);
        hasFailure = true;
        continue;
      }

      console.log(`  ok: ${colName} (${colDef.pgType} → ${bqField.bqType} ${bqField.mode})`);
    }

    // Check 2: BQ columns not in Postgres (dropped columns — warn, don't fail)
    for (const [fieldName] of bqDataColumns) {
      if (!pgColumns.has(fieldName)) {
        console.log(`  WARN: column "${fieldName}" exists in ${bqTable}.json but NOT in Postgres — historical archived rows retain it. Remove from JSON only if Karl confirms.`);
        hasWarning = true;
      }
    }

    // Check 3: metadata columns must be present in BQ schema
    for (const metaCol of METADATA_COLUMNS) {
      if (!bqFields.has(metaCol)) {
        console.log(`  FAIL: metadata column "${metaCol}" is MISSING from ${bqTable}.json — archiveRows() writes it at runtime`);
        hasFailure = true;
      }
    }

    console.log(`  ${pgColumns.size} Postgres columns, ${bqDataColumns.size} BQ data columns, ${METADATA_COLUMNS.size} metadata columns\n`);
  }

  // Summary
  console.log("═".repeat(60));

  if (hasFailure) {
    console.log("\nRETENTION ARCHIVE DRIFT CHECK: FAIL\n");
    console.log("Fix path:");
    console.log("  1. Regenerate: DATABASE_URL=<dev_db> node scripts/retention/generate-bq-archive-schemas.mjs");
    console.log("  2. Commit the updated JSON files in scripts/retention/schemas/");
    console.log("  3. Karl runs: bq update --table replit-cop:DATASET.TABLE scripts/retention/schemas/TABLE.json");
    console.log("");
    process.exit(1);
  }

  if (hasWarning) {
    console.log("\nRETENTION ARCHIVE DRIFT CHECK: PASS (with warnings)\n");
    console.log("Warnings above indicate columns present in the archive schema but");
    console.log("absent from Postgres. Historical archived rows retain these columns.");
    console.log("Remove from JSON only if Karl confirms the archived data is no longer needed.\n");
  } else {
    console.log("\nRETENTION ARCHIVE DRIFT CHECK: PASS\n");
  }
}

main();
