/**
 * @spec [LISA_Video_RAG_Plan.md Step D §D.2 F (revised 2026-10-15, pgvector: embed each
 *       description with text-embedding-005 and write it through curriculum_chunk_upsert;
 *       no GCS, no import); closure plan R-3 (video_resources); SCL-231 (approved by Karl
 *       2026-10-15)] | @implemented [2026-10-15]
 *
 * plain English: step F for a tier already through map-skills.ts.
 *  1. Embeds every row of `scripts/rag/.cache/tier-<n>/segments.jsonl` (task type
 *     RETRIEVAL_DOCUMENT, 768 dimensions).
 *  2. With `--execute` and DATABASE_URL set, in ONE transaction: upserts each video into
 *     `video_resources` and each segment through `public.curriculum_chunk_upsert`, the one
 *     ingestion writer. Rows land `pending_review`; nothing is active until reviewed. A re-run
 *     updates in place; a changed segment drops back to review.
 *  Without `--execute` it embeds and prints what it would write, and writes nothing.
 *
 * PRODUCTION IS OWNER-RUN (CLAUDE.md): Karl runs `--execute` against production. CC runs it
 * against a local database built from the migration pipeline.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/embed-and-upsert.ts --tier 1
 *        NODE_USE_ENV_PROXY=1 DATABASE_URL=postgres://... pnpm exec tsx scripts/rag/embed-and-upsert.ts --tier 1 --execute
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
// pg ships no types and @types/pg is not a dependency; scripts/ci/types/pg.d.ts declares the
// narrow surface used here.
import { Client } from "pg";
import { z } from "zod";
import { loadTierVideos, tierDir } from "./generate-descriptions";
import { segmentRowSchema } from "./map-skills";
import { assertProxied, embedTexts } from "./vertex";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tier: { type: "string" },
      execute: { type: "boolean", default: false },
    },
  });
  assertProxied();
  const tier = z.coerce.number().int().min(1).max(5).parse(values.tier);
  const rows = readFileSync(resolve(tierDir(tier), "segments.jsonl"), "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => segmentRowSchema.parse(JSON.parse(l)));
  if (rows.length === 0)
    throw new Error(`tier ${tier}: segments.jsonl is empty`);
  const videos = loadTierVideos(tier).filter((v) =>
    rows.some((r) => r.video_id === v.video_id),
  );

  const vectors = await embedTexts(
    rows.map((r) => r.content),
    "RETRIEVAL_DOCUMENT",
  );
  process.stdout.write(
    `tier ${tier}: ${rows.length} segments embedded (${vectors[0]?.length ?? 0} dimensions), ${videos.length} videos\n`,
  );
  if (values.execute !== true) {
    process.stdout.write(
      "dry run: nothing written. Pass --execute with DATABASE_URL to write.\n",
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
    for (const v of videos) {
      await db.query(
        `INSERT INTO public.video_resources (video_id, title, channel_name, duration_seconds, status, last_checked_at)
         VALUES ($1, $2, $3, $4, 'available', now())
         ON CONFLICT (video_id) DO UPDATE SET title = EXCLUDED.title, channel_name = EXCLUDED.channel_name,
           duration_seconds = EXCLUDED.duration_seconds, status = 'available', last_checked_at = now()`,
        [v.video_id, v.title, v.channel_name, v.duration_seconds],
      );
    }
    let written = 0;
    for (const [i, r] of rows.entries()) {
      const vector = vectors[i];
      if (vector === undefined)
        throw new Error(`no vector for ${r.provenance}`);
      await db.query(
        "SELECT public.curriculum_chunk_upsert($1, $2, $3::text[], $4, $5, $6::extensions.vector)",
        [
          r.provenance,
          r.content,
          r.skill_codes,
          r.surface_gate,
          r.content_type,
          `[${vector.join(",")}]`,
        ],
      );
      written += 1;
    }
    await db.query("COMMIT");
    const status = await db.query<{ status: string; n: string }>(
      "SELECT status, count(*)::text AS n FROM public.curriculum_chunks WHERE provenance = ANY($1::text[]) GROUP BY status ORDER BY status",
      [rows.map((r) => r.provenance)],
    );
    process.stdout.write(
      `written: ${videos.length} video_resources, ${written} curriculum_chunks (${status.rows.map((s) => `${s.status} ${s.n}`).join(", ")})\n`,
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
