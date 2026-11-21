/**
 * @spec [Doc-03D_V1.2 §6.7 as amended by SCL-259; CC Brief "Video Library (ships now)", Karl
 *       2026-10-15, §5 (no row approved without approved_by); owner brief "apply SQL for the
 *       gaps run" (#1447 merged), Karl 2026-11-11: the 20-row sample approved 2026-11-06; rows
 *       approved as proposed; Lines, Angles, and Triangles, One-Variable Data and Ratios stay
 *       held as retag; the 5 held videos take their series' format (lesson, ruled 2026-11-05);
 *       no writes to curriculum_chunks; guards check that every referenced id exists, never a
 *       count] | @implemented [2026-11-11]
 *
 * plain English: writes the two owner-run transactions for the content-gap run of 2026-11-04,
 * from the reviewed files exactly as Karl read them. It never connects to a database.
 *
 *  1. `apply-video-gaps-library.sql`: the gaps run's new `video_resources` rows (the videos in
 *     `gaps-2026-11-04-proposal.csv` that the library review file holds), tagged through
 *     `public.video_resource_tag` and approved through `public.video_resources_approve`. The
 *     library's other rows are never named, and a post-check fails the transaction if any row
 *     outside this file's list was written by it.
 *  2. `apply-video-gaps-segments.sql`: the reviewed segments of those videos, through
 *     `public.video_segments_set`, and the rows marked yes approved through
 *     `public.video_segments_approve`. It refuses to run unless every video it names is in
 *     `video_resources` AND approved, so it must run after file 1.
 *
 * Both are idempotent: a row or video already in the file's state is skipped (so a second run
 * writes nothing, and no tagged_at or approved_at moves), and only unapproved rows are
 * approved. Karl's user id is the approver. Guards check every referenced id exists (skills in
 * `sub_skills.skill_code`; sub-skills, clusters, videos), never a table size. Each file ends
 * with a count query and the totals expected from the committed state.
 *
 * Usage: pnpm exec tsx scripts/rag/apply-video-gaps.ts [--approver <uuid>]  (default: Karl's id)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseCsv } from "../reference-data/import-reference-data";
import { parseReviewedCsv, type ReviewedVideo } from "./apply-video-library";
import {
  ID_TOKEN,
  applyTaxonomySchema,
  dollar,
  libraryVideosFrom,
  missingCheck,
  parseReviewedSegments,
  type ReviewedSegment,
} from "./apply-video-segments";
import { SEGMENT_TAG_VERSION } from "./segment-videos";
import { REVIEW_CSV, loadTaxonomy } from "./tag-videos";

const DIR = "docs/plans/lisa-video-library";
export const GAPS_PROPOSAL_CSV = `${DIR}/gaps-2026-11-04-proposal.csv`;
export const GAPS_SEGMENTS_CSV = `${DIR}/segments-gaps-2026-11-04-review.csv`;
export const LIBRARY_SQL = `${DIR}/apply-video-gaps-library.sql`;
export const SEGMENTS_SQL = `${DIR}/apply-video-gaps-segments.sql`;
/** Segment files already applied: a gaps video must not appear in one (set would replace it). */
export const APPLIED_SEGMENT_CSVS = [`${DIR}/segments-phase-b-review.csv`];
/** The library writer's own tagged_by (apply-video-library.ts). */
const LIBRARY_TAGGED_BY = "video-tags-review.csv";

/** Pure. The video ids a CSV's `video_id` column holds. */
export function videoIdsOf(csv: string): Set<string> {
  const [header, ...rows] = parseCsv(csv);
  const i = header?.indexOf("video_id") ?? -1;
  if (i < 0) throw new Error("CSV has no video_id column");
  return new Set(rows.map((r) => r[i] ?? "").filter((v) => v.trim() !== ""));
}

/**
 * A control character (other than tab and newline) in a reviewed file cannot be stored as
 * Postgres text (NUL) or is a model artefact; refuse it, naming the file and line, rather than
 * emit SQL that rolls back in the editor. (2026-11-11: one NUL in a gaps evidence line.)
 */
export function assertNoControlChars(text: string, file: string): void {
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const bad = [...line.replace(/\r$/, "")].some((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return (c < 0x20 && c !== 0x09) || c === 0x7f;
    });
    if (bad)
      throw new Error(
        `${file} line ${i + 1}: control character; fix the reviewed file`,
      );
  });
}

function sqlText(v: string | null): string {
  return v === null ? "NULL::text" : dollar(v);
}

function sqlTextArray(xs: readonly string[]): string {
  return xs.length === 0
    ? "'{}'::text[]"
    : `ARRAY[${xs.map((x) => dollar(x)).join(", ")}]::text[]`;
}

function videoIdArray(ids: readonly string[]): string {
  for (const id of ids) {
    if (!ID_TOKEN.test(id))
      throw new Error(`refusing to embed id ${JSON.stringify(id)}`);
  }
  return `ARRAY[${ids.map((v) => `'${v}'`).join(", ")}]::text[]`;
}

/** The guard every file shares: nothing outside `ids` was written by this transaction. */
function untouchedCheck(
  table: string,
  ids: readonly string[],
  what: string,
): string[] {
  return [
    `  SELECT string_agg(DISTINCT x.video_id, ', ' ORDER BY x.video_id) INTO stray FROM ${table} x`,
    `  WHERE NOT (x.video_id = ANY (${videoIdArray(ids)}))`,
    "    AND (x.tagged_at = now() OR x.approved_at = now());",
    "  IF stray IS NOT NULL THEN",
    `    RAISE EXCEPTION '${what} outside this file were written: %', stray;`,
    "  END IF;",
  ];
}

/** Pure. File 1. `rows` are the gaps videos only; every one is marked yes. */
export function buildLibrarySql(
  rows: readonly ReviewedVideo[],
  approver: string,
  priorTotals: { rows: number; approved: number },
): string {
  const ids = rows.map((r) => r.video_id).sort();
  const approved = rows.filter((r) => r.approve).map((r) => r.video_id);
  const skills = [...new Set(rows.flatMap((r) => r.skill_codes))].sort();
  const values = [...rows]
    .sort((a, b) => a.video_id.localeCompare(b.video_id))
    .map(
      (r) =>
        `    ('${r.video_id}', ${dollar(r.title)}, ${dollar(r.channel_name)}, ${r.duration_seconds}, ` +
        `${sqlTextArray(r.skill_codes)}, ${sqlText(r.domain)}, ${r.start_seconds === null ? "NULL::integer" : r.start_seconds}, ` +
        `${sqlTextArray(r.methods)}, ${sqlText(r.format)})`,
    );
  const skillList = `ARRAY[${skills.map((s) => dollar(s)).join(", ")}]::text[]`;
  return [
    "-- Video library, content-gap run of 2026-11-04: the new video_resources rows (generated by",
    "-- scripts/rag/apply-video-gaps.ts from video-tags-review.csv and gaps-2026-11-04-proposal.csv;",
    "-- do not edit by hand, regenerate). Owner-run. Run BEFORE apply-video-gaps-segments.sql.",
    `-- ${ids.length} rows tagged, ${approved.length} approved, approver ${approver} (Karl).`,
    "-- The library's other rows are not named here, and the transaction fails if it writes any.",
    "-- Idempotent: a row already in this state is skipped; only unapproved rows are approved.",
    "BEGIN;",
    "",
    "DO $pre$",
    "DECLARE missing text;",
    "BEGIN",
    "  -- Every skill these rows use is a taxonomy skill (sub_skills.skill_code). No count.",
    "  SELECT string_agg(t.s, ', ' ORDER BY t.s) INTO missing",
    `  FROM unnest(${skillList}) AS t(s)`,
    "  WHERE NOT EXISTS (SELECT 1 FROM public.sub_skills x WHERE x.skill_code = t.s);",
    "  IF missing IS NOT NULL THEN",
    "    RAISE EXCEPTION 'skill(s) in this file are not in sub_skills.skill_code: % (load the taxonomy first)', missing;",
    "  END IF;",
    "END",
    "$pre$;",
    "",
    "WITH f (video_id, title, channel_name, duration_seconds, skill_codes, domain, start_seconds, methods, format) AS (",
    "  VALUES",
    values.join(",\n"),
    ")",
    "SELECT f.video_id,",
    "       public.video_resource_tag(f.video_id, f.title, f.channel_name, f.duration_seconds, f.skill_codes,",
    `                                 f.domain, f.start_seconds, ${dollar(LIBRARY_TAGGED_BY)}, f.methods, f.format) AS tagged`,
    "FROM f",
    "WHERE NOT EXISTS (",
    "  SELECT 1 FROM public.video_resources v",
    "  WHERE v.video_id = f.video_id",
    "    AND (v.title, v.channel_name, v.duration_seconds, v.skill_codes, v.domain, v.start_seconds,",
    "         v.methods, v.format)",
    "        IS NOT DISTINCT FROM",
    "        (f.title, f.channel_name, f.duration_seconds, f.skill_codes, f.domain, f.start_seconds,",
    "         f.methods, f.format)",
    ")",
    "ORDER BY f.video_id;",
    "",
    "SELECT public.video_resources_approve(",
    "  ARRAY(SELECT v.video_id FROM public.video_resources v",
    `        WHERE v.video_id = ANY (${videoIdArray(approved)}) AND v.approved_by IS NULL),`,
    `  '${approver}'::uuid`,
    ") AS approved_now;",
    "",
    "DO $post$",
    "DECLARE stray text; missing text;",
    "BEGIN",
    "  SELECT string_agg(t.id, ', ' ORDER BY t.id) INTO missing",
    `  FROM unnest(${videoIdArray(approved)}) AS t(id)`,
    "  WHERE NOT EXISTS (SELECT 1 FROM public.video_resources v WHERE v.video_id = t.id AND v.approved_by IS NOT NULL);",
    "  IF missing IS NOT NULL THEN",
    "    RAISE EXCEPTION 'not approved after the apply: %', missing;",
    "  END IF;",
    ...untouchedCheck("public.video_resources", ids, "video_resources rows"),
    "END",
    "$post$;",
    "",
    "COMMIT;",
    "",
    `-- Expected, from the committed state (${priorTotals.rows} library rows, ${priorTotals.approved} approved, before this file):`,
    `--   this_file = ${ids.length}, this_file_approved = ${approved.length}, total = ${priorTotals.rows + ids.length}, approved = ${priorTotals.approved + approved.length}.`,
    "SELECT count(*) FILTER (WHERE video_id = ANY (" +
      videoIdArray(ids) +
      ")) AS this_file,",
    "       count(*) FILTER (WHERE video_id = ANY (" +
      videoIdArray(ids) +
      ") AND approved_by IS NOT NULL) AS this_file_approved,",
    "       count(*) AS total,",
    "       count(*) FILTER (WHERE approved_by IS NOT NULL) AS approved",
    "FROM public.video_resources;",
    "",
  ].join("\n");
}

/** The stored-vs-file projection of a video's segments, so an unchanged video is skipped. */
const SEGMENT_NORM_FILE = [
  "(SELECT jsonb_agg(jsonb_build_object(",
  "    's', (e->>'start_seconds')::int, 'e', (e->>'end_seconds')::int, 'summary', e->>'summary',",
  "    'sub', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'), '[]'::jsonb) FROM jsonb_array_elements(e->'sub_skills') x),",
  "    'cl',  (SELECT coalesce(jsonb_agg(x ORDER BY x->>'id'), '[]'::jsonb) FROM jsonb_array_elements(e->'clusters') x),",
  "    'tv', tv.v, 'tb', tb.v) ORDER BY (e->>'start_seconds')::int)",
  "  FROM jsonb_array_elements(f.segs) e)",
].join("\n");

/** Pure. File 2. */
export function buildSegmentsSql(
  segments: readonly ReviewedSegment[],
  taxonomyVersion: string,
  taggedBy: string,
  approver: string,
  priorTotals: { segments: number; approved: number },
): string {
  const byVideo = new Map<string, ReviewedSegment[]>();
  for (const s of segments)
    byVideo.set(s.video_id, [...(byVideo.get(s.video_id) ?? []), s]);
  const videoIds = [...byVideo.keys()].sort();
  const subSkillIds = [
    ...new Set(segments.flatMap((s) => s.sub_skills.map((t) => t.id))),
  ].sort();
  const clusterIds = [
    ...new Set(segments.flatMap((s) => s.clusters.map((t) => t.id))),
  ].sort();
  const approved = segments
    .filter((s) => s.approve)
    .sort(
      (a, b) =>
        a.video_id.localeCompare(b.video_id) ||
        a.start_seconds - b.start_seconds,
    );
  const subTags = segments.reduce((n, s) => n + s.sub_skills.length, 0);
  const clTags = segments.reduce((n, s) => n + s.clusters.length, 0);
  const values = videoIds.map((vid) => {
    const list = [...(byVideo.get(vid) ?? [])].sort(
      (a, b) => a.start_seconds - b.start_seconds,
    );
    const json = JSON.stringify(
      list.map((s) => ({
        start_seconds: s.start_seconds,
        end_seconds: s.end_seconds,
        summary: s.summary,
        sub_skills: s.sub_skills,
        clusters: s.clusters,
      })),
    );
    return `    ('${vid}', ${dollar(json)}::jsonb)`;
  });
  const approveValues = approved
    .map((s) => `      ('${s.video_id}', ${s.start_seconds})`)
    .join(",\n");
  const vids = videoIdArray(videoIds);
  return [
    "-- Video segments, content-gap run of 2026-11-04: Karl's reviewed file applied (generated by",
    "-- scripts/rag/apply-video-gaps.ts from segments-gaps-2026-11-04-review.csv; do not edit by",
    "-- hand, regenerate). Owner-run, AFTER apply-video-gaps-library.sql: it refuses to run unless",
    "-- every video it names is in video_resources and approved.",
    `-- ${videoIds.length} videos, ${segments.length} segments written, ${approved.length} approved, approver ${approver} (Karl).`,
    "-- Held as retag (written, not approved): Lines, Angles, and Triangles; One-Variable Data;",
    "-- Ratios (rulings of 2026-11-05). Drop rows are not written. No write to curriculum_chunks.",
    "-- Idempotent: a video whose stored segments already match is skipped; only unapproved",
    "-- segments are approved.",
    "BEGIN;",
    "",
    "DO $pre$",
    "DECLARE missing text;",
    "BEGIN",
    ...missingCheck(
      subSkillIds,
      "public.sub_skills",
      "id",
      "sub-skill id(s) in this file are not in sub_skills: % (load the vocabulary first: scripts/scl-taxonomy-loader.ts --apply)",
    ),
    ...missingCheck(
      clusterIds,
      "public.clusters",
      "id",
      "cluster id(s) in this file are not in clusters: % (load the vocabulary first: scripts/scl-taxonomy-loader.ts --apply)",
    ),
    "  SELECT string_agg(t.id, ', ' ORDER BY t.id) INTO missing",
    `  FROM unnest(${vids}) AS t(id)`,
    "  WHERE NOT EXISTS (SELECT 1 FROM public.video_resources x",
    "                    WHERE x.video_id = t.id AND x.approved_by IS NOT NULL);",
    "  IF missing IS NOT NULL THEN",
    "    RAISE EXCEPTION 'video(s) in this file are not approved library rows: % (run apply-video-gaps-library.sql first)', missing;",
    "  END IF;",
    "END",
    "$pre$;",
    "",
    "WITH f (video_id, segs) AS (",
    "  VALUES",
    values.join(",\n"),
    "),",
    `tv (v) AS (SELECT ${dollar(taxonomyVersion)}::text),`,
    `tb (v) AS (SELECT ${dollar(taggedBy)}::text),`,
    "want AS (",
    `  SELECT f.video_id, f.segs, ${SEGMENT_NORM_FILE.split("\n").join("\n  ")} AS norm`,
    "  FROM f, tv, tb",
    "),",
    "have AS (",
    "  SELECT s.video_id, jsonb_agg(jsonb_build_object(",
    "      's', s.start_seconds, 'e', s.end_seconds, 'summary', s.summary,",
    "      'sub', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.sub_skill_id, 'evidence', t.evidence)",
    "                                        ORDER BY t.sub_skill_id), '[]'::jsonb)",
    "              FROM public.video_segment_sub_skills t WHERE t.segment_id = s.segment_id),",
    "      'cl',  (SELECT coalesce(jsonb_agg(jsonb_build_object('id', t.cluster_id, 'evidence', t.evidence)",
    "                                        ORDER BY t.cluster_id), '[]'::jsonb)",
    "              FROM public.video_segment_clusters t WHERE t.segment_id = s.segment_id),",
    "      'tv', s.taxonomy_version, 'tb', s.tagged_by) ORDER BY s.start_seconds) AS norm",
    "  FROM public.video_segments s",
    `  WHERE s.video_id = ANY (${vids})`,
    "  GROUP BY s.video_id",
    ")",
    "SELECT w.video_id, cardinality(public.video_segments_set(w.video_id, tv.v, tb.v, w.segs)) AS segments_set",
    "FROM want w LEFT JOIN have h USING (video_id), tv, tb",
    "WHERE h.norm IS DISTINCT FROM w.norm",
    "ORDER BY w.video_id;",
    "",
    "SELECT public.video_segments_approve(",
    "  ARRAY(",
    "    SELECT s.segment_id FROM public.video_segments s",
    "    JOIN (VALUES",
    approveValues,
    "    ) AS a(video_id, start_seconds) USING (video_id, start_seconds)",
    "    WHERE s.approved_by IS NULL",
    "  ),",
    `  '${approver}'::uuid`,
    ") AS approved_now;",
    "",
    "DO $post$",
    "DECLARE stray text; missing text; n integer;",
    "BEGIN",
    "  -- Every row marked yes exists and is approved; nothing else of these videos is approved.",
    "  SELECT string_agg(a.video_id || '@' || a.start_seconds, ', ') INTO missing",
    "  FROM (VALUES",
    approveValues,
    "  ) AS a(video_id, start_seconds)",
    "  WHERE NOT EXISTS (SELECT 1 FROM public.video_segments s",
    "                    WHERE s.video_id = a.video_id AND s.start_seconds = a.start_seconds",
    "                      AND s.approved_by IS NOT NULL);",
    "  IF missing IS NOT NULL THEN",
    "    RAISE EXCEPTION 'segments marked yes not approved after the apply: %', missing;",
    "  END IF;",
    "  SELECT count(*) INTO n FROM public.video_segments s",
    `  WHERE s.video_id = ANY (${vids}) AND s.approved_by IS NOT NULL;`,
    `  IF n <> ${approved.length} THEN`,
    `    RAISE EXCEPTION 'expected ${approved.length} approved segments on these videos, found %', n;`,
    "  END IF;",
    "  SELECT count(*) INTO n FROM public.video_segments s",
    `  WHERE s.video_id = ANY (${vids});`,
    `  IF n <> ${segments.length} THEN`,
    `    RAISE EXCEPTION 'expected ${segments.length} segments on these videos, found %', n;`,
    "  END IF;",
    ...untouchedCheck("public.video_segments", videoIds, "segments of videos"),
    "  -- The library is file 1's: this file writes no video_resources row.",
    "  SELECT string_agg(x.video_id, ', ' ORDER BY x.video_id) INTO stray FROM public.video_resources x",
    "  WHERE x.tagged_at = now() OR x.approved_at = now();",
    "  IF stray IS NOT NULL THEN",
    "    RAISE EXCEPTION 'video_resources rows were written by the segment file: %', stray;",
    "  END IF;",
    "END",
    "$post$;",
    "",
    "COMMIT;",
    "",
    `-- Expected, from the committed state (Phase B: ${priorTotals.segments} segments, ${priorTotals.approved} approved, before this file):`,
    `--   this_file = ${segments.length}, this_file_approved = ${approved.length}, this_file_sub_skill_tags = ${subTags},`,
    `--   this_file_cluster_tags = ${clTags}, total = ${priorTotals.segments + segments.length}, approved = ${priorTotals.approved + approved.length}.`,
    "SELECT count(*) FILTER (WHERE s.video_id = ANY (" +
      vids +
      ")) AS this_file,",
    "       count(*) FILTER (WHERE s.video_id = ANY (" +
      vids +
      ") AND s.approved_by IS NOT NULL) AS this_file_approved,",
    "       (SELECT count(*) FROM public.video_segment_sub_skills t JOIN public.video_segments x USING (segment_id)",
    `         WHERE x.video_id = ANY (${vids})) AS this_file_sub_skill_tags,`,
    "       (SELECT count(*) FROM public.video_segment_clusters t JOIN public.video_segments x USING (segment_id)",
    `         WHERE x.video_id = ANY (${vids})) AS this_file_cluster_tags,`,
    "       count(*) AS total,",
    "       count(*) FILTER (WHERE s.approved_by IS NOT NULL) AS approved",
    "FROM public.video_segments s;",
    "",
  ].join("\n");
}

/** Reads the committed files and builds both transactions. Pure apart from the reads. */
export function buildGapsApply(
  approver: string,
  taxonomyPath: string = resolve(
    "content/canonical/subskill-cluster-taxonomy.json",
  ),
): { librarySql: string; segmentsSql: string; summary: string } {
  const taxonomy = applyTaxonomySchema.parse(
    JSON.parse(readFileSync(taxonomyPath, "utf8")),
  );
  const libraryCsv = readFileSync(REVIEW_CSV, "utf8");
  assertNoControlChars(libraryCsv, REVIEW_CSV);
  const gaps = videoIdsOf(readFileSync(GAPS_PROPOSAL_CSV, "utf8"));

  // File 1: the library rows the gaps run added, each one marked yes.
  const all = parseReviewedCsv(libraryCsv, loadTaxonomy().domainOf);
  const rows = all.filter((r) => gaps.has(r.video_id));
  const notYes = rows.filter((r) => !r.approve).map((r) => r.video_id);
  if (notYes.length > 0)
    throw new Error(`gaps rows not marked yes: ${notYes.join(", ")}`);
  const existing = all.filter((r) => !gaps.has(r.video_id));
  const librarySql = buildLibrarySql(rows, approver, {
    rows: existing.length,
    approved: existing.filter((r) => r.approve).length,
  });

  // File 2: segments, only of those videos, none already applied by an earlier file.
  const segCsv = readFileSync(GAPS_SEGMENTS_CSV, "utf8");
  assertNoControlChars(segCsv, GAPS_SEGMENTS_CSV);
  const segVideos = videoIdsOf(segCsv);
  const outside = [...segVideos].filter(
    (v) => !rows.some((r) => r.video_id === v),
  );
  if (outside.length > 0)
    throw new Error(
      `segment file names non-gaps videos: ${outside.join(", ")}`,
    );
  for (const f of APPLIED_SEGMENT_CSVS) {
    const clash = [...videoIdsOf(readFileSync(f, "utf8"))].filter((v) =>
      segVideos.has(v),
    );
    if (clash.length > 0)
      throw new Error(`${f} already applied segments for ${clash.join(", ")}`);
  }
  const videos = libraryVideosFrom(libraryCsv, taxonomy);
  const parsed = parseReviewedSegments(segCsv, taxonomy, videos);
  if (!parsed.ok) {
    throw new Error(
      `${parsed.errors.length} problem(s); nothing written:\n${parsed.errors.join("\n")}`,
    );
  }
  // The Phase B file's totals, the committed segment state before this one.
  const prior = parseReviewedSegments(
    readFileSync(APPLIED_SEGMENT_CSVS[0] ?? "", "utf8"),
    taxonomy,
    videos,
  );
  if (!prior.ok) throw new Error("the Phase B file no longer parses");
  const segmentsSql = buildSegmentsSql(
    parsed.segments,
    taxonomy.taxonomy_version,
    `${SEGMENT_TAG_VERSION} gemini 2-pass, reviewed`,
    approver,
    {
      segments: prior.segments.length,
      approved: prior.segments.filter((s) => s.approve).length,
    },
  );
  const summary =
    `library: ${rows.length} new rows (${existing.length} existing untouched); ` +
    `segments: ${new Set(parsed.segments.map((s) => s.video_id)).size} videos, ` +
    `${parsed.segments.length} written, ${parsed.segments.filter((s) => s.approve).length} approved`;
  return { librarySql, segmentsSql, summary };
}

/** Karl's user id, the approver of the gaps apply (owner brief 2026-11-11). */
export const GAPS_APPROVER = "0d0fa617-17f3-4fb7-aeab-2bc668d9db48";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { approver: { type: "string", default: GAPS_APPROVER } },
  });
  const built = buildGapsApply(z.string().uuid().parse(values.approver));
  writeFileSync(LIBRARY_SQL, built.librarySql);
  writeFileSync(SEGMENTS_SQL, built.segmentsSql);
  process.stdout.write(`${built.summary}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
