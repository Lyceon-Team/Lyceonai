/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §2 (extract →
 *       chunk on meaning → simplify → tag → embed and upsert, rows pending_review), §3 (review
 *       CSV and a full-text sample per skill), §5 (taxonomy names only; nothing active without a
 *       reviewer; the model never sees provenance), §7 (report); Doc-03D_V1.2 §6.6–§6.7 as
 *       amended by SCL-231 (curriculum_chunks, text-embedding-005)] | @implemented [2026-10-22]
 *
 * plain English: one book PDF in, reviewed-ready knowledge-base chunks out.
 *  1. Extract: `pdftotext` (poppler) → pages; running heads, feet and page numbers removed.
 *  2. Segment: the book is read in windows of about WINDOW_WORDS words. Gemini names each unit
 *     (one complete teachable idea) by its first and last words; the code locates and cuts it.
 *     Only units that finish inside a window are taken; the next window starts where the first
 *     unfinished one starts (book.ts `nextCursor`), so no unit is cut at a window edge.
 *  3. Rewrite: each teaching unit, with ~250 words either side for reference only, becomes
 *     self-contained instructional prose, tagged from the 29 taxonomy names (an enumerated
 *     schema, re-checked by Zod), with content_type and surface_gate; or is dropped with a reason.
 *  4. Audit: an independent call checks the chunk against its source and context: complete,
 *     not started mid-idea, faithful, correct, self-contained. Any failure drops it.
 *  5. Embed: text-embedding-005, RETRIEVAL_DOCUMENT, 768 dimensions.
 *  6. Write, under scripts/rag/.cache/book-<slug>/ (gitignored: the chunks are derived from a
 *     copyrighted book and are not committed): chunks.jsonl, drops.jsonl, review.csv (the file
 *     Karl marks), samples.md (the full text of up to --samples chunks per skill), report.md.
 *  7. With --execute and DATABASE_URL: every chunk through `public.curriculum_chunk_upsert` in
 *     ONE transaction. Rows land pending_review. A re-run reuses every cached model answer, so it
 *     produces the same chunks and provenance; the upsert leaves an unchanged row as it is.
 *
 * PRODUCTION IS OWNER-RUN (CLAUDE.md): Karl runs --execute against production. CC runs it
 * against a local database built from the migration pipeline.
 *
 * privacy and logging: no book text is printed except in the cache files above; progress lines
 *  carry counts and provenance only.
 *
 * Usage:
 *   NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/ingest-book.ts --pdf <file> --slug meltzer-grammar
 *   ... --execute     (with DATABASE_URL)
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
// pg ships no types and @types/pg is not a dependency; scripts/ci/types/pg.d.ts declares the
// narrow surface used here.
import { Client } from "pg";
import { z } from "zod";
import {
  BOOK_SLUG_RE,
  BookText,
  type BookChunk,
  type LocatedUnit,
  TEACHING_KINDS,
  assignProvenance,
  locateUnits,
  nextCursor,
  resolveChapters,
  sha256,
  splitPages,
  stripFurniture,
  toReviewCsv,
  unassignedGaps,
  wordCount,
} from "./book";
import {
  AUDIT_SYSTEM,
  type Audit,
  BOOK_PROMPT_VERSION,
  REWRITE_SYSTEM,
  SEGMENT_SYSTEM,
  auditFailure,
  auditResponseSchema,
  auditSchema,
  rewriteResponseSchema,
  rewriteSchemaFor,
  segmentResponseSchema,
  segmentSchema,
} from "./book-prompts";
import { CACHE_DIR } from "./fetch-transcripts";
import { pool } from "./generate-descriptions";
import { loadTaxonomy } from "./tag-videos";
import {
  GENERATION_MODEL_DEFAULT,
  type Usage,
  ZERO_USAGE,
  addUsage,
  assertProxied,
  embedTexts,
  generateJson,
  usageCostUsd,
} from "./vertex";

export const WINDOW_WORDS = 3_000;
const MAX_WINDOW_GROWTH = 4;
const CONTEXT_WORDS = 250;
const REPAIRABLE: ReadonlySet<string> = new Set([
  "audit_unfaithful",
  "audit_incorrect",
  "audit_not_self_contained",
]);
/** text-embedding-005 on Vertex, USD per 1M input characters (unverified list price). */
const EMBED_PRICE_PER_MCHAR = 0.025;

export function bookDir(slug: string): string {
  return resolve(CACHE_DIR, `book-${slug}`);
}

/** A model call whose answer is cached on disk, keyed by the prompt version and its input. */
async function cachedCall<T>(
  dir: string,
  key: string,
  schema: z.ZodType<T>,
  call: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  const path = resolve(
    dir,
    "calls",
    `${sha256(`${BOOK_PROMPT_VERSION}\u0000${key}`)}.json`,
  );
  if (existsSync(path)) {
    const hit = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (hit.success) return { value: hit.data, cached: true };
  }
  const value = await call();
  mkdirSync(resolve(dir, "calls"), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return { value, cached: false };
}

function extractPages(pdf: string): string[] {
  let raw: string;
  try {
    raw = execFileSync("pdftotext", ["-enc", "UTF-8", pdf, "-"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (err: unknown) {
    throw new Error(
      "pdftotext failed: install poppler (brew install poppler / apt install poppler-utils), or the PDF is unreadable",
      { cause: err },
    );
  }
  const pages = stripFurniture(splitPages(raw));
  // A scanned book has no text layer; pdftotext returns blank pages and there is nothing to chunk.
  if (wordCount(pages.join(" ")) < 50 * Math.max(1, pages.length / 10))
    throw new Error(
      `${pdf}: almost no extractable text (${pages.length} pages); a scanned PDF needs OCR first`,
    );
  return pages;
}

/** Offset `words` words after (or before, if negative) `at`. */
function offsetByWords(text: string, at: number, words: number): number {
  const re = /\S+/g;
  if (words >= 0) {
    re.lastIndex = at;
    let n = 0;
    let end = at;
    let m: RegExpExecArray | null;
    while (n < words && (m = re.exec(text)) !== null) {
      end = m.index + m[0].length;
      n += 1;
    }
    return n < words ? text.length : end;
  }
  const before = text.slice(0, at);
  const starts = [...before.matchAll(/\S+/g)].map((m) => m.index ?? 0);
  return starts[Math.max(0, starts.length + words)] ?? 0;
}

type Segmented = { units: LocatedUnit[]; windows: number; regrown: number };

async function segmentBook(
  book: BookText,
  dir: string,
  model: string,
  windowWords: number,
  onUsage: (u: Usage) => void,
): Promise<Segmented> {
  const units: LocatedUnit[] = [];
  let cursor = 0;
  let windows = 0;
  let regrown = 0;
  const end = book.text.length;
  while (cursor < end && book.text.slice(cursor).trim() !== "") {
    let growth = 1;
    for (;;) {
      const target = offsetByWords(book.text, cursor, windowWords * growth);
      const winEnd = target >= end ? end : book.cutBefore(target, cursor + 1);
      const winText = book.marked(cursor, winEnd);
      const isLast = winEnd >= end;
      const prev = units[units.length - 1];
      const leftOff =
        prev === undefined
          ? "This window is the START OF THE BOOK."
          : `The text just before this window was in chapter ${prev.chapter_number ?? "(unnumbered)"} "${prev.chapter_title}", section "${prev.section_title}". Units in this window before any new heading are in that chapter and section.`;
      const user = `${leftOff}\n${isLast ? "This window ends at the END OF THE BOOK; every unit ends in the window." : "This window stops at an arbitrary point; the last unit may continue past it."}\n\nWINDOW:\n${winText}`;
      const from = cursor;
      // An answer is cached only once its quotes are found in the window, so a bad answer is
      // retried (once, told what was wrong) rather than replayed from the cache forever.
      const { value } = await cachedCall(
        dir,
        `segment\u0000${model}\u0000${user}`,
        segmentSchema,
        async () => {
          let feedback = "";
          for (let attempt = 0; ; attempt += 1) {
            const answer = await generateJson({
              step: `segment@${from}`,
              model,
              system: SEGMENT_SYSTEM,
              user: user + feedback,
              responseSchema: segmentResponseSchema(),
              schema: segmentSchema,
              onUsage,
            });
            try {
              locateUnits(book, from, winEnd, answer.units);
              return answer;
            } catch (err: unknown) {
              if (attempt >= 1) throw err;
              feedback = `\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${err instanceof Error ? err.message : String(err)}. Copy start_quote and end_quote character for character from the window, in order.`;
            }
          }
        },
      );
      windows += 1;
      // The [page n] markers are in the window the model read, not in book.text; quotes never
      // contain them (the prompt says so) and locateUnits searches book.text directly.
      const located = locateUnits(book, cursor, winEnd, value.units);
      const step = nextCursor(located, winEnd, end);
      if (step.grow) {
        if (growth >= MAX_WINDOW_GROWTH)
          throw new Error(
            `segment@${cursor}: one idea runs past ${windowWords * growth} words; the book cannot be segmented here`,
          );
        growth *= 2;
        regrown += 1;
        continue;
      }
      units.push(...step.keep);
      if (step.cursor <= cursor)
        throw new Error(`segment@${cursor}: the window made no progress`);
      cursor = step.cursor;
      break;
    }
    process.stdout.write(
      `segmented to ${Math.round((100 * cursor) / end)}% (${units.length} units)\n`,
    );
  }
  return { units, windows, regrown };
}

export type DropRow = {
  chapter: number;
  section_title: string;
  page: number;
  kind: string;
  reason: string;
  detail: string;
};

type Kept = {
  unit: LocatedUnit;
  chapter: number;
  content: string;
  skill_codes: string[];
  content_type: BookChunk["content_type"];
  surface_gate: BookChunk["surface_gate"];
  surface_gate_reason: string;
  taxonomy_gap: string | null;
  audit: Audit;
  repaired: boolean;
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pdf: { type: "string" },
      slug: { type: "string" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
      samples: { type: "string", default: "5" },
      "window-words": { type: "string", default: String(WINDOW_WORDS) },
      execute: { type: "boolean", default: false },
    },
  });
  assertProxied();
  const pdf = z.string().min(1).parse(values.pdf);
  const slug = z.string().regex(BOOK_SLUG_RE).parse(values.slug);
  const model = z.string().min(1).parse(values.model);
  const perSkill = z.coerce.number().int().min(1).max(50).parse(values.samples);
  const windowWords = z.coerce
    .number()
    .int()
    .min(300)
    .max(20_000)
    .parse(values["window-words"]);
  if (!existsSync(pdf)) throw new Error(`no such PDF: ${pdf}`);
  const dir = bookDir(slug);
  mkdirSync(dir, { recursive: true });
  const { skills } = loadTaxonomy();
  const rewriteSchema = rewriteSchemaFor(skills);

  let usage: Usage = ZERO_USAGE;
  const onUsage = (u: Usage): void => {
    usage = addUsage(usage, u);
  };

  const pages = extractPages(pdf);
  const book = new BookText(pages);
  process.stdout.write(
    `${pdf}: ${pages.length} pages, ${wordCount(book.text)} words after furniture\n`,
  );
  const seg = await segmentBook(book, dir, model, windowWords, onUsage);

  const chapterNos = resolveChapters(seg.units);
  const chapters = new Map<LocatedUnit, number>(
    seg.units.map((u, i) => [u, chapterNos[i] ?? 0]),
  );
  const chapterOf = (u: LocatedUnit): number => chapters.get(u) ?? 0;

  const drops: DropRow[] = [];
  const drop = (u: LocatedUnit, reason: string, detail = ""): void => {
    drops.push({
      chapter: chapterOf(u),
      section_title: u.section_title,
      page: book.pageAt(u.start),
      kind: u.kind,
      reason,
      detail,
    });
  };

  for (const g of unassignedGaps(book.text, seg.units)) {
    drops.push({
      chapter: 0,
      section_title: "",
      page: book.pageAt(g.start),
      kind: "none",
      reason: "unassigned_text",
      detail: `${g.words} words no unit covered`,
    });
  }

  const teaching = seg.units.filter((u) => {
    if (TEACHING_KINDS.has(u.kind)) return true;
    drop(u, `kind_${u.kind}`);
    return false;
  });

  const results = await pool(teaching, 4, async (u): Promise<Kept | null> => {
    const source = book.text.slice(u.start, u.end);
    const before = book.text.slice(
      offsetByWords(book.text, u.start, -CONTEXT_WORDS),
      u.start,
    );
    const after = book.text.slice(
      u.end,
      offsetByWords(book.text, u.end, CONTEXT_WORDS),
    );
    const headings = `CHAPTER: ${u.chapter_title}\nSECTION: ${u.section_title}`;
    const rewriteUser = `${headings}\n\nCONTEXT BEFORE (reference only):\n${before}\n\nUNIT:\n${source}\n\nCONTEXT AFTER (reference only):\n${after}`;
    // One repair: an entry the audit finds unfaithful, incorrect or dependent is rewritten
    // once with the audit's finding, then audited again. A boundary failure (incomplete, or
    // started mid-idea) is never repaired: the unit itself is the wrong shape, so it drops.
    let feedback = "";
    for (let attempt = 0; ; attempt += 1) {
      const user = rewriteUser + feedback;
      const rw = (
        await cachedCall(
          dir,
          `rewrite\u0000${model}\u0000${user}`,
          rewriteSchema,
          () =>
            generateJson({
              step: "rewrite",
              model,
              system: REWRITE_SYSTEM,
              user,
              responseSchema: rewriteResponseSchema(skills),
              schema: rewriteSchema,
              onUsage,
            }),
        )
      ).value;
      if (!rw.keep) {
        drop(
          u,
          rw.drop_reason ?? "dropped_without_reason",
          rw.taxonomy_gap ?? "",
        );
        return null;
      }
      const content = (rw.content ?? "").trim();
      if (content === "") {
        drop(u, "empty_rewrite");
        return null;
      }
      const codes = [...new Set(rw.skill_codes)];
      if (codes.length === 0) {
        drop(u, "no_taxonomy_skill", rw.taxonomy_gap ?? "");
        return null;
      }
      const auditUser = `SOURCE:\n${source}\n\nCONTEXT BEFORE:\n${before}\n\nCONTEXT AFTER:\n${after}\n\nENTRY:\n${content}`;
      const audit = (
        await cachedCall(
          dir,
          `audit\u0000${model}\u0000${auditUser}`,
          auditSchema,
          () =>
            generateJson({
              step: "audit",
              model,
              system: AUDIT_SYSTEM,
              user: auditUser,
              responseSchema: auditResponseSchema,
              schema: auditSchema,
              onUsage,
            }),
        )
      ).value;
      const failed = auditFailure(audit);
      if (failed !== null) {
        if (attempt === 0 && REPAIRABLE.has(failed)) {
          feedback = `\n\nA REVIEWER REJECTED YOUR PREVIOUS ENTRY FOR THIS UNIT: ${audit.issues}\nPREVIOUS ENTRY:\n${content}\n\nWrite the entry again, fixing exactly that, and include nothing the unit does not say.`;
          continue;
        }
        drop(u, failed, audit.issues);
        return null;
      }
      return {
        unit: u,
        chapter: chapterOf(u),
        content,
        skill_codes: codes,
        content_type: rw.content_type,
        surface_gate: rw.surface_gate,
        surface_gate_reason: rw.surface_gate_reason,
        taxonomy_gap: rw.taxonomy_gap,
        audit,
        repaired: attempt > 0,
      };
    }
  });
  const kept = results.filter((k): k is Kept => k !== null);
  const provenance = assignProvenance(
    slug,
    kept.map((k) => ({
      chapterNumber: k.chapter,
      sectionTitle: k.unit.section_title,
      page: book.pageAt(k.unit.start),
    })),
  );
  const chunks: (BookChunk & {
    page: number;
    section_title: string;
    surface_gate_reason: string;
    taxonomy_gap: string | null;
  })[] = kept.map((k, i) => ({
    provenance: provenance[i] ?? "",
    content: k.content,
    skill_codes: k.skill_codes,
    content_type: k.content_type,
    surface_gate: k.surface_gate,
    page: book.pageAt(k.unit.start),
    section_title: k.unit.section_title,
    surface_gate_reason: k.surface_gate_reason,
    taxonomy_gap: k.taxonomy_gap,
  }));
  if (new Set(provenance).size !== provenance.length)
    throw new Error("provenance collision; nothing written");

  const vectors =
    chunks.length === 0
      ? []
      : await embedTexts(
          chunks.map((c) => c.content),
          "RETRIEVAL_DOCUMENT",
        );
  const embedChars = chunks.reduce((n, c) => n + c.content.length, 0);

  writeFileSync(
    resolve(dir, "chunks.jsonl"),
    chunks.map((c) => JSON.stringify(c)).join("\n") + "\n",
  );
  drops.sort((a, b) => a.page - b.page || a.reason.localeCompare(b.reason));
  writeFileSync(
    resolve(dir, "drops.jsonl"),
    drops.map((d) => JSON.stringify(d)).join("\n") + "\n",
  );
  writeFileSync(resolve(dir, "review.csv"), toReviewCsv(chunks));

  // Report: per skill (a multi-tagged chunk counts under each), the empty skills, drops.
  const bySkill = new Map<string, typeof chunks>(skills.map((s) => [s, []]));
  for (const c of chunks)
    for (const s of c.skill_codes) bySkill.get(s)?.push(c);
  const count = <T>(xs: T[], f: (x: T) => string): [string, number][] => {
    const m = new Map<string, number>();
    for (const x of xs) m.set(f(x), (m.get(f(x)) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const words = chunks.map((c) => wordCount(c.content)).sort((a, b) => a - b);
  const genCost = usageCostUsd(usage);
  const embedCost = (embedChars / 1_000_000) * EMBED_PRICE_PER_MCHAR;
  const gaps = chunks
    .map((c) => c.taxonomy_gap)
    .concat(
      drops
        .filter(
          (d) =>
            d.reason === "no_taxonomy_skill" || d.reason === "not_sat_specific",
        )
        .map((d) => d.detail),
    )
    .filter((g): g is string => g !== null && g.trim() !== "");
  const report = [
    `# Book ingestion: ${slug}`,
    "",
    `model ${model}, prompt ${BOOK_PROMPT_VERSION}; ${pages.length} pages; ${seg.windows} segment windows (${seg.regrown} widened for a long idea)`,
    "",
    `**${chunks.length} chunks** from ${seg.units.length} units; ${drops.length} dropped; ${kept.filter((k) => k.repaired).length} kept after one repair round.`,
    `words per chunk: min ${words[0] ?? 0}, median ${words[Math.floor(words.length / 2)] ?? 0}, max ${words[words.length - 1] ?? 0}`,
    `content_type: ${count(chunks, (c) => c.content_type)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
    `surface_gate: ${count(chunks, (c) => c.surface_gate)
      .map(([k, n]) => `${k} ${n}`)
      .join(", ")}`,
    "",
    "## Chunks per skill",
    "",
    "| skill | chunks |",
    "|---|---|",
    ...skills.map((s) => `| ${s} | ${bySkill.get(s)?.length ?? 0} |`),
    "",
    `**No chunks (${skills.filter((s) => (bySkill.get(s)?.length ?? 0) === 0).length} of ${skills.length}):** ${skills.filter((s) => (bySkill.get(s)?.length ?? 0) === 0).join("; ")}`,
    "",
    "## Dropped",
    "",
    ...count(drops, (d) => d.reason).map(([k, n]) => `- ${k}: ${n}`),
    "",
    "## Taxonomy gaps the model named",
    "",
    ...(gaps.length === 0
      ? ["- none"]
      : count(gaps, (g) => g.toLowerCase()).map(([k, n]) => `- ${k} (${n})`)),
    "",
    "## Cost",
    "",
    `- generation: ${usage.calls} calls, ${usage.prompt} prompt tokens (${usage.cached} cached), ${usage.output} output tokens: $${genCost.toFixed(3)} (cached answers cost nothing and are not counted)`,
    `- embedding: ${chunks.length} chunks, ${embedChars} characters: $${embedCost.toFixed(4)} at $${EMBED_PRICE_PER_MCHAR}/1M characters (unverified list price)`,
    "",
  ].join("\n");
  writeFileSync(resolve(dir, "report.md"), report);
  const samples = [
    `# ${slug}: full text of up to ${perSkill} chunks per skill`,
    "",
    ...skills.flatMap((s) => {
      const cs = bySkill.get(s) ?? [];
      if (cs.length === 0) return [];
      return [
        `## ${s} (${cs.length} chunks)`,
        "",
        ...cs
          .slice(0, perSkill)
          .flatMap((c) => [
            `### ${c.provenance} (page ${c.page}; ${c.content_type}; ${c.surface_gate}; skills: ${c.skill_codes.join("; ")})`,
            "",
            c.content,
            "",
          ]),
      ];
    }),
  ].join("\n");
  writeFileSync(resolve(dir, "samples.md"), samples);
  process.stdout.write(
    `${report}\nfiles: ${dir}/{report.md,samples.md,review.csv,chunks.jsonl,drops.jsonl}\n`,
  );

  if (values.execute !== true) {
    process.stdout.write(
      "dry run: nothing written to the database. Pass --execute with DATABASE_URL.\n",
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
    for (const [i, c] of chunks.entries()) {
      const vector = vectors[i];
      if (vector === undefined)
        throw new Error(`no vector for ${c.provenance}`);
      await db.query(
        "SELECT public.curriculum_chunk_upsert($1, $2, $3::text[], $4, $5, $6::extensions.vector)",
        [
          c.provenance,
          c.content,
          c.skill_codes,
          c.surface_gate,
          c.content_type,
          `[${vector.join(",")}]`,
        ],
      );
    }
    await db.query("COMMIT");
    const status = await db.query<{ status: string; n: string }>(
      "SELECT status, count(*)::text AS n FROM public.curriculum_chunks WHERE provenance = ANY($1::text[]) GROUP BY status ORDER BY status",
      [chunks.map((c) => c.provenance)],
    );
    process.stdout.write(
      `written: ${chunks.length} curriculum_chunks (${status.rows.map((s) => `${s.status} ${s.n}`).join(", ")})\n`,
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
