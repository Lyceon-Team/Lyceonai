/**
 * @spec [CC Brief "Video Library (ships now)", Karl 2026-10-15, §5 (review all of it as a CSV;
 *       no row approved without approved_by; retrieval returns approved rows only), §4 (tags
 *       constrained to the 29 taxonomy names)] | @implemented [2026-10-15]
 *
 * plain English: writes the REVIEWED file, docs/plans/lisa-video-library/video-tags-review.csv,
 * to `video_resources` — exactly what Karl read, never a fresh model answer. In one
 * transaction:
 *  1. every row without an error is written through `public.video_resource_tag` (its skills,
 *     domain and start as they stand in the file, so a skill Karl corrected in the file is the
 *     skill stored; a changed tag set clears an earlier approval in the function itself);
 *  2. the rows marked `approve` = `yes` are approved through `public.video_resources_approve`
 *     with `--approver <uuid>` (Karl's user id). Approving needs the approver; without one,
 *     nothing is approved.
 *
 * Every skill is checked against the taxonomy and every domain is re-derived from it; one bad
 * cell fails the whole run before anything is written. A row marked yes that has no skills, or
 * an error, fails the run too: an approval that cannot take effect is a review mistake to see,
 * not to skip. Dry run by default; production is owner-run.
 *
 * Usage: pnpm exec tsx scripts/rag/apply-video-library.ts --approver <uuid>
 *        DATABASE_URL=... pnpm exec tsx scripts/rag/apply-video-library.ts --approver <uuid> --execute
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
// pg ships no types and @types/pg is not a dependency; scripts/ci/types/pg.d.ts declares the
// narrow surface used here.
import { Client } from "pg";
import { z } from "zod";
import { parseCsv } from "../reference-data/import-reference-data";
import { REVIEW_CSV, loadTaxonomy } from "./tag-videos";

const HEADER =
  "approve,video_id,tier,source,title,channel,duration,skills,domain,start,chapters,reason,error,url,duration_s,start_s";

export type ReviewedVideo = {
  video_id: string;
  title: string;
  channel_name: string;
  duration_seconds: number;
  skill_codes: string[];
  domain: string | null;
  start_seconds: number | null;
  approve: boolean;
};

const cellsSchema = z.object({
  approve: z.string(),
  video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1),
  channel: z.string().min(1),
  skills: z.string(),
  error: z.string(),
  duration_s: z.coerce.number().int().positive(),
  start_s: z.string(),
});

/**
 * Pure. The reviewed CSV → the rows to write. Throws on any cell that does not hold: an
 * unknown header, a skill outside the taxonomy, a start outside the video, an approve value
 * other than yes/blank, or yes on a row with no skills or an error. Rows with an error and no
 * approval are left out (nothing to write).
 */
export function parseReviewedCsv(
  text: string,
  domainOf: ReadonlyMap<string, string>,
): ReviewedVideo[] {
  const [header, ...body] = parseCsv(text).filter(
    (r) => !(r.length === 1 && r[0] === ""),
  );
  if (header?.join(",") !== HEADER)
    throw new Error("video-tags-review.csv: unexpected header");
  const seen = new Set<string>();
  const out: ReviewedVideo[] = [];
  body.forEach((cells, i) => {
    const at = `video-tags-review.csv data row ${i + 1}`;
    const named = Object.fromEntries(
      HEADER.split(",").map((k, j) => [k, cells[j] ?? ""]),
    );
    const c = cellsSchema.parse(named);
    if (seen.has(c.video_id)) throw new Error(`${at}: duplicate ${c.video_id}`);
    seen.add(c.video_id);
    const mark = c.approve.trim().toLowerCase();
    if (mark !== "" && mark !== "yes")
      throw new Error(
        `${at}: approve must be "yes" or blank, got "${c.approve}"`,
      );
    const approve = mark === "yes";
    const skills = [
      ...new Set(
        c.skills
          .split(";")
          .map((s) => s.trim())
          .filter((s) => s !== ""),
      ),
    ];
    for (const s of skills) {
      if (!domainOf.has(s))
        throw new Error(`${at}: "${s}" is not a taxonomy skill`);
    }
    if (c.error.trim() !== "") {
      if (approve)
        throw new Error(`${at}: approve=yes on a row that failed tagging`);
      return;
    }
    if (approve && skills.length === 0)
      throw new Error(`${at}: approve=yes on a row with no skills`);
    const start = c.start_s.trim() === "" ? null : Number(c.start_s);
    if (
      start !== null &&
      (!Number.isInteger(start) || start < 0 || start >= c.duration_s)
    )
      throw new Error(`${at}: start_s ${c.start_s} is outside the video`);
    const first = skills[0];
    out.push({
      video_id: c.video_id,
      title: c.title,
      channel_name: c.channel,
      duration_seconds: c.duration_s,
      skill_codes: skills,
      domain: first === undefined ? null : (domainOf.get(first) ?? null),
      start_seconds: start,
      approve,
    });
  });
  return out;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      approver: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  });
  const approver =
    values.approver === undefined
      ? null
      : z.string().uuid().parse(values.approver);
  const rows = parseReviewedCsv(
    readFileSync(REVIEW_CSV, "utf8"),
    loadTaxonomy().domainOf,
  );
  const approved = rows.filter((r) => r.approve).map((r) => r.video_id);
  if (approved.length > 0 && approver === null)
    throw new Error(
      `${approved.length} rows marked yes but no --approver: nothing is approved without approved_by`,
    );
  process.stdout.write(
    `${rows.length} rows to tag (${rows.filter((r) => r.skill_codes.length > 0).length} with skills), ${approved.length} to approve\n`,
  );
  if (values.execute !== true) {
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
    for (const r of rows) {
      await db.query(
        "SELECT public.video_resource_tag($1, $2, $3, $4, $5::text[], $6, $7, $8)",
        [
          r.video_id,
          r.title,
          r.channel_name,
          r.duration_seconds,
          r.skill_codes,
          r.domain,
          r.start_seconds,
          "video-tags-review.csv",
        ],
      );
    }
    const res =
      approved.length === 0
        ? 0
        : z.coerce
            .number()
            .parse(
              (
                await db.query(
                  "SELECT public.video_resources_approve($1::text[], $2::uuid) AS n",
                  [approved, approver],
                )
              ).rows[0]?.n,
            );
    if (res !== approved.length)
      throw new Error(`approved ${res} of ${approved.length}; rolled back`);
    await db.query("COMMIT");
    process.stdout.write(`written: ${rows.length} tagged, ${res} approved\n`);
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
