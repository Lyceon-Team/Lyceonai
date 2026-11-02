/**
 * @spec [Doc-03D_V1.2 §6.7 as amended by SCL-259; owner brief "Video segments tagged by
 *       sub-skill and cluster", Karl 2026-10-29, Phase B (deliverable: apply SQL for Karl to
 *       paste into the SQL editor; no production writes by CC)] | @implemented [2026-10-29]
 *
 * plain English: turns Karl's REVIEWED segment file into one SQL transaction he pastes into the
 * Supabase SQL editor. It never connects to a database: it writes a file.
 *  1. For every video in the file, `public.video_segments_set` with the rows that are not
 *     `drop` and carry at least one tag, exactly as they stand in the file (a sub-skill Karl
 *     corrected is the sub-skill stored), with each tag's evidence line from the file's
 *     `evidence` column ("added in review" for an id the file's evidence does not cover).
 *  2. The rows marked `approve` = `yes` approved through `public.video_segments_approve`. The
 *     approver is a placeholder Karl replaces with his user id; left as it is, the uuid cast
 *     fails and the whole transaction rolls back, so nothing is half-applied.
 *  3. A precondition block first: the vocabulary version is loaded (the tag rows' foreign keys
 *     need it) and every video is in `video_resources`.
 *
 * Checked before anything is written, so one bad cell fails the run: every id is in the
 * taxonomy and in the video's section; a span lies inside the video and does not overlap the
 * next; a `yes` row has a tag; a video is an approved library row. Video ids are checked
 * against /^[A-Za-z0-9_-]{11}$/ and every text value goes in a dollar-quoted literal whose tag
 * is checked absent from it, so nothing in the file can break out of the SQL.
 *
 * Usage: pnpm exec tsx scripts/rag/apply-video-segments.ts \
 *          --csv docs/plans/lisa-video-library/segments-phase-b-review.csv \
 *          --out docs/plans/lisa-video-library/segments-phase-b-apply.sql
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseCsv } from "../reference-data/import-reference-data";
import { SEGMENT_TAG_VERSION } from "./segment-videos";
import { REVIEW_CSV } from "./tag-videos";

export const APPROVER_PLACEHOLDER = "REPLACE-WITH-YOUR-USER-ID";
const ADDED_IN_REVIEW = "added in review";

const taxonomySchema = z.object({
  taxonomy_version: z.string().min(1),
  sub_skills: z.array(
    z.object({
      id: z.string(),
      skill_code: z.string(),
      section: z.enum(["M", "RW"]),
    }),
  ),
  clusters: z.array(
    z.object({ id: z.string(), skills_seen_in: z.array(z.string()) }),
  ),
});
export type ApplyTaxonomy = z.infer<typeof taxonomySchema>;

export type LibraryVideo = {
  video_id: string;
  duration_seconds: number;
  section: "M" | "RW";
};

export type ReviewedSegment = {
  video_id: string;
  start_seconds: number;
  end_seconds: number;
  summary: string;
  sub_skills: Array<{ id: string; evidence: string }>;
  clusters: Array<{ id: string; evidence: string }>;
  approve: boolean;
};

const rowSchema = z.object({
  approve: z.string(),
  proposal: z.enum(["approve", "retag", "drop"]),
  video_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  start_s: z.coerce.number().int().nonnegative(),
  end_s: z.coerce.number().int().positive(),
  sub_skills: z.string(),
  clusters: z.string(),
  summary: z.string(),
  evidence: z.string(),
});

function idList(cell: string): string[] {
  return [
    ...new Set(
      cell
        .split(";")
        .map((x) => x.trim())
        .filter((x) => x !== ""),
    ),
  ];
}

/** "ID: line | ID: line" back into a map. */
export function parseEvidence(cell: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of cell.split(" | ")) {
    const i = part.indexOf(": ");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 2).trim());
  }
  return out;
}

/**
 * Pure. The reviewed file's rows, checked. Drop rows and rows with no tag are left out (a
 * segment with no tag can neither be approved nor serve anything). Returns every problem at
 * once rather than the first.
 */
export function parseReviewedSegments(
  csv: string,
  taxonomy: ApplyTaxonomy,
  videos: Map<string, LibraryVideo>,
): { ok: true; segments: ReviewedSegment[] } | { ok: false; errors: string[] } {
  const [header, ...rows] = parseCsv(csv);
  if (header === undefined) return { ok: false, errors: ["the file is empty"] };
  const sub = new Map(taxonomy.sub_skills.map((s) => [s.id, s]));
  const clusterIds = new Set(taxonomy.clusters.map((c) => c.id));
  const errors: string[] = [];
  const segments: ReviewedSegment[] = [];
  rows.forEach((cells, i) => {
    if (cells.every((c) => c.trim() === "")) return;
    const line = i + 2;
    const parsed = rowSchema.safeParse(
      Object.fromEntries(header.map((h, j) => [h, cells[j] ?? ""])),
    );
    if (!parsed.success) {
      errors.push(
        `line ${line}: ${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("; ")}`,
      );
      return;
    }
    const r = parsed.data;
    const approve = r.approve.trim().toLowerCase() === "yes";
    if (r.proposal === "drop" && !approve) return;
    const video = videos.get(r.video_id);
    if (video === undefined) {
      errors.push(
        `line ${line}: ${r.video_id} is not an approved library video`,
      );
      return;
    }
    if (r.end_s <= r.start_s || r.end_s > video.duration_seconds) {
      errors.push(
        `line ${line}: span ${r.start_s}-${r.end_s} is outside ${r.video_id} (${video.duration_seconds} s)`,
      );
    }
    const evidence = parseEvidence(r.evidence);
    const subs = idList(r.sub_skills);
    const cls = idList(r.clusters);
    for (const id of subs) {
      const s = sub.get(id);
      if (s === undefined)
        errors.push(`line ${line}: ${id} is not a sub-skill`);
      else if (s.section !== video.section)
        errors.push(
          `line ${line}: ${id} is a ${s.section} sub-skill on a ${video.section} video`,
        );
    }
    for (const id of cls) {
      if (!clusterIds.has(id))
        errors.push(`line ${line}: ${id} is not a cluster`);
    }
    if (subs.length + cls.length === 0) {
      if (approve) errors.push(`line ${line}: marked yes with no tag`);
      return;
    }
    if (r.summary.trim() === "") errors.push(`line ${line}: no summary`);
    segments.push({
      video_id: r.video_id,
      start_seconds: r.start_s,
      end_seconds: r.end_s,
      summary: r.summary.trim(),
      sub_skills: subs.map((id) => ({
        id,
        evidence: evidence.get(id) ?? ADDED_IN_REVIEW,
      })),
      clusters: cls.map((id) => ({
        id,
        evidence: evidence.get(id) ?? ADDED_IN_REVIEW,
      })),
      approve,
    });
  });
  // Overlaps, per video, in start order.
  const byVideo = new Map<string, ReviewedSegment[]>();
  for (const s of segments)
    byVideo.set(s.video_id, [...(byVideo.get(s.video_id) ?? []), s]);
  for (const [vid, list] of byVideo) {
    const sorted = [...list].sort((a, b) => a.start_seconds - b.start_seconds);
    for (let k = 1; k < sorted.length; k += 1) {
      const prev = sorted[k - 1];
      const cur = sorted[k];
      if (
        prev !== undefined &&
        cur !== undefined &&
        cur.start_seconds < prev.end_seconds
      ) {
        errors.push(
          `${vid}: segments at ${prev.start_seconds} and ${cur.start_seconds} overlap`,
        );
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, segments };
}

/** A dollar-quoted literal whose tag is not in the text. */
function dollar(text: string): string {
  let tag = "seg";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
}

/** Pure. The transaction Karl pastes. Videos in id order, segments in start order. */
export function buildApplySql(
  segments: ReviewedSegment[],
  taxonomyVersion: string,
  taggedBy: string,
  expectedSubSkills: number,
): string {
  const byVideo = new Map<string, ReviewedSegment[]>();
  for (const s of segments)
    byVideo.set(s.video_id, [...(byVideo.get(s.video_id) ?? []), s]);
  const videoIds = [...byVideo.keys()].sort();
  const approved = segments
    .filter((s) => s.approve)
    .sort(
      (a, b) =>
        a.video_id.localeCompare(b.video_id) ||
        a.start_seconds - b.start_seconds,
    );
  const out: string[] = [
    "-- Video segments, Phase B: Karl's reviewed file applied (generated by",
    "-- scripts/rag/apply-video-segments.ts; do not edit by hand, regenerate from the file).",
    `-- ${videoIds.length} videos, ${segments.length} segments written, ${approved.length} approved.`,
    `-- Before running: replace ${APPROVER_PLACEHOLDER} (one place, at the end) with your user id.`,
    "-- Left as it is, the uuid cast fails and the whole transaction rolls back.",
    "BEGIN;",
    "",
    "DO $pre$",
    "BEGIN",
    `  IF (SELECT count(*) FROM public.sub_skills WHERE taxonomy_version = ${dollar(taxonomyVersion)}) <> ${expectedSubSkills} THEN`,
    `    RAISE EXCEPTION 'vocabulary ${taxonomyVersion} is not loaded (expected ${expectedSubSkills} sub-skills): run scripts/scl-taxonomy-loader.ts --apply first';`,
    "  END IF;",
    `  IF (SELECT count(*) FROM public.video_resources WHERE video_id = ANY (ARRAY[${videoIds.map((v) => `'${v}'`).join(", ")}]::text[])) <> ${videoIds.length} THEN`,
    "    RAISE EXCEPTION 'a video in this file is not in video_resources';",
    "  END IF;",
    "END",
    "$pre$;",
    "",
  ];
  for (const vid of videoIds) {
    const list = (byVideo.get(vid) ?? []).sort(
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
    out.push(
      `SELECT public.video_segments_set('${vid}', ${dollar(taxonomyVersion)}, ${dollar(taggedBy)}, ${dollar(json)}::jsonb);`,
    );
  }
  out.push("");
  if (approved.length === 0) {
    // VALUES with no rows is a syntax error; with nothing marked yes, approve nothing.
    out.push("-- No row is marked yes: nothing to approve.");
  } else {
    out.push(
      "SELECT public.video_segments_approve(",
      "  ARRAY(",
      "    SELECT s.segment_id FROM public.video_segments s",
      "    JOIN (VALUES",
      approved
        .map((s) => `      ('${s.video_id}', ${s.start_seconds})`)
        .join(",\n"),
      "    ) AS a(video_id, start_seconds) USING (video_id, start_seconds)",
      "  ),",
      `  '${APPROVER_PLACEHOLDER}'::uuid`,
      ") AS approved;",
    );
  }
  out.push("", "COMMIT;", "");
  return out.join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      csv: { type: "string" },
      out: { type: "string" },
      taxonomy: {
        type: "string",
        default: resolve("content/canonical/subskill-cluster-taxonomy.json"),
      },
    },
  });
  if (values.csv === undefined || values.out === undefined) {
    throw new Error("--csv <reviewed file> and --out <sql file> are required");
  }
  const taxonomy = taxonomySchema.parse(
    JSON.parse(readFileSync(values.taxonomy, "utf8")),
  );
  const sectionOf = new Map(
    taxonomy.sub_skills.map((s) => [s.skill_code, s.section]),
  );
  const [header, ...rows] = parseCsv(readFileSync(REVIEW_CSV, "utf8"));
  if (header === undefined) throw new Error("library review CSV is empty");
  const col = (n: string): number => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`library review CSV has no ${n} column`);
    return i;
  };
  const videos = new Map<string, LibraryVideo>();
  for (const r of rows) {
    if (r[col("approve")]?.trim().toLowerCase() !== "yes") continue;
    const skills = (r[col("skills")] ?? "").split(";").map((s) => s.trim());
    videos.set(r[col("video_id")] ?? "", {
      video_id: r[col("video_id")] ?? "",
      duration_seconds: Number(r[col("duration_s")]),
      section: skills.some((s) => sectionOf.get(s) === "M") ? "M" : "RW",
    });
  }
  const parsed = parseReviewedSegments(
    readFileSync(values.csv, "utf8"),
    taxonomy,
    videos,
  );
  if (!parsed.ok) {
    for (const e of parsed.errors) process.stderr.write(`${e}\n`);
    throw new Error(
      `${parsed.errors.length} problem(s) in the reviewed file; nothing written`,
    );
  }
  const sql = buildApplySql(
    parsed.segments,
    taxonomy.taxonomy_version,
    `${SEGMENT_TAG_VERSION} gemini 2-pass, reviewed`,
    taxonomy.sub_skills.length,
  );
  writeFileSync(values.out, sql);
  const approved = parsed.segments.filter((s) => s.approve).length;
  process.stdout.write(
    `wrote ${values.out}: ${new Set(parsed.segments.map((s) => s.video_id)).size} videos, ${parsed.segments.length} segments, ${approved} approved\n`,
  );
}

// R-16 (LISA_Video_RAG_Closure_Plan.md): the entry check that also matches a Windows path.
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
