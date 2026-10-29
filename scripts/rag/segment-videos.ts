/**
 * @spec [owner brief "Video segments tagged by sub-skill and cluster", Karl 2026-10-29, Phase A
 *       (design and pilot), as amended by the Phase A rulings of 2026-10-29 (1: the mapping
 *       rule; 2: calculator-technique segments keep clusters only; 5: fixed boundaries, tags
 *       compared on the same segments) and the re-pilot rulings of 2026-10-29 (2: a segment
 *       teaches one topic); docs/plans/lisa-video-library/segments-phase-a.md §3;
 *       R-14 (Gemini reads the video; transcripts are blocked)] | @implemented [2026-10-29]
 *
 * plain English: one tagging PASS over one or more approved library videos. Gemini watches the
 * video (in clips of at most 10 minutes over 15 minutes, as in the Desmos extraction) and tags
 * each segment from the CLOSED list of taxonomy ids for the video's section (sub-skills and
 * clusters), with one line of evidence per tag in our own words. `segment-agreement.ts` compares
 * the passes and keeps only what both agree on.
 *
 * Boundaries (ruling 5, a deliberate change from two independent segmentations):
 *  - A video with YouTube chapters: the chapters ARE the segments, in both passes. Clips break
 *    only at chapter starts (chapters packed up to 10 minutes; a chapter longer than that is
 *    split at 10-minute marks), so no chapter is cut by a clip edge it did not need.
 *  - A video without chapters: pass 1 cuts it at topic changes ("cut" mode); pass 2 reads pass
 *    1's cuts from its output file.
 *  - Pass 2 always tags given segments ("fixed" mode) and sees their times only, never pass 1's
 *    tags or summaries. It also flags any segment that mixes topics (`mixes_topics`); those go to
 *    Karl's review as the boundary check, separately from tag agreement.
 *
 * One topic per segment (Karl, 2026-10-29, re-pilot rule 2): `--splits <file>` gives split points
 * per video, taken from a pass's mixes_topics flags (`docs/plans/lisa-video-library/
 * segment-splits.json` records each point and where it came from). Both passes cut the chapters,
 * or pass 1's cuts, at those points. In fixed mode each segment also carries `overview` and the
 * structured `topic_changes` a later split file is built from. A segment either pass still calls
 * mixed or an overview keeps clusters only; `segment-agreement.ts` enforces that.
 *
 * Tagging (ruling 1): a sub-skill is tagged when a question carrying it is the kind of question
 * the segment teaches the student to solve. One general mapping rule for every sub-skill; the
 * inclusion tests are applied, as written, to those questions. A segment that teaches a
 * technique but no kind of question (ruling 2: calculator technique) carries clusters only.
 *
 * Rules (Karl, 2026-10-29), all enforced here, not left to the model:
 *  - Tag by id only. Any id not in the closed list is REJECTED and reported, never kept.
 *  - `method_in`: a cluster listed there for a segment's skill is present by default and is not
 *    tagged per segment. A tag the model gives anyway is moved to `method_in_defaults`, so the
 *    record shows it was seen, and it is never read as evidence that other segments lack it.
 *  - Several sub-skills and clusters per segment; no primary.
 *  - No second vocabulary: the ids come from the canonical taxonomy file the production tables
 *    mirror (`scripts/scl-taxonomy-loader.ts`). `--taxonomy` points at it.
 *
 * Independence between passes: both run at temperature 0 (generateJson); pass 2 lists the
 * vocabulary in reverse order, so a tag that depends on list position rather than on the video
 * shows up as a disagreement.
 *
 * Output: `scripts/rag/.cache/segments/<SEGMENT_TAG_VERSION>/<video_id>.pass<n>.json`
 * (gitignored), with token usage. Each clip is cached on its own, so a retry never re-pays for a
 * clip that finished. Prints ids, counts and cost only; no instructor text (the model is told not
 * to quote).
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/segment-videos.ts --pass 1 \
 *          --only a1QNaRnn6cE,qQzeFyLYt1A,UDJ2RHMFax8 [--taxonomy <path>] [--cap-usd 0.8] \
 *          [--splits docs/plans/lisa-video-library/segment-splits.json]
 *        then the same with --pass 2 (it needs pass 1's files).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  CLIP_SECONDS,
  WHOLE_VIDEO_MAX_SECONDS,
  clipsOf,
} from "./extract-desmos-moves";
import { parseClock } from "./segments";
import {
  GENERATION_MODEL_DEFAULT,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  generateJson,
  priceOf,
  usageSchema,
  type Usage,
} from "./vertex";

export const SEGMENT_TAG_VERSION = "segment-tags-v3";
const REVIEW_CSV = resolve(
  "docs/plans/lisa-video-library/video-tags-review.csv",
);
const METADATA = resolve("scripts/rag/.cache/metadata.json");
export const SEGMENTS_DIR = resolve(
  "scripts/rag/.cache/segments",
  SEGMENT_TAG_VERSION,
);
const TAXONOMY_DEFAULT = resolve(
  "content/canonical/subskill-cluster-taxonomy.json",
);
/** Measured on the Desmos extraction (27 videos, 2026-10-27): 92.5 prompt tokens per second. */
const VIDEO_TOKENS_PER_SECOND = 110;
/** About 1.7× the largest per-clip output (thinking included) measured in the first pilot. */
const OUTPUT_TOKENS_ESTIMATE = 8_000;

// ── The taxonomy (the canonical file; production mirrors it) ────────────────────────────

const taxonomySchema = z.object({
  taxonomy_version: z.string().min(1),
  sub_skills: z.array(
    z.object({
      id: z.string(),
      skill_code: z.string(),
      section: z.enum(["M", "RW"]),
      name: z.string(),
      definition: z.string(),
      inclusion_test: z.string(),
    }),
  ),
  clusters: z.array(
    z.object({
      id: z.string(),
      display_name: z.string(),
      family: z.enum(["by_hand_doing", "by_hand_recognizing", "desmos"]),
      definition: z.string(),
      skills_seen_in: z.array(z.string()),
      method_in: z.record(z.number()),
      playbook_move: z.string().optional(),
    }),
  ),
});
export type Taxonomy = z.infer<typeof taxonomySchema>;

export type Vocabulary = {
  version: string;
  section: "M" | "RW";
  subSkills: Taxonomy["sub_skills"];
  clusters: Taxonomy["clusters"];
  subSkillOf: Map<string, Taxonomy["sub_skills"][number]>;
  clusterOf: Map<string, Taxonomy["clusters"][number]>;
};

/** The closed list for one section: its sub-skills, and every cluster seen in its skills. */
export function vocabularyFor(t: Taxonomy, section: "M" | "RW"): Vocabulary {
  const subSkills = t.sub_skills.filter((s) => s.section === section);
  const skills = new Set(subSkills.map((s) => s.skill_code));
  const clusters = t.clusters.filter((c) =>
    c.skills_seen_in.some((s) => skills.has(s)),
  );
  return {
    version: t.taxonomy_version,
    section,
    subSkills,
    clusters,
    subSkillOf: new Map(subSkills.map((s) => [s.id, s])),
    clusterOf: new Map(clusters.map((c) => [c.id, c])),
  };
}

/** The vocabulary as the prompt shows it. `reverse` is pass 2's order. Labels are hints only. */
export function vocabularyText(v: Vocabulary, reverse: boolean): string {
  const order = <T>(xs: T[]): T[] => (reverse ? [...xs].reverse() : xs);
  return [
    "SUB-SKILLS. Tag by id. Each inclusion test says when a QUESTION carries the sub-skill.",
    ...order(v.subSkills).map(
      (s) =>
        `${s.id} [${s.skill_code}] ${s.name}: ${s.definition} Inclusion test: ${s.inclusion_test}`,
    ),
    "",
    "CLUSTERS (actions a student performs). Tag by id.",
    ...order(v.clusters).map(
      (c) =>
        `${c.id} (${c.family}) ${c.display_name}: ${c.definition}` +
        (Object.keys(c.method_in).length > 0
          ? ` [present by default in: ${Object.keys(c.method_in).join("; ")}; do not tag there]`
          : ""),
    ),
  ].join("\n");
}

// ── The model's answer ─────────────────────────────────────────────────────────────────

const tagSchema = z.object({ id: z.string(), evidence: z.string() });
const tagsFields = {
  teaches_sat_content: z.boolean(),
  summary: z.string(),
  sub_skills: z.array(tagSchema),
  clusters: z.array(tagSchema),
  /** What the segment teaches that no sub-skill or cluster expresses; "" when all fits. */
  not_in_taxonomy: z.string(),
};

/** "cut" mode (pass 1, no chapters): the model places the boundaries. */
export const segmentAnswerSchema = z.object({
  segments: z.array(
    z.object({ start: z.string(), end: z.string(), ...tagsFields }),
  ),
});
type SegmentAnswer = z.infer<typeof segmentAnswerSchema>;

/** "fixed" mode (chapters, or pass 2): the segments are given and answered by number. */
export const fixedAnswerSchema = z.object({
  segments: z.array(
    z.object({
      number: z.number().int(),
      ...tagsFields,
      /** Boundary check (ruling 5): the segment teaches two or more things a student would look for separately. */
      mixes_topics: z.boolean(),
      mixes_topics_note: z.string(),
      /** Where each new topic starts, "M:SS" relative to the part; [] unless mixes_topics. */
      topic_changes: z.array(z.string()),
      /** One-topic rule (2026-10-29 rule 2): surveys or introduces a topic area rather than teaching one kind of question. */
      overview: z.boolean(),
    }),
  ),
});
type FixedAnswer = z.infer<typeof fixedAnswerSchema>;

const tagArraySchema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { id: { type: "STRING" }, evidence: { type: "STRING" } },
    required: ["id", "evidence"],
  },
} as const;
const tagsProperties = {
  teaches_sat_content: { type: "BOOLEAN" },
  summary: { type: "STRING" },
  sub_skills: tagArraySchema,
  clusters: tagArraySchema,
  not_in_taxonomy: { type: "STRING" },
} as const;
const tagsRequired = [
  "teaches_sat_content",
  "summary",
  "sub_skills",
  "clusters",
  "not_in_taxonomy",
] as const;

const segmentResponseSchema = {
  type: "OBJECT",
  properties: {
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "STRING" },
          end: { type: "STRING" },
          ...tagsProperties,
        },
        required: ["start", "end", ...tagsRequired],
      },
    },
  },
  required: ["segments"],
} as const;

const fixedResponseSchema = {
  type: "OBJECT",
  properties: {
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          number: { type: "INTEGER" },
          ...tagsProperties,
          mixes_topics: { type: "BOOLEAN" },
          mixes_topics_note: { type: "STRING" },
          topic_changes: { type: "ARRAY", items: { type: "STRING" } },
          overview: { type: "BOOLEAN" },
        },
        required: [
          "number",
          ...tagsRequired,
          "mixes_topics",
          "mixes_topics_note",
          "topic_changes",
          "overview",
        ],
      },
    },
  },
  required: ["segments"],
} as const;

const TAGS_RULES = `TAGS. For each teaching segment, tag every sub-skill and every cluster that applies, as many as apply, none primary.
A sub-skill: tag it when a question carrying it is the kind of question this segment teaches the student to solve. The inclusion tests describe questions; apply each one to the questions this segment prepares a student for, not to the segment's own wording. A segment that works one example teaches the kind of question that example is.
A segment that teaches a technique (for example a calculator feature) without teaching any kind of question gets no sub-skill; tag its clusters only.
A cluster: tag it when a student following the segment would perform that action. Do not tag a cluster in a skill where it is marked present by default.
Use ids exactly as listed; never invent one. For every tag, evidence is one short line in your own words saying what in the segment shows it. Never quote the speaker.

not_in_taxonomy: if the segment teaches something no listed sub-skill or cluster expresses (for example a concept that spans a whole skill, or a calculator feature with no matching cluster), describe it in one line; otherwise "".

summary: one line, at most 20 words, in your own words.

teaches_sat_content is false for intros, sign-offs, promotion and general advice.`;

/** "cut" mode: the model splits the part and tags each piece. */
export function segmentSystem(vocabulary: string): string {
  return `You segment one SAT preparation video and tag each segment with what it teaches, from a closed list of ids. Watch the video, using what is shown and typed on screen as well as what is said.

SEGMENTS. Split the part you are shown at topic changes: a new kind of problem, a new skill or a new technique. Do not cut inside one worked problem. Segments tile the part in order with no gaps or overlaps.

TIMES. Clock times relative to the start of the part you are watching, as "M:SS": the first segment starts at "0:00" and the last ends at the part's length.

${TAGS_RULES}

${vocabulary}`;
}

/** "fixed" mode: the segments are given; the model tags each and flags any that mixes topics. */
export function fixedSystem(vocabulary: string): string {
  return `You tag the given segments of one SAT preparation video with what each teaches, from a closed list of ids. Watch the video, using what is shown and typed on screen as well as what is said.

SEGMENTS are given, numbered, with times relative to the start of the part you are watching. Answer every segment exactly once by its number. Do not merge, split or move them.

A segment should teach one topic: one kind of question, or one technique.
mixes_topics: true when a segment teaches two or more different kinds of question or techniques that a student would want to find separately; then mixes_topics_note says in one line what the parts are, and topic_changes lists the time each new part starts, as "M:SS" relative to the part. Otherwise false, "" and [].
overview: true when a segment surveys or introduces a topic area (what functions are, what a calculator can do, when to use a method) rather than teaching the student to solve one kind of question. A segment that works a specific example of one kind of question is not an overview.

${TAGS_RULES}

${vocabulary}`;
}

// ── Checking an answer (pure) ──────────────────────────────────────────────────────────

export type TaggedSegment = {
  start_seconds: number;
  end_seconds: number;
  teaches_sat_content: boolean;
  summary: string;
  sub_skills: Array<{ id: string; evidence: string }>;
  clusters: Array<{ id: string; evidence: string }>;
  method_in_defaults: string[];
  rejected_ids: string[];
  not_in_taxonomy: string;
  /** Fixed mode only; false in cut mode, which places its own boundaries. */
  mixes_topics: boolean;
  mixes_topics_note: string;
  /** Fixed mode only: where pass's named topic changes fall, on the video's clock, inside the segment. */
  topic_change_seconds: number[];
  /** Fixed mode only (rule 2): a survey or introduction, not targeted teaching. */
  overview: boolean;
};

type Tags = z.infer<z.ZodObject<typeof tagsFields>>;

/** Ids outside the closed list rejected (and listed); method_in defaults moved aside. */
function checkTags(
  s: Tags,
  v: Vocabulary,
): Omit<
  TaggedSegment,
  | "start_seconds"
  | "end_seconds"
  | "mixes_topics"
  | "mixes_topics_note"
  | "topic_change_seconds"
  | "overview"
> {
  const skillsOfSegment = new Set(
    s.sub_skills
      .map((t) => v.subSkillOf.get(t.id)?.skill_code)
      .filter((x): x is string => x !== undefined),
  );
  const rejected: string[] = [];
  const subSkills = s.sub_skills.filter((t) => {
    if (v.subSkillOf.has(t.id)) return true;
    rejected.push(t.id);
    return false;
  });
  const methodInDefaults: string[] = [];
  const clusters = s.clusters.filter((t) => {
    const c = v.clusterOf.get(t.id);
    if (c === undefined) {
      rejected.push(t.id);
      return false;
    }
    if (Object.keys(c.method_in).some((skill) => skillsOfSegment.has(skill))) {
      methodInDefaults.push(t.id);
      return false;
    }
    return true;
  });
  return {
    teaches_sat_content: s.teaches_sat_content,
    summary: s.summary,
    sub_skills: dedupe(subSkills),
    clusters: dedupe(clusters),
    method_in_defaults: [...new Set(methodInDefaults)],
    rejected_ids: [...new Set(rejected)],
    not_in_taxonomy: s.not_in_taxonomy.trim(),
  };
}

/**
 * Pure. Cut mode: turns one clip's answer into checked segments on the video's own clock (times
 * offset by the clip start). Returns an error when the times do not parse or do not tile the clip.
 */
export function checkClipAnswer(
  answer: SegmentAnswer,
  clip: { start: number; end: number },
  v: Vocabulary,
): { ok: true; segments: TaggedSegment[] } | { ok: false; error: string } {
  const length = clip.end - clip.start;
  const out: TaggedSegment[] = [];
  let cursor = 0;
  for (const s of answer.segments) {
    const start = parseClock(s.start);
    const end = parseClock(s.end);
    if (start === null || end === null) {
      return { ok: false, error: `unparseable time ${s.start}-${s.end}` };
    }
    if (end <= start)
      return { ok: false, error: `empty segment at ${s.start}` };
    if (Math.abs(start - cursor) > 3) {
      return {
        ok: false,
        error: `${start > cursor ? "gap" : "overlap"} at ${cursor}s`,
      };
    }
    cursor = end;
    out.push({
      start_seconds: clip.start + start,
      end_seconds: clip.start + end,
      ...checkTags(s, v),
      mixes_topics: false,
      mixes_topics_note: "",
      topic_change_seconds: [],
      overview: false,
    });
  }
  if (Math.abs(cursor - length) > 3) {
    return { ok: false, error: `ends at ${cursor}s of ${length}s` };
  }
  const last = out[out.length - 1];
  if (last) last.end_seconds = clip.end;
  return { ok: true, segments: out };
}

export type Span = { start: number; end: number };

/**
 * Pure. Fixed mode: the given segments (on the video's clock) keep their times exactly; each must
 * be answered once by its 1-based number. Returns an error on a missing, repeated or unknown number.
 * A mixed-topic note is prefixed with the clip start its times are measured from. Topic changes are
 * moved onto the video's clock and kept only when strictly inside their segment (more than 3 s
 * from either edge); an unparseable one is an error.
 */
export function checkFixedAnswer(
  answer: FixedAnswer,
  given: Span[],
  v: Vocabulary,
): { ok: true; segments: TaggedSegment[] } | { ok: false; error: string } {
  const byNumber = new Map<number, FixedAnswer["segments"][number]>();
  for (const s of answer.segments) {
    if (s.number < 1 || s.number > given.length) {
      return { ok: false, error: `unknown segment number ${s.number}` };
    }
    if (byNumber.has(s.number)) {
      return { ok: false, error: `segment ${s.number} answered twice` };
    }
    byNumber.set(s.number, s);
  }
  // The note's times are relative to the clip (the model's clock); say where that clock starts.
  const clipStart = given[0]?.start ?? 0;
  const noteFrom = clipStart > 0 ? `[times from ${clock(clipStart)}] ` : "";
  const out: TaggedSegment[] = [];
  for (const [i, span] of given.entries()) {
    const s = byNumber.get(i + 1);
    if (s === undefined) {
      return { ok: false, error: `segment ${i + 1} not answered` };
    }
    const changes: number[] = [];
    for (const t of s.mixes_topics ? s.topic_changes : []) {
      const at = parseClock(t);
      if (at === null) {
        return {
          ok: false,
          error: `segment ${i + 1}: unparseable topic change ${t}`,
        };
      }
      const onVideo = clipStart + at;
      if (onVideo > span.start + 3 && onVideo < span.end - 3)
        changes.push(onVideo);
    }
    out.push({
      start_seconds: span.start,
      end_seconds: span.end,
      ...checkTags(s, v),
      mixes_topics: s.mixes_topics,
      mixes_topics_note: s.mixes_topics
        ? noteFrom + s.mixes_topics_note.trim()
        : "",
      topic_change_seconds: [...new Set(changes)].sort((x, y) => x - y),
      overview: s.overview,
    });
  }
  return { ok: true, segments: out };
}

function dedupe(
  tags: Array<{ id: string; evidence: string }>,
): Array<{ id: string; evidence: string }> {
  const seen = new Set<string>();
  return tags.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

// ── Clips and fixed boundaries (pure) ──────────────────────────────────────────────────

const chapterSchema = z.object({
  title: z.string(),
  start_seconds: z.number(),
  end_seconds: z.number(),
});
export type Chapter = z.infer<typeof chapterSchema>;
export type Clip = Span & {
  /** The given segments in this clip (fixed mode), on the video's clock; null in cut mode. */
  segments: Array<Span & { title: string }> | null;
};

/**
 * Pure. Chapter-aligned clips (ruling 5). Null when the chapters do not tile the video from 0 to
 * its end (within 3 s), so a malformed chapter list falls back to pass 1's own cuts. A chapter
 * longer than a clip is split at clip-length marks; consecutive chapters are packed into clips of
 * at most CLIP_SECONDS. A video short enough to read whole is one clip holding every chapter.
 */
export function chapterClips(
  chapters: Chapter[],
  duration: number,
  splits: number[] = [],
): Clip[] | null {
  if (chapters.length === 0) return null;
  let cursor = 0;
  for (const c of chapters) {
    if (
      Math.abs(c.start_seconds - cursor) > 3 ||
      c.end_seconds <= c.start_seconds
    )
      return null;
    cursor = c.end_seconds;
  }
  if (Math.abs(cursor - duration) > 3) return null;
  const pieces: Array<Span & { title: string }> = chapters.flatMap((c, i) => {
    const start = i === 0 ? 0 : c.start_seconds;
    const end = i === chapters.length - 1 ? duration : c.end_seconds;
    const out: Array<Span & { title: string }> = [];
    for (let t = start; t < end; t += CLIP_SECONDS) {
      out.push({
        start: t,
        end: Math.min(end, t + CLIP_SECONDS),
        title: c.title,
      });
    }
    return out;
  });
  const split = splitSpans(pieces, splits);
  if (duration <= WHOLE_VIDEO_MAX_SECONDS) {
    return [{ start: 0, end: duration, segments: split }];
  }
  const clips: Clip[] = [];
  for (const p of split) {
    const cur = clips[clips.length - 1];
    if (cur?.segments && p.end - cur.start <= CLIP_SECONDS) {
      cur.end = p.end;
      cur.segments.push(p);
    } else {
      clips.push({ start: p.start, end: p.end, segments: [p] });
    }
  }
  return clips;
}

/** Pure. Pass 2's clips: pass 1's clips with pass 1's segments as the given ones (times only). */
export function clipsFromPass1(
  clips: Span[],
  segments: Array<Span>,
  splits: number[] = [],
): Clip[] {
  return clips.map((c) => ({
    start: c.start,
    end: c.end,
    segments: splitSpans(
      segments
        .filter((s) => s.start >= c.start && s.end <= c.end)
        .map((s) => ({ start: s.start, end: s.end, title: "" })),
      splits,
    ),
  }));
}

/**
 * Pure. The one-topic rule (2026-10-29 rule 2): each span is cut at every split point strictly
 * inside it (more than 3 s from an edge). A split piece of a titled span is titled "<title>, part
 * k of n" so the model still sees the creator's chapter.
 */
export function splitSpans(
  spans: Array<Span & { title: string }>,
  splits: number[],
): Array<Span & { title: string }> {
  const points = [...new Set(splits)].sort((a, b) => a - b);
  return spans.flatMap((sp) => {
    const inside = points.filter((t) => t > sp.start + 3 && t < sp.end - 3);
    if (inside.length === 0) return [sp];
    const edges = [sp.start, ...inside, sp.end];
    const n = edges.length - 1;
    return edges.slice(0, -1).map((start, k) => ({
      start,
      end: edges[k + 1] ?? sp.end,
      title: sp.title === "" ? "" : `${sp.title}, part ${k + 1} of ${n}`,
    }));
  });
}

type VideoRow = {
  video_id: string;
  title: string;
  duration_seconds: number;
  skills: string[];
};

function chaptersByVideo(): Map<string, Chapter[]> {
  const out = new Map<string, Chapter[]>();
  if (!existsSync(METADATA)) return out;
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (typeof o !== "object" || o === null) return;
    const rec = o as Record<string, unknown>;
    if (typeof rec.video_id === "string" && Array.isArray(rec.chapters)) {
      const parsed = z.array(chapterSchema).safeParse(rec.chapters);
      if (parsed.success) out.set(rec.video_id, parsed.data);
    }
    Object.values(rec).forEach(walk);
  };
  walk(JSON.parse(readFileSync(METADATA, "utf8")));
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function approvedVideos(): VideoRow[] {
  const [header, ...rows] = parseCsv(readFileSync(REVIEW_CSV, "utf8"));
  if (!header) throw new Error("review CSV is empty");
  const col = (n: string): number => {
    const i = header.indexOf(n);
    if (i < 0) throw new Error(`review CSV has no ${n} column`);
    return i;
  };
  const [a, id, title, dur, skills] = [
    col("approve"),
    col("video_id"),
    col("title"),
    col("duration_s"),
    col("skills"),
  ];
  return rows
    .filter((r) => r[a]?.trim().toLowerCase() === "yes")
    .map((r) => ({
      video_id: r[id] ?? "",
      title: r[title] ?? "",
      duration_seconds: Number(r[dur]),
      skills: (r[skills] ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
    }));
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

const clipCacheSchema = z.object({
  version: z.literal(SEGMENT_TAG_VERSION),
  model: z.string(),
  mode: z.enum(["cut", "fixed"]),
  /** The given segments' spans, so a cached answer is never reused for other boundaries. */
  given: z.array(z.object({ start: z.number(), end: z.number() })).nullable(),
  answer: z.unknown(),
  usage: usageSchema,
});

const pass1FileSchema = z.object({
  version: z.literal(SEGMENT_TAG_VERSION),
  boundaries: z.enum(["chapters", "pass1_cuts"]),
  clips: z.array(z.object({ start: z.number(), end: z.number() })),
  segments: z.array(
    z.object({ start_seconds: z.number(), end_seconds: z.number() }),
  ),
});

const splitsFileSchema = z.object({
  /** Where the split points come from, e.g. the pass and version whose mixes_topics flags named them. */
  source: z.string().min(1),
  videos: z.record(
    z.object({
      seconds: z.array(z.number().int().nonnegative()),
      /** One line per point: the flag it came from and the conversion to the video's clock. */
      from: z.array(z.string()),
    }),
  ),
});

/** Pass 2's per-clip estimate multiplier over pass 1's measured cost (max observed 1.18). */
const PASS2_OVER_PASS1 = 1.25;

function pass1ClipUsd(
  videoId: string,
  start: number,
  model: string,
): number | null {
  const path = resolve(SEGMENTS_DIR, `${videoId}.pass1.clip-${start}.json`);
  if (!existsSync(path)) return null;
  const c = clipCacheSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  return c.success && c.data.model === model ? c.data.usage.usd : null;
}

function sameSpans(a: Span[] | null, b: Span[] | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.length === b.length &&
    a.every((x, i) => x.start === b[i]?.start && x.end === b[i]?.end)
  );
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pass: { type: "string" },
      only: { type: "string" },
      taxonomy: { type: "string", default: TAXONOMY_DEFAULT },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      "cap-usd": { type: "string", default: "0.8" },
      splits: { type: "string" },
    },
  });
  const pass = Number(values.pass);
  if (pass !== 1 && pass !== 2) throw new Error("--pass must be 1 or 2");
  const cap = Number(values["cap-usd"]);
  const model = values.model;
  assertProxied();
  mkdirSync(SEGMENTS_DIR, { recursive: true });

  const taxonomy = taxonomySchema.parse(
    JSON.parse(readFileSync(values.taxonomy, "utf8")),
  );
  const sectionOf = new Map(
    taxonomy.sub_skills.map((s) => [s.skill_code, s.section]),
  );
  const only =
    values.only === undefined ? null : new Set(values.only.split(","));
  const videos = approvedVideos().filter(
    (v) => only === null || only.has(v.video_id),
  );
  if (only !== null && videos.length !== only.size) {
    throw new Error("an --only id is not an approved row of the review CSV");
  }
  const chapters = chaptersByVideo();
  const splitsByVideo =
    values.splits === undefined
      ? {}
      : splitsFileSchema.parse(JSON.parse(readFileSync(values.splits, "utf8")))
          .videos;
  const price = priceOf(model);
  let spent = 0;

  for (const video of videos) {
    const sections = new Set(video.skills.map((s) => sectionOf.get(s)));
    const section = sections.has("M") ? "M" : "RW";
    const vocab = vocabularyFor(taxonomy, section);
    const vocabText = vocabularyText(vocab, pass === 2);

    // Boundaries (ruling 5): chapters where they exist; otherwise pass 1 cuts and pass 2 reuses.
    // One-topic rule (2026-10-29 rule 2): split points for this video, applied in both passes.
    const splits = splitsByVideo[video.video_id]?.seconds ?? [];
    const byChapter = chapterClips(
      chapters.get(video.video_id) ?? [],
      video.duration_seconds,
      splits,
    );
    let boundaries: "chapters" | "pass1_cuts";
    let clips: Clip[];
    if (byChapter !== null) {
      boundaries = "chapters";
      clips = byChapter;
    } else if (pass === 1) {
      // Cut mode cannot take split points: a split cut-mode video is re-tagged in fixed mode on
      // pass 1's cuts plus the splits (Phase B; segments-phase-a.md §3).
      if (splits.length > 0) {
        throw new Error(
          `${video.video_id}: split points need chapters, or fixed-mode boundaries from an earlier run`,
        );
      }
      boundaries = "pass1_cuts";
      clips = clipsOf(video.duration_seconds).map(([start, end]) => ({
        start,
        end,
        segments: null,
      }));
    } else {
      const p1 = pass1FileSchema.parse(
        JSON.parse(
          readFileSync(
            resolve(SEGMENTS_DIR, `${video.video_id}.pass1.json`),
            "utf8",
          ),
        ),
      );
      boundaries = p1.boundaries;
      clips = clipsFromPass1(
        p1.clips,
        p1.segments.map((x) => ({
          start: x.start_seconds,
          end: x.end_seconds,
        })),
        splits,
      );
    }

    let usage: Usage = ZERO_USAGE;
    const segments: TaggedSegment[] = [];
    for (const clip of clips) {
      const { start, end } = clip;
      const given = clip.segments;
      const mode = given === null ? "cut" : "fixed";
      const system =
        mode === "cut" ? segmentSystem(vocabText) : fixedSystem(vocabText);
      const givenSpans: Span[] | null =
        given === null
          ? null
          : given.map((g) => ({ start: g.start, end: g.end }));
      const clipPath = resolve(
        SEGMENTS_DIR,
        `${video.video_id}.pass${pass}.clip-${start}.json`,
      );
      const cached = existsSync(clipPath)
        ? clipCacheSchema.safeParse(JSON.parse(readFileSync(clipPath, "utf8")))
        : null;
      let answer: unknown;
      if (
        cached?.success &&
        cached.data.model === model &&
        cached.data.mode === mode &&
        sameSpans(cached.data.given, givenSpans)
      ) {
        answer = cached.data.answer;
        usage = addUsage(usage, cached.data.usage);
      } else {
        // Pass 2 estimates from pass 1's measured cost on the same clip (pass 2 has run 0.83-1.18x
        // pass 1 per clip); otherwise from the generic rates.
        const measured =
          pass === 2 ? pass1ClipUsd(video.video_id, start, model) : null;
        const estimate =
          measured !== null
            ? measured * PASS2_OVER_PASS1
            : (((end - start) * VIDEO_TOKENS_PER_SECOND + system.length / 4) *
                price.input +
                OUTPUT_TOKENS_ESTIMATE * price.output) /
              1_000_000;
        if (spent + estimate > cap) {
          throw new Error(
            `stopping before ${video.video_id} ${clock(start)}: $${spent.toFixed(4)} + $${estimate.toFixed(4)} would pass the $${cap} cap`,
          );
        }
        const part =
          start === 0 && end === video.duration_seconds
            ? `You are watching the whole video, ${clock(end)} long.`
            : `You are watching the part from ${clock(start)} to ${clock(end)} of a ${clock(video.duration_seconds)} video; it is ${clock(end - start)} long and your times start at 0:00.`;
        const head = [
          `Video title: ${video.title}`,
          `Library skills: ${video.skills.join("; ")} (the video may teach others too).`,
          part,
        ];
        let clipUsage: Usage = ZERO_USAGE;
        const onUsage = (u: Usage): void => {
          clipUsage = u;
        };
        const step = `segment-tags ${video.video_id} pass${pass} ${clock(start)}`;
        answer =
          given === null
            ? await generateJson({
                step,
                model,
                system,
                video: { videoId: video.video_id, start, end },
                user: head.join("\n"),
                responseSchema: segmentResponseSchema,
                schema: segmentAnswerSchema,
                onUsage,
              })
            : await generateJson({
                step,
                model,
                system,
                video: { videoId: video.video_id, start, end },
                user: [
                  ...head,
                  "Segments to tag (times relative to the part):",
                  ...given.map(
                    (g, i) =>
                      `${i + 1}. ${clock(g.start - start)}-${clock(g.end - start)}` +
                      (g.title === ""
                        ? ""
                        : ` (creator's chapter: ${g.title})`),
                  ),
                ].join("\n"),
                responseSchema: fixedResponseSchema,
                schema: fixedAnswerSchema,
                onUsage,
              });
        writeFileSync(
          clipPath,
          `${JSON.stringify({ version: SEGMENT_TAG_VERSION, model, mode, given: givenSpans, answer, usage: clipUsage }, null, 2)}\n`,
        );
        usage = addUsage(usage, clipUsage);
        spent += clipUsage.usd;
      }
      const checked =
        givenSpans === null
          ? checkClipAnswer(
              segmentAnswerSchema.parse(answer),
              { start, end },
              vocab,
            )
          : checkFixedAnswer(
              fixedAnswerSchema.parse(answer),
              givenSpans,
              vocab,
            );
      if (!checked.ok) {
        throw new Error(`${video.video_id} ${clock(start)}: ${checked.error}`);
      }
      segments.push(...checked.segments);
    }
    writeFileSync(
      resolve(SEGMENTS_DIR, `${video.video_id}.pass${pass}.json`),
      `${JSON.stringify(
        {
          version: SEGMENT_TAG_VERSION,
          taxonomy_version: vocab.version,
          model,
          pass,
          video_id: video.video_id,
          duration_seconds: video.duration_seconds,
          section,
          boundaries,
          splits,
          clips: clips.map((c) => ({ start: c.start, end: c.end })),
          segments,
          usage,
        },
        null,
        2,
      )}\n`,
    );
    const teaching = segments.filter((s) => s.teaches_sat_content).length;
    const rejected = segments.reduce((n, s) => n + s.rejected_ids.length, 0);
    const flagged = segments.filter((s) => s.mixes_topics).length;
    const overviews = segments.filter((s) => s.overview).length;
    process.stdout.write(
      `${video.video_id} pass${pass} (${boundaries}): ${segments.length} segment(s), ${teaching} teaching, ${flagged} flagged mixed, ${overviews} overview; rejected ids ${rejected}; ${usage.prompt} in (${usage.cached} cached) / ${usage.output} out; $${usage.usd.toFixed(4)}\n`,
    );
  }
  process.stdout.write(`new spend this pass: $${spent.toFixed(4)}\n`);
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
