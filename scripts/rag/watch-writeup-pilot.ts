/**
 * @spec [owner brief "One watch, two outputs" (Karl, 2026-11-04), Step 0: design and a
 *       two-segment pilot, cap $2; docs/plans/lisa-video-library/watch-writeup-step0.md]
 *       | @implemented [2026-11-04]
 *
 * plain English: a PILOT, not the pipeline. It measures what the design in
 * watch-writeup-step0.md would cost and produce, on two segments, before anything is built:
 *  1. Pass 1 with the write-up: the Phase B pass-1 prompt (segment-videos.ts `segmentSystem`,
 *     the same vocabulary, the same head lines), plus one WRITE-UP block and a `writeup` field per
 *     segment. Run on Lesson #10 (`a1QNaRnn6cE`, whose plain pass-1 answer is cached with its
 *     usage) and on Brain Buffs "Operations with Rational Expressions" (`aDhs2BXFQUk`), with
 *     the plain prompt too, so the added output is measured on the same video.
 *  2. Backfill: the write-up alone for an approved segment's span (Lesson #10, 2:39-4:17).
 *  3. Each write-up through LISA 1's chunk steps, imported from the real modules:
 *     book.ts `longRulesWhole` / `splitLongRules` / `ruleOpening` (short kept whole, long
 *     split, a cut piece carries its opening); book-prompts.ts REWRITE_SYSTEM and AUDIT_SYSTEM
 *     with their schemas, `auditFailure`, `auditUserMessage`, `rewriteRuleOpening`; and the
 *     narrowed EXAMPLE_CHECK_SYSTEM with `exampleCheckFailure` (a contradiction drops the
 *     chunk). The rewrite and audit prompts get a video-source wording through
 *     `videoSourced` below, by exact, asserted substitution; the build moves that into
 *     book-prompts.ts with the book text pinned byte-identical. The audit WATCHES the segment:
 *     the source is the video, not the write-up.
 *  The one-repair loop mirrors ingest-book.ts lines 548-660 (the build extracts it so both
 *  call one function; it is mirrored here only because this is a pilot).
 *
 * Writes nothing to any database. Output under scripts/rag/.cache/watch-writeup-pilot/
 * (gitignored). Prints ids, counts and cost only.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/watch-writeup-pilot.ts [--cap-usd 2]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { longRulesWhole, ruleOpening, splitLongRules, wordCount } from "./book";
import {
  AUDIT_SYSTEM,
  EXAMPLE_CHECK_SYSTEM,
  REWRITE_SYSTEM,
  auditFailure,
  auditResponseSchema,
  auditSchema,
  auditUserMessage,
  exampleCheckFailure,
  exampleCheckResponseSchema,
  exampleCheckSchema,
  exampleCheckUserMessage,
  rewriteResponseSchema,
  rewriteRuleOpening,
  rewriteSchemaFor,
} from "./book-prompts";
import {
  SEGMENTS_DIR,
  segmentAnswerSchema,
  segmentResponseSchema,
  segmentSystem,
  taxonomySchema,
  vocabularyFor,
  vocabularyText,
} from "./segment-videos";
import { loadTaxonomy } from "./tag-videos";
import {
  GENERATION_MODEL_DEFAULT,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  generateJson,
  usageSchema,
  type Usage,
  type VideoClip,
} from "./vertex";

const OUT = resolve("scripts/rag/.cache/watch-writeup-pilot");
const TAXONOMY = resolve("content/canonical/subskill-cluster-taxonomy.json");
/** The same set ingest-book.ts repairs once (its REPAIRABLE). */
const REPAIRABLE: ReadonlySet<string> = new Set([
  "audit_act_generalised",
  "audit_unfaithful",
  "audit_incorrect",
  "audit_not_self_contained",
]);

// ── The write-up: what pass 1 adds ──────────────────────────────────────────────────────

export const WRITEUP_RULES = `WRITE-UP. For each teaching segment, also write what a student learns from it, for a tutor's notes. Write in your own words. Never quote the speaker or follow their wording closely, and never copy on-screen text, except the mathematics itself (expressions, equations, numbers, what is typed into a calculator), which you give exactly as shown.
- what_is_taught: one sentence: the kind of question and the idea that solves it.
- method: the method, in one or two sentences.
- steps: the method's steps in order, as the segment carries them out, each a short instruction.
- look_at: what the student should look at or check while doing it (in the question, on the graph or calculator, in the result), as the segment shows it.
- pitfalls: mistakes or traps the instructor names. Only those the segment names; never add your own. [] when it names none.
- examples: each worked example: setup (the problem, its mathematics exactly as shown) and steps (as the segment works it).
For a segment where teaches_sat_content is false, every field is "" or [].`;

const writeupSchema = z.object({
  what_is_taught: z.string(),
  method: z.string(),
  steps: z.array(z.string()),
  look_at: z.array(z.string()),
  pitfalls: z.array(z.string()),
  examples: z.array(
    z.object({ setup: z.string(), steps: z.array(z.string()) }),
  ),
});
type Writeup = z.infer<typeof writeupSchema>;
const writeupResponse = {
  type: "OBJECT",
  properties: {
    what_is_taught: { type: "STRING" },
    method: { type: "STRING" },
    steps: { type: "ARRAY", items: { type: "STRING" } },
    look_at: { type: "ARRAY", items: { type: "STRING" } },
    pitfalls: { type: "ARRAY", items: { type: "STRING" } },
    examples: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          setup: { type: "STRING" },
          steps: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["setup", "steps"],
      },
    },
  },
  required: [
    "what_is_taught",
    "method",
    "steps",
    "look_at",
    "pitfalls",
    "examples",
  ],
} as const;

const pass1WriteupSchema = z.object({
  segments: z.array(
    segmentAnswerSchema.shape.segments.element.extend({
      writeup: writeupSchema,
    }),
  ),
});
type Pass1Writeup = z.infer<typeof pass1WriteupSchema>;
function pass1WriteupResponse(): Record<string, unknown> {
  const seg = segmentResponseSchema.properties.segments.items;
  return {
    type: "OBJECT",
    properties: {
      segments: {
        type: "ARRAY",
        items: {
          ...seg,
          properties: { ...seg.properties, writeup: writeupResponse },
          required: [...seg.required, "writeup"],
        },
      },
    },
    required: ["segments"],
  };
}

const BACKFILL_SYSTEM = `You watch one segment of an SAT preparation video and write what a student learns from it, for a tutor's notes. Watch it, using what is shown and typed on screen as well as what is said.

teaches_sat_content is false for intros, sign-offs, promotion and general advice.

${WRITEUP_RULES.replace("For each teaching segment, also write", "Write")}`;
const backfillSchema = z.object({
  teaches_sat_content: z.boolean(),
  writeup: writeupSchema,
});
const backfillResponse = {
  type: "OBJECT",
  properties: {
    teaches_sat_content: { type: "BOOLEAN" },
    writeup: writeupResponse,
  },
  required: ["teaches_sat_content", "writeup"],
} as const;

/**
 * Pure. The write-up as one unit in the shape book.ts reads: the "## " line opens the rule,
 * each worked example after it is a "### " subsection, so the book's short-whole / long-split
 * rule and its ruleOpening apply unchanged.
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

// ── LISA 1's prompts, worded for a video source ─────────────────────────────────────────

function swap(text: string, from: string, to: string): string {
  if (text.split(from).length !== 2)
    throw new Error(
      `video wording: anchor not found once: ${from.slice(0, 60)}`,
    );
  return text.replace(from, to);
}
export const videoSourced = {
  rewrite: swap(
    swap(
      REWRITE_SYSTEM,
      "You turn one unit of an SAT preparation book into one entry",
      "You turn one unit, a written account of one segment of an SAT preparation video, into one entry",
    ),
    `"turn to page", "the author".`,
    `"turn to page", "the author", "the instructor", "in this video", "this lesson".`,
  ),
  audit: swap(
    swap(
      AUDIT_SYSTEM,
      "against the book passage it was written from.",
      "against the video segment it was written from.",
    ),
    "You are given the SOURCE (the passage the entry was written from), the CONTEXT BEFORE and CONTEXT AFTER (the book text around the source), and the ENTRY.",
    "You are given the SOURCE (the video segment you are watching: what is said and what is shown and typed on screen; the SOURCE line of the message only points to it), the CONTEXT BEFORE and CONTEXT AFTER (one-line summaries of the video's segments around the source), and the ENTRY.",
  ),
};

// ── The run ─────────────────────────────────────────────────────────────────────────────

type Target = {
  videoId: string;
  title: string;
  skills: string[];
  duration: number;
};
const LESSON10: Target = {
  videoId: "a1QNaRnn6cE",
  title:
    "Digital SAT Math - Desmos Lesson #10 Equivalent Expressions: Guess & Check by Graphing",
  skills: ["Equivalent Expressions"],
  duration: 398,
};
const BRAIN_BUFFS: Target = {
  videoId: "aDhs2BXFQUk",
  title: "SAT Math: Operations with Rational Expressions",
  skills: ["Equivalent Expressions"],
  duration: 198,
};

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function seconds(c: string): number {
  const [m, s] = c.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}
function head(t: Target): string[] {
  // The same head lines segment-videos.ts sends for a whole video.
  return [
    `Video title: ${t.title}`,
    `Library skills: ${t.skills.join("; ")} (the video may teach others too).`,
    `You are watching the whole video, ${clock(t.duration)} long.`,
  ];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { "cap-usd": { type: "string", default: "2" } },
  });
  const cap = Number(values["cap-usd"]);
  assertProxied();
  mkdirSync(OUT, { recursive: true });
  const model = GENERATION_MODEL_DEFAULT;
  let spent = 0;
  const byStage = new Map<string, Usage>();

  async function call<T>(
    key: string,
    stage: string,
    run: (onUsage: (u: Usage) => void) => Promise<T>,
    schema: z.ZodType<T>,
  ): Promise<{ value: T; usage: Usage }> {
    const path = resolve(OUT, `${key}.json`);
    if (existsSync(path)) {
      const raw = z
        .object({ value: z.unknown(), usage: usageSchema })
        .parse(JSON.parse(readFileSync(path, "utf8")));
      const value = schema.parse(raw.value);
      byStage.set(stage, addUsage(byStage.get(stage) ?? ZERO_USAGE, raw.usage));
      spent += raw.usage.usd;
      return { value, usage: raw.usage };
    }
    if (spent > cap)
      throw new Error(`cap $${cap} reached at $${spent.toFixed(3)}`);
    let usage: Usage = ZERO_USAGE;
    const value = await run((u) => {
      usage = addUsage(usage, u);
    });
    spent += usage.usd;
    byStage.set(stage, addUsage(byStage.get(stage) ?? ZERO_USAGE, usage));
    writeFileSync(path, JSON.stringify({ value, usage }, null, 2));
    process.stdout.write(
      `${stage} ${key}: ${usage.prompt} in, ${usage.output} out (${usage.thoughts} thinking), $${usage.usd.toFixed(4)}; total $${spent.toFixed(3)}\n`,
    );
    return { value, usage };
  }

  const taxonomy = taxonomySchema.parse(
    JSON.parse(readFileSync(TAXONOMY, "utf8")),
  );
  const vocab = vocabularyText(vocabularyFor(taxonomy, "M"), false);
  const plainSystem = segmentSystem(vocab);
  const writeupSystem = `${plainSystem}\n\n${WRITEUP_RULES}`;
  const whole = (t: Target): VideoClip => ({
    videoId: t.videoId,
    start: 0,
    end: t.duration,
  });

  // 1. Pass 1, plain and with the write-up, on the same whole video.
  const measured: Record<string, { plain: Usage; writeup: Usage }> = {};
  const pass1: Record<string, Pass1Writeup> = {};
  for (const t of [LESSON10, BRAIN_BUFFS]) {
    let plain: Usage;
    const cachedPlain = resolve(SEGMENTS_DIR, `${t.videoId}.pass1.clip-0.json`);
    if (t === LESSON10 && existsSync(cachedPlain)) {
      // Phase B's own pass-1 call on this video, same prompt version, with its usage.
      plain = usageSchema.parse(
        z
          .object({ usage: z.unknown() })
          .parse(JSON.parse(readFileSync(cachedPlain, "utf8"))).usage,
      );
    } else {
      plain = (
        await call(
          `${t.videoId}.pass1-plain`,
          "pass 1 plain",
          (onUsage) =>
            generateJson({
              step: `pilot pass1 plain ${t.videoId}`,
              model,
              system: plainSystem,
              video: whole(t),
              user: head(t).join("\n"),
              responseSchema: segmentResponseSchema,
              schema: segmentAnswerSchema,
              onUsage,
            }),
          segmentAnswerSchema,
        )
      ).usage;
    }
    const w = await call(
      `${t.videoId}.pass1-writeup`,
      "pass 1 + write-up",
      (onUsage) =>
        generateJson({
          step: `pilot pass1 writeup ${t.videoId}`,
          model,
          system: writeupSystem,
          video: whole(t),
          user: head(t).join("\n"),
          responseSchema: pass1WriteupResponse(),
          schema: pass1WriteupSchema,
          onUsage,
        }),
      pass1WriteupSchema,
    );
    measured[t.videoId] = { plain, writeup: w.usage };
    pass1[t.videoId] = w.value;
  }

  // 2. Backfill: the write-up alone, for Lesson #10's approved segment 2:39-4:17.
  const backfill = await call(
    `${LESSON10.videoId}.backfill-159-257`,
    "backfill write-up",
    (onUsage) =>
      generateJson({
        step: "pilot backfill a1QNaRnn6cE 159",
        model,
        system: BACKFILL_SYSTEM,
        video: { videoId: LESSON10.videoId, start: 159, end: 257 },
        user: `Video title: ${LESSON10.title}\nYou are watching the part from 2:39 to 4:17 of a 6:38 video; it is 1:38 long.`,
        responseSchema: backfillResponse,
        schema: backfillSchema,
        onUsage,
      }),
    backfillSchema,
  );

  // 3. Each pilot write-up through LISA 1's chunk steps.
  type Unit = {
    label: string;
    clip: VideoClip;
    title: string;
    writeup: Writeup;
    before: string;
    after: string;
  };
  const units: Unit[] = [];
  const l10segs = pass1[LESSON10.videoId]?.segments ?? [];
  const l10 = l10segs.findIndex((s) => s.start === "2:39" && s.end === "4:17");
  units.push({
    label: "lesson10-backfill",
    clip: { videoId: LESSON10.videoId, start: 159, end: 257 },
    title: LESSON10.title,
    writeup: backfill.value.writeup,
    before:
      "Solve a polynomial factoring question by graphing the expression and choices in Desmos to find the overlapping graph.",
    after:
      "Subtract rational expressions by graphing the original expression and the choices in Desmos to find the match.",
  });
  const bbSegs = pass1[BRAIN_BUFFS.videoId]?.segments ?? [];
  bbSegs.forEach((s, i) => {
    if (!s.teaches_sat_content) return;
    units.push({
      label: `brainbuffs-${s.start}`,
      clip: {
        videoId: BRAIN_BUFFS.videoId,
        start: seconds(s.start),
        end: seconds(s.end),
      },
      title: BRAIN_BUFFS.title,
      writeup: s.writeup,
      before:
        bbSegs[i - 1]?.summary ?? "(none: this is the start of the video)",
      after: bbSegs[i + 1]?.summary ?? "(none: this is the end of the video)",
    });
  });

  const { skills } = loadTaxonomy();
  const rewriteSchema = rewriteSchemaFor(skills);
  const results: unknown[] = [];
  for (const u of units) {
    const text = renderUnit(u.writeup);
    const whole0 = [
      { start: 0, end: text.length, section_title: "", ends_in_window: true },
    ];
    const longWhole = longRulesWhole(text, whole0, 0, text.length);
    const { units: pieces, cuts } = splitLongRules(
      text,
      whole0,
      0,
      text.length,
    );
    for (const [pi, p] of pieces.entries()) {
      const source = text.slice(p.start, p.end);
      const opening = ruleOpening(text, p.start, p.end);
      const rewriteUser = `SEGMENT: ${u.title}, ${clock(u.clip.start)}-${clock(u.clip.end)}\n\nCONTEXT BEFORE (reference only):\n${u.before}\n\n${rewriteRuleOpening(opening)}UNIT:\n${source}\n\nCONTEXT AFTER (reference only):\n${u.after}`;
      let feedback = "";
      let outcome: Record<string, unknown>;
      for (let attempt = 0; ; attempt += 1) {
        const user = rewriteUser + feedback;
        const rw = (
          await call(
            `${u.label}.p${pi}.rewrite${attempt}`,
            attempt === 0 ? "rewrite" : "rewrite (repair)",
            (onUsage) =>
              generateJson({
                step: "pilot rewrite",
                model,
                system: videoSourced.rewrite,
                user,
                responseSchema: rewriteResponseSchema(skills),
                schema: rewriteSchema,
                onUsage,
              }),
            rewriteSchema,
          )
        ).value;
        const content = (rw.content ?? "").trim();
        if (!rw.keep || content === "") {
          outcome = { dropped: rw.drop_reason ?? "empty_rewrite" };
          break;
        }
        const auditUser = auditUserMessage({
          source: "(the video segment you are watching)",
          before: u.before,
          after: u.after,
          entry: content,
          ruleOpening: opening,
        });
        const audit = (
          await call(
            `${u.label}.p${pi}.audit${attempt}`,
            attempt === 0 ? "audit (watches the segment)" : "audit (repair)",
            (onUsage) =>
              generateJson({
                step: "pilot audit",
                model,
                system: videoSourced.audit,
                video: u.clip,
                user: auditUser,
                responseSchema: auditResponseSchema,
                schema: auditSchema,
                onUsage,
              }),
            auditSchema,
          )
        ).value;
        const failed = auditFailure(audit);
        if (failed !== null) {
          if (attempt === 0 && REPAIRABLE.has(failed)) {
            feedback = `\n\nA REVIEWER REJECTED YOUR PREVIOUS ENTRY FOR THIS UNIT: ${audit.issues}\nPREVIOUS ENTRY:\n${content}\n\nWrite the entry again, fixing exactly that, and include nothing the unit does not say.`;
            continue;
          }
          outcome = { dropped: failed, issues: audit.issues, content };
          break;
        }
        const check = (
          await call(
            `${u.label}.p${pi}.example-check`,
            "example check",
            (onUsage) =>
              generateJson({
                step: "pilot example check",
                model,
                system: EXAMPLE_CHECK_SYSTEM,
                user: exampleCheckUserMessage(content),
                responseSchema: exampleCheckResponseSchema,
                schema: exampleCheckSchema,
                onUsage,
              }),
            exampleCheckSchema,
          )
        ).value;
        const contradiction = exampleCheckFailure(check);
        outcome =
          contradiction === null
            ? {
                kept: true,
                repaired: attempt > 0,
                content,
                words: wordCount(content),
                skill_codes: rw.skill_codes,
                content_type: rw.content_type,
                surface_gate: rw.surface_gate,
                surface_gate_reason: rw.surface_gate_reason,
                taxonomy_gap: rw.taxonomy_gap,
                audit,
                example_pairs: check.pairs.length,
              }
            : { dropped: "audit_self_contradictory", detail: contradiction };
        break;
      }
      results.push({
        unit: u.label,
        piece: pi,
        unit_words: wordCount(text),
        long_whole_before_split: longWhole.length,
        cuts,
        writeup_markdown: source,
        ...outcome,
      });
    }
  }

  const stages = Object.fromEntries(byStage);
  writeFileSync(
    resolve(OUT, "report.json"),
    JSON.stringify(
      {
        model,
        spent_usd: spent,
        pass1_measured: measured,
        pass1_segments: Object.fromEntries(
          Object.entries(pass1).map(([k, v]) => [
            k,
            v.segments.map((s) => ({
              start: s.start,
              end: s.end,
              teaches: s.teaches_sat_content,
              sub_skills: s.sub_skills.map((x) => x.id),
              clusters: s.clusters.map((x) => x.id),
              summary: s.summary,
            })),
          ]),
        ),
        lesson10_pass1_has_2_39_segment: l10 >= 0,
        stages,
        results,
      },
      null,
      2,
    ),
  );
  for (const [id, m] of Object.entries(measured)) {
    process.stdout.write(
      `${id}: pass 1 output ${m.plain.output} -> ${m.writeup.output} tokens (${m.plain.thoughts} -> ${m.writeup.thoughts} thinking); $${m.plain.usd.toFixed(4)} -> $${m.writeup.usd.toFixed(4)}\n`,
    );
  }
  for (const r of results) {
    const o = z
      .object({
        unit: z.string(),
        piece: z.number(),
        kept: z.boolean().optional(),
        dropped: z.string().optional(),
      })
      .passthrough()
      .parse(r);
    process.stdout.write(
      `${o.unit} piece ${o.piece}: ${o.kept === true ? "kept" : `dropped (${o.dropped ?? "?"})`}\n`,
    );
  }
  process.stdout.write(`spent $${spent.toFixed(3)} of $${cap}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
