/**
 * Load the committed reference snapshots into `ref_colleges` and `ref_high_schools`.
 *
 * @spec [Brief 8 ruling 3 (owner, 2026-10-01): "loaded by an import script from a committed
 *        filtered snapshot, with a manifest giving the source URL, vintage date, filter rules and
 *        the SHA-256 of each file"; SCL-195] | @implemented [2026-10-01]
 *
 * plain English: reads `content/reference/manifest.json`, refuses any snapshot whose bytes do not
 * hash to the manifest's SHA-256 or whose row count disagrees, validates every row, then — per
 * table, in one transaction — inserts new rows, updates changed ones, and marks rows that left the
 * snapshot as retired. Expected outcome: running it twice changes nothing the second time, and a
 * hand-edited CSV is refused before a single row is written.
 *
 * Trade-offs and edge cases:
 *   - It NEVER deletes. A row absent from a newer snapshot gets `retired_at`, so a student who
 *     chose it keeps a resolvable choice; search and new choices exclude it. A row that comes back
 *     is un-retired.
 *   - The CSV reader is a minimal RFC 4180 reader written for the builder's output (quoted fields,
 *     doubled quotes, LF rows). No CSV dependency is added (dependency changes need approval).
 *   - Owner-run against production, like every other production write in this repo: the
 *     connection string is read from `SUPABASE_DB_URL` and never printed.
 *
 * Usage: SUPABASE_DB_URL=... pnpm exec tsx scripts/reference-data/import-reference-data.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";
import { z } from "zod";
import {
  collegeIdSchema,
  highSchoolIdSchema,
  referenceSchoolSchema,
} from "../../packages/shared/src/student-background-schema";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export const MANIFEST_PATH = path.join(
  ROOT,
  "content",
  "reference",
  "manifest.json",
);

const snapshotEntrySchema = z.object({
  file: z.string().min(1),
  table: z.enum(["ref_colleges", "ref_high_schools"]),
  rows: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
const manifestSchema = z.object({
  sources: z.record(
    z.object({
      url: z.string().url(),
      vintage: z.string().min(1),
      zip_sha256: z.string().regex(/^[0-9a-f]{64}$/),
      member_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    }),
  ),
  snapshots: z.object({
    colleges: snapshotEntrySchema.extend({ table: z.literal("ref_colleges") }),
    high_schools: snapshotEntrySchema.extend({
      table: z.literal("ref_high_schools"),
    }),
  }),
});
export type ReferenceManifest = z.infer<typeof manifestSchema>;

export type ReferenceRow = z.infer<typeof referenceSchoolSchema>;

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Minimal RFC 4180: comma-separated, `"`-quoted fields with `""` escapes, LF (or CRLF) rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.length === 0) {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("csv: unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function readManifest(
  manifestPath: string = MANIFEST_PATH,
): ReferenceManifest {
  return manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
}

/**
 * Read one snapshot and prove it is the file the manifest describes: same bytes (SHA-256), same
 * row count, every row well-formed and every id unique. Throws on any disagreement.
 */
export function readSnapshot(
  entry: z.infer<typeof snapshotEntrySchema>,
  root: string = ROOT,
): ReferenceRow[] {
  const bytes = readFileSync(path.join(root, entry.file));
  const actual = sha256Hex(bytes);
  if (actual !== entry.sha256) {
    throw new Error(
      `${entry.file}: SHA-256 ${actual} does not match the manifest's ${entry.sha256}; refusing to load`,
    );
  }
  const [header, ...body] = parseCsv(bytes.toString("utf8"));
  if (header?.join(",") !== "id,name,city,state") {
    throw new Error(`${entry.file}: unexpected header`);
  }
  if (body.length !== entry.rows) {
    throw new Error(
      `${entry.file}: ${body.length} rows, the manifest says ${entry.rows}`,
    );
  }
  const idSchema =
    entry.table === "ref_colleges" ? collegeIdSchema : highSchoolIdSchema;
  const seen = new Set<string>();
  return body.map((cells, index) => {
    const [id, name, city, state] = cells;
    const row = referenceSchoolSchema.parse({ id, name, city, state });
    idSchema.parse(row.id);
    if (seen.has(row.id)) {
      throw new Error(`${entry.file}: duplicate id at data row ${index + 1}`);
    }
    seen.add(row.id);
    return row;
  });
}

export type ImportOutcome = {
  table: string;
  rows: number;
  changed: number;
  retired: number;
};

const BATCH = 2000;

/** One table, one transaction: upsert every row, then retire what the snapshot no longer has. */
export async function importTable(
  client: pg.Client,
  table: "ref_colleges" | "ref_high_schools",
  rows: ReferenceRow[],
): Promise<ImportOutcome> {
  let changed = 0;
  await client.query("BEGIN");
  try {
    for (let start = 0; start < rows.length; start += BATCH) {
      const batch = rows.slice(start, start + BATCH);
      const result = await client.query(
        `INSERT INTO public.${table} AS t (id, name, city, state)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[])
         ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name, city = EXCLUDED.city, state = EXCLUDED.state,
               retired_at = NULL, imported_at = now()
           WHERE (t.name, t.city, t.state, t.retired_at)
                 IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.city, EXCLUDED.state, NULL::timestamptz)`,
        [
          batch.map((r) => r.id),
          batch.map((r) => r.name),
          batch.map((r) => r.city),
          batch.map((r) => r.state),
        ],
      );
      changed += result.rowCount ?? 0;
    }
    const retired = await client.query(
      `UPDATE public.${table} SET retired_at = now()
        WHERE retired_at IS NULL AND NOT (id = ANY($1::text[]))`,
      [rows.map((r) => r.id)],
    );
    await client.query("COMMIT");
    return {
      table,
      rows: rows.length,
      changed,
      retired: retired.rowCount ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

/** Verify both snapshots first, then load both. A bad second file stops the run before any write. */
export async function importReferenceData(
  client: pg.Client,
  manifestPath: string = MANIFEST_PATH,
): Promise<ImportOutcome[]> {
  const manifest = readManifest(manifestPath);
  const colleges = readSnapshot(manifest.snapshots.colleges);
  const schools = readSnapshot(manifest.snapshots.high_schools);
  return [
    await importTable(client, "ref_colleges", colleges),
    await importTable(client, "ref_high_schools", schools),
  ];
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error("SUPABASE_DB_URL is not set");
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const outcome of await importReferenceData(client)) {
      process.stdout.write(`${JSON.stringify(outcome)}\n`);
    }
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `reference import failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exit(1);
  });
}
