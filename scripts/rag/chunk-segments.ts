/**
 * @spec [owner brief "One watch, two outputs" (Karl, 2026-11-04): Step 0 design
 *       (docs/plans/lisa-video-library/watch-writeup-step0.md §1–§3), the new-sources run, and
 *       the rulings of 2026-11-05 (3: every "how it's explained" field goes through the same
 *       rewrite into our words and drop-only check as the facts; 5: chunk steps approved, total
 *       cap $32 for the round)] | @implemented [2026-11-05]
 *
 * plain English: LISA 1's chunk steps on Karl's APPROVED video segments. Nothing is written to a
 * database: the curriculum_chunks link to a segment and the chunk tag tables (SCL-274, SCL-275)
 * do not exist yet, so the output is files for Karl's cold read.
 * Per approved segment with sub-skills (an overview, mixed or clusters-only segment gets no
 * chunk, Step 0 §1):
 *  1. FACTS. The pass-1 write-up's facts are rendered as one unit in the markdown shape book.ts
 *     reads (`renderUnit`), so book.ts's rule applies unchanged: short stays whole, long
 *     (SHORT_RULE_WORDS or more, with worked examples) is cut at each example after the first,
 *     and each piece carries the method as its opening (`ruleOpening`). Each piece runs
 *     chunk-unit.ts `rewriteAuditCheck` (the book's own loop): VIDEO_REWRITE_SYSTEM, then
 *     VIDEO_AUDIT_SYSTEM watching the segment, one repair, then the example check. A kept
 *     entry's skills must be skills of the segment's agreed sub-skills; any other drops it.
 *  2. DELIVERY (how the instructor explains). The same function: DELIVERY_REWRITE_SYSTEM into
 *     Lyceon's words, then DELIVERY_AUDIT_SYSTEM watching the segment (drops a note that adds
 *     anything or keeps the instructor's wording), one repair. No example check: the notes give
 *     no example to describe.
 * Spend: every call reserves an estimate before it starts; a call that would pass --cap-usd is
 * not made, and the run reports what it did not reach. Answers are cached by
 * VIDEO_PROMPT_VERSION, so a re-run repays nothing.
 *
 * Output: scripts/rag/.cache/segment-chunks/<version>/ (calls, gitignored) and, with --out,
 * <out>.csv (book.ts review CSV), <out>-chunks.jsonl (every kept chunk in full),
 * <out>-delivery.jsonl (kept delivery notes), <out>-drops.jsonl. Our words only: no transcript
 * exists, and no instructor wording survives the audit.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/chunk-segments.ts \
 *          --review docs/plans/lisa-video-library/segments-gaps-2026-11-04-review.csv \
 *          --writeups docs/plans/lisa-video-library/writeups-2026-11-04.jsonl \
 *          --out docs/plans/lisa-video-library/segment-chunks-2026-11-05 --cap-usd 7
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { parseCsv } from "../reference-data/import-reference-data";
import {
  type BookChunk,
  longRulesWhole,
  ruleOpening,
  sha256,
  splitLongRules,
  toReviewCsv,
  wordCount,
} from "./book";
import {
  DELIVERY_AUDIT_SYSTEM,
  DELIVERY_REWRITE_SYSTEM,
  VIDEO_AUDIT_SYSTEM,
  VIDEO_PROMPT_VERSION,
  VIDEO_REWRITE_SYSTEM,
  VIDEO_SOURCE_POINTER,
  deliveryRewriteResponseSchema,
  deliveryRewriteSchema,
  deliveryText,
  rewriteResponseSchema,
  rewriteRuleOpening,
  rewriteSchemaFor,
} from "./book-prompts";
import { type UnitCall, rewriteAuditCheck } from "./chunk-unit";
import { CACHE_DIR } from "./fetch-transcripts";
import { pool } from "./generate-descriptions";
import { type Writeup, taxonomySchema, writeupSchema } from "./segment-videos";
import { loadTaxonomy } from "./tag-videos";
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

const TAXONOMY = resolve("content/canonical/subskill-cluster-taxonomy.json");
const VIDEO_TAGS = resolve(
  "docs/plans/lisa-video-library/video-tags-review.csv",
);
/** Measured on the pilot's audits (2026-11-04): prompt tokens per second of video watched. */
const VIDEO_TOKENS_PER_SECOND = 110;
/** Above the largest pilot output (3,311 tokens, thinking included). */
const OUTPUT_TOKENS_ESTIMATE = 4_000;

// ── Pure helpers ────────────────────────────────────────────────────────────────────────

/**
 * Pure. The write-up's facts as one unit in the shape book.ts reads: the "## " line opens the
 * rule, each worked example is a "### " subsection, so the book's short-whole / long-split rule
 * and ruleOpening apply unchanged. `delivery` is not part of it: it is a separate output.
 */
export function renderUnit(w: Writeup): string {
  const list = (xs: string[]): string => xs.map((x) => `- ${x}`).join("\n");
  const lines = [
    `## ${w.what_is_taught}`,
    "",
    `Method: ${w.method}`,
    "",
    "Steps:",
    w.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
  ];
  if (w.look_at.length > 0) lines.push("", "What to look at:", list(w.look_at));
  if (w.pitfalls.length > 0)
    lines.push("", "Pitfalls the instructor names:", list(w.pitfalls));
  w.examples.forEach((e, i) => {
    lines.push(
      "",
      `### Example ${i + 1}`,
      "",
      e.setup,
      e.steps.map((s, k) => `${k + 1}. ${s}`).join("\n"),
    );
  });
  return `${lines.join("\n")}\n`;
}

/** Pure. The unit cut by book.ts's rule: [start, end) pieces, each with its rule opening. */
export function unitPieces(
  text: string,
): Array<{ text: string; opening: string | null }> {
  const whole = [
    { start: 0, end: text.length, section_title: "", ends_in_window: true },
  ];
  const { units } = splitLongRules(text, whole, 0, text.length);
  if (longRulesWhole(text, units, 0, text.length).length > 0)
    throw new Error("a long unit was left whole after splitLongRules");
  return units.map((u) => ({
    text: text.slice(u.start, u.end),
    opening: ruleOpening(text, u.start, u.end),
  }));
}

/** Pure. Doc 03D §6.5 / SCL-231 provenance, with .<n> for the pieces of a split segment. */
export function segmentProvenance(
  videoId: string,
  start: number,
  end: number,
  piece: number,
  pieces: number,
): string {
  const base = `youtube:${videoId}:${start}-${end}`;
  return pieces > 1 ? `${base}.${piece + 1}` : base;
}

/** Pure. A kept entry's skills must be skills of the segment's agreed sub-skills. */
export function skillsWithin(
  entrySkills: readonly string[],
  segmentSkills: ReadonlySet<string>,
): { ok: true } | { ok: false; outside: string[] } {
  const outside = entrySkills.filter((s) => !segmentSkills.has(s));
  return outside.length === 0 && entrySkills.length > 0
    ? { ok: true }
    : { ok: false, outside };
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

// ── Inputs ──────────────────────────────────────────────────────────────────────────────

const writeupLineSchema = z.object({
  video_id: z.string(),
  start_s: z.number(),
  end_s: z.number(),
  writeup: writeupSchema,
});

type Segment = {
  video_id: string;
  start: number;
  end: number;
  sub_skills: string[];
  summary: string;
};

function readCsvRows(path: string): Array<Record<string, string>> {
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8")).filter(
    (r) => !(r.length === 1 && r[0] === ""),
  );
  if (header === undefined) throw new Error(`${path} is empty`);
  return rows.map((r) =>
    Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])),
  );
}

class CapStop extends Error {}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      review: { type: "string" },
      writeups: { type: "string" },
      out: { type: "string" },
      "cap-usd": { type: "string" },
      only: { type: "string" },
      // Sub-skill ids whose segments run first, in this order, so a run the cap stops covers
      // the named gaps before the rest (content-gaps-step0.md §3).
      first: { type: "string" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      concurrency: { type: "string", default: "4" },
    },
  });
  if (values.review === undefined || values.writeups === undefined)
    throw new Error("--review and --writeups are required");
  const cap = z.coerce.number().positive().parse(values["cap-usd"]);
  const model = z.string().min(1).parse(values.model);
  const only =
    values.only === undefined ? null : new Set(values.only.split(","));
  assertProxied();

  const taxonomy = taxonomySchema.parse(
    JSON.parse(readFileSync(TAXONOMY, "utf8")),
  );
  const skillOf = new Map(taxonomy.sub_skills.map((s) => [s.id, s.skill_code]));
  const titleOf = new Map(
    readCsvRows(VIDEO_TAGS).map((r) => [r.video_id ?? "", r.title ?? ""]),
  );
  const writeupOf = new Map<string, Writeup>();
  for (const line of readFileSync(values.writeups, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const w = writeupLineSchema.parse(JSON.parse(line));
    writeupOf.set(`${w.video_id}:${w.start_s}`, w.writeup);
  }

  // Every row of the reviewed file, for neighbouring summaries; the approved focused ones to run.
  const all: Segment[] = readCsvRows(values.review)
    .map((r) => ({
      video_id: r.video_id ?? "",
      start: Number(r.start_s),
      end: Number(r.end_s),
      sub_skills: (r.sub_skills ?? "")
        .split(";")
        .map((s) => s.trim())
        .filter((s) => s !== ""),
      summary: r.summary ?? "",
    }))
    .sort((a, b) =>
      a.video_id === b.video_id
        ? a.start - b.start
        : a.video_id < b.video_id
          ? -1
          : 1,
    );
  const approvedRows = readCsvRows(values.review).filter(
    (r) => (r.approve ?? "").trim().toLowerCase() === "yes",
  );
  const approvedKeys = new Set(
    approvedRows.map((r) => `${r.video_id}:${r.start_s}`),
  );
  const targets = all.filter(
    (s) =>
      approvedKeys.has(`${s.video_id}:${s.start}`) &&
      s.sub_skills.length > 0 &&
      (only === null || only.has(s.video_id)),
  );
  const first = (values.first ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");
  const rank = (s: Segment): number => {
    const ranks = s.sub_skills
      .map((id) => first.indexOf(id))
      .filter((i) => i >= 0);
    return ranks.length === 0 ? first.length : Math.min(...ranks);
  };
  // A stable sort: the named gaps first, then the file's order.
  targets.sort((a, b) => rank(a) - rank(b));
  const neighbours = (s: Segment): { before: string; after: string } => {
    const same = all.filter((x) => x.video_id === s.video_id);
    const i = same.findIndex((x) => x.start === s.start);
    return {
      before: same[i - 1]?.summary ?? "(none: this is the start of the video)",
      after: same[i + 1]?.summary ?? "(none: this is the end of the video)",
    };
  };

  // ── Calls: cached by VIDEO_PROMPT_VERSION, every one reserved against the cap ──
  const dir = resolve(CACHE_DIR, "segment-chunks", VIDEO_PROMPT_VERSION);
  mkdirSync(resolve(dir, "calls"), { recursive: true });
  const price = priceOf(model);
  let spent = 0;
  let reserved = 0;
  let billed: Usage = ZERO_USAGE;
  const byStage = new Map<string, Usage>();
  const call: UnitCall = async (a) => {
    const path = resolve(
      dir,
      "calls",
      `${sha256(`${VIDEO_PROMPT_VERSION}\u0000${a.key}`)}.json`,
    );
    if (existsSync(path)) {
      const raw = z
        .object({ value: z.unknown(), usage: usageSchema })
        .parse(JSON.parse(readFileSync(path, "utf8")));
      byStage.set(
        a.stage,
        addUsage(byStage.get(a.stage) ?? ZERO_USAGE, raw.usage),
      );
      return a.schema.parse(raw.value);
    }
    const seconds = a.video === undefined ? 0 : a.video.end - a.video.start;
    const estimate =
      ((seconds * VIDEO_TOKENS_PER_SECOND +
        (a.system.length + a.user.length) / 4) *
        price.input +
        OUTPUT_TOKENS_ESTIMATE * price.output) /
      1_000_000;
    if (spent + reserved + estimate > cap) {
      throw new CapStop(
        `$${spent.toFixed(4)} spent + $${reserved.toFixed(4)} in flight + $${estimate.toFixed(4)} would pass the $${cap} cap`,
      );
    }
    reserved += estimate;
    let usage: Usage = ZERO_USAGE;
    try {
      const value = await generateJson({
        step: a.step,
        model,
        system: a.system,
        user: a.user,
        responseSchema: a.responseSchema,
        schema: a.schema,
        ...(a.video === undefined ? {} : { video: a.video }),
        onUsage: (u) => {
          usage = addUsage(usage, u);
        },
      });
      writeFileSync(path, JSON.stringify({ value, usage }));
      return value;
    } finally {
      reserved -= estimate;
      spent += usage.usd;
      billed = addUsage(billed, usage);
      byStage.set(a.stage, addUsage(byStage.get(a.stage) ?? ZERO_USAGE, usage));
    }
  };

  const { skills } = loadTaxonomy();
  const rewriteSchema = rewriteSchemaFor(skills);
  type Kept = BookChunk & {
    video_id: string;
    start_s: number;
    end_s: number;
    sub_skills: string[];
    surface_gate_reason: string;
    repaired: boolean;
    words: number;
  };
  const kept: Kept[] = [];
  const delivery: unknown[] = [];
  const drops: unknown[] = [];
  const unreached: string[] = [];

  await pool(
    targets,
    Math.max(1, Number(values.concurrency)),
    async (s): Promise<void> => {
      const key = `${s.video_id}:${s.start}`;
      try {
        const w = writeupOf.get(key);
        if (w === undefined) {
          drops.push({ segment: key, part: "facts", reason: "no_writeup" });
          return;
        }
        const clip = { videoId: s.video_id, start: s.start, end: s.end };
        const { before, after } = neighbours(s);
        const head = `SEGMENT: ${titleOf.get(s.video_id) ?? s.video_id}, ${clock(s.start)}-${clock(s.end)}`;
        const segSkills = new Set(
          s.sub_skills
            .map((id) => skillOf.get(id))
            .filter((x): x is string => x !== undefined),
        );

        // 1. The facts.
        const pieces = unitPieces(renderUnit(w));
        for (const [i, p] of pieces.entries()) {
          const out = await rewriteAuditCheck({
            model,
            call,
            rewrite: {
              system: VIDEO_REWRITE_SYSTEM,
              user: `${head}\n\nCONTEXT BEFORE (reference only):\n${before}\n\n${rewriteRuleOpening(p.opening)}UNIT:\n${p.text}\n\nCONTEXT AFTER (reference only):\n${after}`,
              responseSchema: rewriteResponseSchema(skills),
              schema: rewriteSchema,
              contentOf: (rw) => rw.content,
              skillsOf: (rw) => rw.skill_codes,
              detailOf: (rw) => rw.taxonomy_gap ?? "",
            },
            audit: {
              system: VIDEO_AUDIT_SYSTEM,
              source: VIDEO_SOURCE_POINTER,
              before,
              after,
              ruleOpening: p.opening,
              video: clip,
            },
            exampleCheck: true,
          });
          const provenance = segmentProvenance(
            s.video_id,
            s.start,
            s.end,
            i,
            pieces.length,
          );
          if (!out.kept) {
            drops.push({
              segment: key,
              part: "facts",
              piece: i + 1,
              reason: out.reason,
              detail: out.detail,
            });
            continue;
          }
          const within = skillsWithin(out.skill_codes, segSkills);
          if (!within.ok) {
            drops.push({
              segment: key,
              part: "facts",
              piece: i + 1,
              reason: "skill_outside_segment",
              detail: `entry ${out.skill_codes.join("; ")}; segment ${[...segSkills].join("; ")}`,
            });
            continue;
          }
          kept.push({
            provenance,
            content: out.content,
            skill_codes: out.skill_codes,
            content_type: out.rewrite.content_type,
            surface_gate: out.rewrite.surface_gate,
            surface_gate_reason: out.rewrite.surface_gate_reason,
            video_id: s.video_id,
            start_s: s.start,
            end_s: s.end,
            sub_skills: s.sub_skills,
            repaired: out.repaired,
            words: wordCount(out.content),
          });
        }

        // 2. How the instructor explains: the same rewrite and drop-only audit.
        const notes = deliveryText(w.delivery);
        if (notes === null) return;
        const d = await rewriteAuditCheck({
          model,
          call,
          rewrite: {
            system: DELIVERY_REWRITE_SYSTEM,
            user: `${head}\n\nNOTES:\n${notes}`,
            responseSchema: deliveryRewriteResponseSchema,
            schema: deliveryRewriteSchema,
            contentOf: (rw) => deliveryText(rw),
            skillsOf: () => null,
            detailOf: () => "",
          },
          audit: {
            system: DELIVERY_AUDIT_SYSTEM,
            source: VIDEO_SOURCE_POINTER,
            before,
            after,
            ruleOpening: null,
            video: clip,
          },
          exampleCheck: false,
        });
        if (!d.kept) {
          drops.push({
            segment: key,
            part: "delivery",
            reason: d.reason,
            detail: d.detail,
          });
          return;
        }
        delivery.push({
          provenance: segmentProvenance(s.video_id, s.start, s.end, 0, 1),
          video_id: s.video_id,
          start_s: s.start,
          end_s: s.end,
          sub_skills: s.sub_skills,
          repaired: d.repaired,
          step_order: d.rewrite.step_order,
          click_phrases: d.rewrite.click_phrases,
          analogies: d.rewrite.analogies,
          understanding_checks: d.rewrite.understanding_checks,
        });
      } catch (err: unknown) {
        if (err instanceof CapStop) {
          unreached.push(`${key} (${err.message})`);
          return;
        }
        throw err;
      }
    },
  );

  const order = (
    a: { provenance: string },
    b: { provenance: string },
  ): number =>
    a.provenance < b.provenance ? -1 : a.provenance > b.provenance ? 1 : 0;
  kept.sort(order);
  const stages = [...byStage.entries()]
    .map(
      ([k, u]) =>
        `  ${k}: ${u.calls} calls, ${u.output} out (${u.thoughts} thinking), $${u.usd.toFixed(3)}`,
    )
    .join("\n");
  const keptDelivery = delivery.length;
  if (values.out !== undefined) {
    writeFileSync(`${values.out}.csv`, toReviewCsv(kept));
    writeFileSync(
      `${values.out}-chunks.jsonl`,
      kept.map((k) => JSON.stringify(k)).join("\n") + "\n",
    );
    writeFileSync(
      `${values.out}-delivery.jsonl`,
      delivery
        .map((d) => JSON.stringify(d))
        .sort()
        .join("\n") + "\n",
    );
    writeFileSync(
      `${values.out}-drops.jsonl`,
      drops
        .map((d) => JSON.stringify(d))
        .sort()
        .join("\n") + "\n",
    );
  }
  process.stdout.write(
    [
      `prompt version ${VIDEO_PROMPT_VERSION}; ${targets.length} approved focused segments`,
      `facts: ${kept.length} chunks kept (${kept.filter((k) => k.repaired).length} after one repair); delivery: ${keptDelivery} kept`,
      `drops: ${drops.length}`,
      `unreached (cap): ${unreached.length}${unreached.length > 0 ? `\n  ${unreached.join("\n  ")}` : ""}`,
      `billed this run: ${billed.calls} calls, $${billed.usd.toFixed(4)} (cap $${cap})`,
      stages,
    ].join("\n") + "\n",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
