/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §3 (a separate
 *       apply-book-review.ts writes exactly the approved CSV, same pattern as
 *       apply-video-library.ts; a chunk cannot go active without reviewed_by), §5 (taxonomy
 *       names only; no chunk active without a reviewer)] | @implemented [2026-10-22]
 *
 * plain English: makes active exactly the book chunks Karl marked approve = yes in the review
 * CSV that ingest-book.ts exported, and nothing else. In one transaction, for each yes row:
 *   UPDATE curriculum_chunks SET skill_codes, content_type, surface_gate (as they stand in the
 *   file, so a tag Karl corrected is the tag stored), status 'active', reviewed_by, reviewed_at
 *   WHERE provenance matches AND the row is a book's AND it is pending_review AND the sha256 of
 *   its content equals the file's content_sha256.
 * The hash pins the approval to the text that was exported: if the book was re-ingested and a
 * chunk's text changed after the export, that row matches nothing and the run fails. A yes row
 * whose chunk is already active with the same text and tags counts as approved before (so the
 * same file can be applied again after more rows are marked); any other yes row that matches
 * nothing rolls the whole run back. Blank rows stay pending_review.
 * Approving needs --approver <uuid> (Karl's user id). Dry run by default; production is
 * owner-run.
 *
 * Usage: pnpm exec tsx scripts/rag/apply-book-review.ts --csv <review.csv> --approver <uuid>
 *        DATABASE_URL=... pnpm exec tsx scripts/rag/apply-book-review.ts --csv <review.csv> --approver <uuid> --execute
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
// pg ships no types and @types/pg is not a dependency; scripts/ci/types/pg.d.ts declares the
// narrow surface used here.
import { Client } from "pg";
import { z } from "zod";
import { parseBookReviewCsv } from "./book";
import { loadTaxonomy } from "./tag-videos";

export const APPROVE_SQL = `UPDATE public.curriculum_chunks
   SET skill_codes = $2::text[], content_type = $3, surface_gate = $4,
       status = 'active', reviewed_by = $5::uuid, reviewed_at = now(), updated_at = now()
 WHERE provenance = $1
   AND provenance LIKE 'book:%'
   AND status = 'pending_review'
   AND encode(sha256(convert_to(content, 'UTF8')), 'hex') = $6
RETURNING provenance`;

/** A yes row whose chunk is already active with the same text and tags: approved before. */
export const ALREADY_ACTIVE_SQL = `SELECT 1 FROM public.curriculum_chunks
 WHERE provenance = $1 AND provenance LIKE 'book:%' AND status = 'active'
   AND skill_codes = $2::text[] AND content_type = $3 AND surface_gate = $4
   AND encode(sha256(convert_to(content, 'UTF8')), 'hex') = $5`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      csv: { type: "string" },
      approver: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  });
  const csv = z.string().min(1).parse(values.csv);
  const rows = parseBookReviewCsv(
    readFileSync(csv, "utf8"),
    new Set(loadTaxonomy().skills),
  );
  if (rows.length > 0 && values.approver === undefined)
    throw new Error(
      `${rows.length} rows marked yes but no --approver: nothing is approved without reviewed_by`,
    );
  const approver =
    values.approver === undefined
      ? null
      : z.string().uuid().parse(values.approver);
  process.stdout.write(`${rows.length} rows marked yes\n`);
  if (values.execute !== true || rows.length === 0) {
    process.stdout.write(
      "dry run: nothing written. Pass --execute with DATABASE_URL.\n",
    );
    return;
  }
  const { DATABASE_URL } = z
    .object({ DATABASE_URL: z.string().min(1) })
    .parse(process.env);
  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query("BEGIN");
    const missed: string[] = [];
    let activated = 0;
    let already = 0;
    for (const r of rows) {
      const res = await db.query<{ provenance: string }>(APPROVE_SQL, [
        r.provenance,
        r.skill_codes,
        r.content_type,
        r.surface_gate,
        approver,
        r.content_sha256,
      ]);
      if (res.rows.length === 1) {
        activated += 1;
        continue;
      }
      const before = await db.query<{ "?column?": number }>(
        ALREADY_ACTIVE_SQL,
        [
          r.provenance,
          r.skill_codes,
          r.content_type,
          r.surface_gate,
          r.content_sha256,
        ],
      );
      if (before.rows.length === 1) already += 1;
      else missed.push(r.provenance);
    }
    if (missed.length > 0)
      throw new Error(
        `${missed.length} approved rows match no chunk with the reviewed text and tags (re-ingested since the export, or not a book chunk); rolled back: ${missed.slice(0, 10).join(", ")}`,
      );
    await db.query("COMMIT");
    process.stdout.write(
      `written: ${activated} chunks made active, ${already} already active as reviewed\n`,
    );
  } catch (err: unknown) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    await db.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
