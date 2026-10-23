/**
 * @spec [CC Brief "Book Ingestion into the Knowledge Base" (Karl, 2026-10-22) §2.1 (extract with
 *       structure); Karl's instruction 2026-10-23 (vision OCR before any ingestion: pdftotext
 *       mangles this book's fonts; the Correct/Incorrect labels, the colour emphasis, the SAT/ACT
 *       two-column comparisons, the idiom table and the rule numbering must survive; ACT-only
 *       content must be identifiable)] | @implemented [2026-10-23]
 *
 * plain English: a PDF whose text layer is unusable → one markdown file per page, read from a
 * rendered image of the page by Gemini on Vertex, plus a combined file. Nothing is ingested.
 *  1. Render: `pdftoppm` (poppler) at --dpi (default 200) to PNG.
 *  2. Transcribe: one Gemini call per page returns the page as markdown in a fixed convention
 *     (TRANSCRIBE_SYSTEM), with the printed page number, ACT-only flags and anything it could
 *     not read confidently.
 *  3. Cross-check the labels: a SECOND, independent call reads the same image and lists only the
 *     example labels (Correct / Incorrect / any other) in order, each with the first words of its
 *     example. The code then requires the transcription's labels to be the same sequence, label
 *     for label. A dropped, added or inverted label (the error that teaches a student the
 *     opposite of the rule) is therefore caught by comparison, not by trusting one reading.
 *     A disagreement is reported per page; it is never silently resolved.
 *  4. Write, under scripts/rag/.cache/book-<slug>/ocr/ (gitignored: the text is the book's):
 *     page-NN.md, combined.md, report.md (per-page time, tokens, cost, flags, disagreements).
 *
 * Every model answer is cached (keyed by prompt version, model and the image's hash), so a
 * re-run is free and identical.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/ocr-book.ts --pdf <file> --slug <slug>
 *        [--pages 3-5] [--out ocr] [--dpi 200]
 *        [--transcribe-model M] [--transcribe-thinking default|MINIMAL|LOW|MEDIUM|HIGH]
 *        [--labels-model M] [--labels-thinking ...]
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { BOOK_SLUG_RE, sha256 } from "./book";
import { CACHE_DIR } from "./fetch-transcripts";
import {
  GENERATION_MODEL_DEFAULT,
  type ThinkingLevel,
  type Usage,
  ZERO_USAGE,
  usageSchema,
  addUsage,
  assertProxied,
  generateJson,
  usageCostUsd,
} from "./vertex";

export const TRANSCRIBE_SYSTEM = `You transcribe one page of an SAT and ACT grammar guide into markdown, exactly. The page is an image. A tutor will later teach students from your transcription, so a single wrong word, label or emphasis can teach the opposite of a rule. Transcribe; never correct, summarize, reorder or complete anything.

Conventions:
- Omit only the running header ("Complete SAT/ACT Grammar Rules" and the page number at the top), the rule line under it, and the footer logo ("THE CRITICAL READER"). Report the printed page number separately.
- A numbered rule title (large coloured heading such as "1. PERIODS & SEMICOLONS") is "## " plus the title exactly as printed. A lettered subsection ("A. Between two complete sentences") is "### " plus the text exactly. Other bold headings on their own line are "#### ".
- Example labels: every example line that begins with a label such as "Correct:", "Incorrect:", or any other label, starts a new paragraph that begins with the label in bold, exactly as printed, e.g. "**Incorrect:** Barbara McClintock ...". Copy the label word for word; never change, drop or add one.
- Emphasis inside example sentences and body text: text printed in COLOUR (orange or any colour other than black) is the grammar point; wrap it in ** **. Underlined text is <u>...</u> (inside the bold if it is both coloured and underlined: **<u>portraits</u>**). Italic text is *...*. Black bold text in body prose is ** ** as well.
- Keep every punctuation mark exactly. A punctuation mark printed in colour belongs INSIDE the bold with the coloured words around it ("**portraits. It was**", "**city; however,**"): a comma, semicolon, period or apostrophe is often the point of the rule. Keep curly quotes and apostrophes (“ ” ’) exactly as printed; do not straighten them.
- Mark only what is visibly emphasized: never add italics or bold to text printed plain.
- Bulleted lists stay bulleted. Blanks such as "_______" stay as printed.
- Side-by-side columns (for example an SAT version beside an ACT version of a question): NEVER interleave them. Transcribe the whole left column first as its own block, then the whole right column, each under a line "#### Column: <its heading as printed>" (e.g. "#### Column: SAT:"). Answer choices stay in their own column's block, in order.
- Tables: a markdown table with the same columns in the same order, read row by row across. If the page is a multi-column list (such as a list of idioms printed in several columns), transcribe it column by column, top to bottom, each column under "#### Column N" in left-to-right order, so that no entry moves to another column.
- ACT-only material: where a heading or note says the material is ACT only (for example "(ACT only)"), keep that text as printed AND put the line "[ACT ONLY]" directly under that heading. Where a note inside a rule applies only to the ACT (for example a "Note:" that begins "ACT ..." or says "on the ACT"), put "[ACT NOTE]" at the start of that paragraph.
- Anything you cannot read with confidence: write your best reading as [?reading?] and list it in unclear.

Also return:
- printed_page: the page number printed at the top of the page, or null if none.
- act_only: each heading or note on this page that applies only to the ACT, as printed, briefly.
- unclear: each [?reading?] you used, with a few words of context.`;

export const transcribeResponseSchema = {
  type: "OBJECT",
  properties: {
    printed_page: { type: "INTEGER", nullable: true },
    markdown: { type: "STRING" },
    act_only: { type: "ARRAY", items: { type: "STRING" } },
    unclear: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["printed_page", "markdown", "act_only", "unclear"],
} as const;
export const transcribeSchema = z.object({
  printed_page: z.number().int().nullable(),
  markdown: z.string(),
  act_only: z.array(z.string()),
  unclear: z.array(z.string()),
});
export type Transcription = z.infer<typeof transcribeSchema>;

export const LABELS_SYSTEM = `You check one page of an SAT and ACT grammar guide. The page is an image. List every EXAMPLE LABEL on the page, in reading order: a short bold word or phrase ending in a colon that introduces an example sentence, such as "Correct:", "Incorrect:", or any other such label. For each, give the label exactly as printed (without the colon) and the first five words of the example it introduces, exactly as printed.

Do not list headings, the words "Note:" or "Important:", answer choices, column headings such as "SAT:" or "ACT:", or labels that introduce explanations rather than example sentences. If the page has no example labels, return an empty list.`;

export const labelsResponseSchema = {
  type: "OBJECT",
  properties: {
    labels: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          example_start: { type: "STRING" },
        },
        required: ["label", "example_start"],
      },
    },
  },
  required: ["labels"],
} as const;
export const labelsSchema = z.object({
  labels: z.array(z.object({ label: z.string(), example_start: z.string() })),
});

export const OCR_PROMPT_VERSION = createVersion();
function createVersion(): string {
  return sha256(
    [
      TRANSCRIBE_SYSTEM,
      JSON.stringify(transcribeResponseSchema),
      LABELS_SYSTEM,
      JSON.stringify(labelsResponseSchema),
    ].join("\n"),
  ).slice(0, 12);
}

/**
 * The labels the guard compares: the Correct/Incorrect family ("Correct", "Incorrect", "Correct
 * but awkward", ...). These carry the rule; a dropped or inverted one teaches its opposite.
 * Other bold lead-ins ("Tip-off:", "Shortcut:", "Plug in:") are transcribed but not compared:
 * the two readings disagree on whether they are labels, and that is not the error that matters.
 */
export function isCorrectnessLabel(label: string): boolean {
  return /correct/i.test(label);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .trim();
}

/**
 * Pure. The Correct/Incorrect-family labels in a transcription, in order: every paragraph that
 * opens with such a bold label ending in a colon ("**Correct:** ..."), with the first five words
 * after it.
 */
export function labelsInMarkdown(
  md: string,
): { label: string; example_start: string }[] {
  const out: { label: string; example_start: string }[] = [];
  for (const m of md.matchAll(/^\*\*([^*\n]{1,40}?):\*\*[ \t]*(.*)$/gm)) {
    const label = (m[1] ?? "").trim();
    if (!isCorrectnessLabel(label)) continue;
    const words = (m[2] ?? "")
      .replace(/<\/?u>|\*+/g, "")
      .split(/\s+/)
      .filter((w) => w !== "")
      .slice(0, 5)
      .join(" ");
    out.push({ label, example_start: words });
  }
  return out;
}

/**
 * Pure. Compares the transcription's labels with the independent label reading. Returns one
 * line per disagreement (count, label text, or example start, at each position); empty when
 * they agree. Example starts are compared on their first three words, case and punctuation
 * folded, which is enough to tell which example a label belongs to.
 */
export function compareLabels(
  transcribed: { label: string; example_start: string }[],
  checked: { label: string; example_start: string }[],
): string[] {
  const check = checked.filter((l) => isCorrectnessLabel(l.label));
  const out: string[] = [];
  if (transcribed.length !== check.length)
    out.push(
      `label count: transcription ${transcribed.length}, independent reading ${check.length}`,
    );
  const n = Math.min(transcribed.length, check.length);
  for (let i = 0; i < n; i += 1) {
    const a = transcribed[i];
    const b = check[i];
    if (a === undefined || b === undefined) continue;
    if (norm(a.label) !== norm(b.label))
      out.push(
        `label ${i + 1}: transcription "${a.label}", independent reading "${b.label}"`,
      );
    const first3 = (s: string): string =>
      norm(s).split(" ").slice(0, 3).join(" ");
    if (first3(a.example_start) !== first3(b.example_start))
      out.push(
        `label ${i + 1} (${a.label}): example starts "${a.example_start}" vs "${b.example_start}"`,
      );
  }
  return out;
}

/**
 * Pure. The index of the first page that opens the book's ACT-only section (a heading that is
 * exactly "ACT ONLY"), or null. Everything from there to the end of the book is ACT-only:
 * in this book rules 17-20 and the idiom table sit under one banner, and only rule 18 repeats
 * "(ACT only)" in its own title, so a per-heading flag would miss three rules.
 */
export function actOnlySectionStart(pages: string[]): number | null {
  const i = pages.findIndex((md) => /^#{1,4}\s*ACT ONLY\s*$/im.test(md));
  return i === -1 ? null : i;
}

/** Parses "3-5,9" into page numbers. */
export function parsePages(spec: string, max: number): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((x) => Number(x.trim()));
    if (a === undefined || !Number.isInteger(a))
      throw new Error(`bad --pages "${spec}"`);
    const end = b === undefined ? a : b;
    if (!Number.isInteger(end) || a < 1 || end > max || end < a)
      throw new Error(`bad --pages "${spec}" (1-${max})`);
    for (let p = a; p <= end; p += 1) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

/**
 * The configuration each stage runs on (CC Brief "Tune the Book Pipeline for Cost", Karl,
 * 2026-10-23). Transcription and the label list are reading, not reasoning. Measured on the
 * 30-page Meltzer guide against the accepted extraction (scripts/rag/ocr-compare.ts):
 *  - transcription, gemini-3.5-flash at its default thinking: $0.025/page, about 1,300 thinking
 *    tokens per page. At LOW: $0.008/page. Labels identical (148), layout pages exact, and
 *    where grammar-point emphasis differs from the accepted text, the page image showed LOW
 *    right (black bold the accepted run dropped) or the difference was the same punctuation-at-
 *    the-edge variation a re-run of the default configuration shows. It writes straight
 *    quotes where the default often wrote curly ones (same count). MINIMAL ($0.007/page) was
 *    rejected: it adds underlines that are not on the page and doubles quote marks.
 *    gemini-3.1-flash-lite transcription ($0.001/page) was rejected: it drops and invents
 *    grammar points (16 pages).
 *  - label check, gemini-3.1-flash-lite (no thinking): $0.0006/page, against $0.012 on flash.
 *    Its reading agrees with the accepted labels on all 30 pages, and flipping any one of
 *    the 148 accepted labels is caught by the guard (148/148).
 */
export const TRANSCRIBE_MODEL = GENERATION_MODEL_DEFAULT;
export const TRANSCRIBE_THINKING = "LOW";
export const LABELS_MODEL = "gemini-3.1-flash-lite";
export const LABELS_THINKING = "default";

type StageConfig = { model: string; thinking: ThinkingLevel | undefined };
function stageConfig(
  model: string | undefined,
  thinking: string | undefined,
): StageConfig {
  const level = z
    .enum(["default", "MINIMAL", "LOW", "MEDIUM", "HIGH"])
    .parse(thinking ?? "default");
  return {
    model: z.string().min(1).parse(model),
    thinking: level === "default" ? undefined : level,
  };
}
function cacheTag(c: StageConfig): string {
  return c.thinking === undefined ? c.model : `${c.model}\u0000${c.thinking}`;
}
function stageLine(us: Usage[]): string {
  const u = us.reduce(addUsage, ZERO_USAGE);
  return `${u.calls} calls, ${u.prompt} in / ${u.output - u.thoughts} out / ${u.thoughts} thinking tokens, $${u.usd.toFixed(4)} ($${(u.usd / Math.max(1, us.length)).toFixed(4)}/page)`;
}

async function cached<T>(
  dir: string,
  key: string,
  schema: z.ZodType<T>,
  call: () => Promise<T>,
): Promise<{ value: T; cached: boolean }> {
  const path = resolve(
    dir,
    `${sha256(`${OCR_PROMPT_VERSION}\u0000${key}`)}.json`,
  );
  if (existsSync(path)) {
    const hit = schema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (hit.success) return { value: hit.data, cached: true };
  }
  const value = await call();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return { value, cached: false };
}

type PageResult = {
  transcribeUsage: Usage;
  labelsUsage: Usage;
  page: number;
  printed: number | null;
  ms: number;
  usage: Usage;
  cached: boolean;
  t: Transcription;
  disagreements: string[];
  labels: number;
};

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      pdf: { type: "string" },
      slug: { type: "string" },
      pages: { type: "string" },
      "transcribe-model": { type: "string", default: TRANSCRIBE_MODEL },
      "transcribe-thinking": { type: "string", default: TRANSCRIBE_THINKING },
      "labels-model": { type: "string", default: LABELS_MODEL },
      "labels-thinking": { type: "string", default: LABELS_THINKING },
      dpi: { type: "string", default: "200" },
      out: { type: "string", default: "ocr" },
    },
  });
  assertProxied();
  const pdf = z.string().min(1).parse(values.pdf);
  if (!existsSync(pdf)) throw new Error(`no such PDF: ${pdf}`);
  const slug = z.string().regex(BOOK_SLUG_RE).parse(values.slug);
  const transcribe = stageConfig(
    values["transcribe-model"],
    values["transcribe-thinking"],
  );
  const labels = stageConfig(values["labels-model"], values["labels-thinking"]);
  const dpi = z.coerce.number().int().min(72).max(400).parse(values.dpi);
  const outName = z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .parse(values.out);
  const outDir = resolve(CACHE_DIR, `book-${slug}`, outName);
  const callDir = resolve(outDir, "calls");
  mkdirSync(outDir, { recursive: true });

  const pageCount = Number(
    /Pages:\s+(\d+)/.exec(
      execFileSync("pdfinfo", [pdf], { encoding: "utf8" }),
    )?.[1] ?? "0",
  );
  const pages = parsePages(values.pages ?? `1-${pageCount}`, pageCount);
  const imgDir = mkdtempSync(join(tmpdir(), "ocr-book-"));
  execFileSync("pdftoppm", ["-r", String(dpi), "-png", pdf, join(imgDir, "p")]);
  const images = new Map(
    readdirSync(imgDir).map((f) => [
      Number(/(\d+)\.png$/.exec(f)?.[1]),
      join(imgDir, f),
    ]),
  );

  // Time and token use are kept beside the cache, so a re-run from cache still reports what
  // each page cost when it was read.
  const metricsPath = resolve(outDir, "metrics.json");
  const metricsSchema = z.record(
    z.object({
      ms: z.number(),
      transcribe: usageSchema,
      labels: usageSchema,
    }),
  );
  const metrics = existsSync(metricsPath)
    ? metricsSchema.parse(JSON.parse(readFileSync(metricsPath, "utf8")))
    : {};
  const results: PageResult[] = [];
  for (const page of pages) {
    const path = images.get(page);
    if (path === undefined) throw new Error(`page ${page} did not render`);
    const data = readFileSync(path);
    const image = sha256(data.toString("base64"));
    // The default configuration keeps the key shape the accepted run was cached under.
    const tKey = `transcribe\u0000${cacheTag(transcribe)}\u0000${image}`;
    const lKey = `labels\u0000${cacheTag(labels)}\u0000${image}`;
    let tUsage: Usage = ZERO_USAGE;
    let lUsage: Usage = ZERO_USAGE;
    const started = Date.now();
    const [t, l] = await Promise.all([
      cached(callDir, tKey, transcribeSchema, () =>
        generateJson({
          step: `transcribe p${page}`,
          model: transcribe.model,
          ...(transcribe.thinking === undefined
            ? {}
            : { thinking: transcribe.thinking }),
          system: TRANSCRIBE_SYSTEM,
          user: "Transcribe this page.",
          image: { mimeType: "image/png", data },
          responseSchema: transcribeResponseSchema,
          schema: transcribeSchema,
          onUsage: (u) => {
            tUsage = addUsage(tUsage, u);
          },
        }),
      ),
      cached(callDir, lKey, labelsSchema, () =>
        generateJson({
          step: `labels p${page}`,
          model: labels.model,
          ...(labels.thinking === undefined
            ? {}
            : { thinking: labels.thinking }),
          system: LABELS_SYSTEM,
          user: "List the example labels on this page.",
          image: { mimeType: "image/png", data },
          responseSchema: labelsResponseSchema,
          schema: labelsSchema,
          onUsage: (u) => {
            lUsage = addUsage(lUsage, u);
          },
        }),
      ),
    ]);
    const mkey = `${tKey}\u0000${lKey}`;
    const fresh = !(t.cached && l.cached);
    if (fresh)
      metrics[mkey] = {
        ms: Date.now() - started,
        transcribe: tUsage,
        labels: lUsage,
      };
    // Written after every page, so a run that dies part-way keeps what it measured.
    if (fresh) writeFileSync(metricsPath, JSON.stringify(metrics, null, 1));
    const ms = metrics[mkey]?.ms ?? 0;
    tUsage = metrics[mkey]?.transcribe ?? tUsage;
    lUsage = metrics[mkey]?.labels ?? lUsage;
    const usage = addUsage(tUsage, lUsage);
    // The independent reading is kept beside the page, so the guard can be re-checked later
    // without another model call.
    writeFileSync(
      resolve(outDir, `page-${String(page).padStart(2, "0")}.labels.json`),
      JSON.stringify(l.value.labels, null, 1),
    );
    const mdLabels = labelsInMarkdown(t.value.markdown);
    const disagreements = compareLabels(mdLabels, l.value.labels);
    results.push({
      page,
      printed: t.value.printed_page,
      ms,
      usage,
      transcribeUsage: tUsage,
      labelsUsage: lUsage,
      cached: t.cached && l.cached,
      t: t.value,
      disagreements,
      labels: mdLabels.length,
    });
    process.stdout.write(
      `p${page} (printed ${t.value.printed_page ?? "-"}): ${mdLabels.length} labels, ${disagreements.length === 0 ? "labels agree" : `${disagreements.length} DISAGREEMENT(S)`}, ${t.value.unclear.length} unclear, ${(ms / 1000).toFixed(1)}s, $${usageCostUsd(usage).toFixed(4)}${fresh ? "" : " (cached)"}\n`,
    );
  }

  writeFileSync(metricsPath, JSON.stringify(metrics, null, 1));

  const actFrom = actOnlySectionStart(results.map((r) => r.t.markdown));
  const scopeNote = (i: number): string =>
    actFrom !== null && i >= actFrom
      ? `<!-- ACT-ONLY SECTION: everything from the "ACT ONLY" banner (PDF page ${results[actFrom]?.page ?? "?"}) to the end of the book -->\n`
      : "";
  results.forEach((r, i) => {
    writeFileSync(
      resolve(outDir, `page-${String(r.page).padStart(2, "0")}.md`),
      `<!-- PDF page ${r.page}; printed page ${r.printed ?? "none"} -->\n${scopeNote(i)}\n${r.t.markdown.trim()}\n`,
    );
  });
  writeFileSync(
    resolve(outDir, "combined.md"),
    results
      .map(
        (r, i) =>
          `<!-- PDF page ${r.page}; printed page ${r.printed ?? "none"} -->\n${scopeNote(i)}\n${r.t.markdown.trim()}\n`,
      )
      .join("\n---\n\n"),
  );
  const total = results.reduce((u, r) => addUsage(u, r.usage), ZERO_USAGE);
  const report = [
    `# OCR: ${slug}`,
    "",
    `transcribe ${cacheTag(transcribe)}; labels ${cacheTag(labels)}; ${dpi} dpi, prompt ${OCR_PROMPT_VERSION}; ${results.length} pages; ${results.reduce((n, r) => n + r.labels, 0)} example labels`,
    `transcribe: ${stageLine(results.map((r) => r.transcribeUsage))}`,
    `labels: ${stageLine(results.map((r) => r.labelsUsage))}`,
    `total: ${total.calls} calls, ${total.prompt} prompt / ${total.output} output tokens, $${usageCostUsd(total).toFixed(4)}, ${(results.reduce((n, r) => n + r.ms, 0) / 1000).toFixed(1)}s (as first read; cached re-runs are free)`,
    "",
    "| PDF page | printed | labels | label check | unclear | ACT-only | seconds | prompt tok | output tok | cost |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.page} | ${r.printed ?? "-"} | ${r.labels} | ${r.disagreements.length === 0 ? "agree" : `**${r.disagreements.length} disagree**`} | ${r.t.unclear.length} | ${r.t.act_only.length} | ${(r.ms / 1000).toFixed(1)} | ${r.usage.prompt} | ${r.usage.output} | $${usageCostUsd(r.usage).toFixed(4)} |`,
    ),
    "",
    "## Label disagreements",
    "",
    ...(results.some((r) => r.disagreements.length > 0)
      ? results.flatMap((r) => r.disagreements.map((d) => `- p${r.page}: ${d}`))
      : ["- none"]),
    "",
    "## Could not read confidently",
    "",
    ...(results.some((r) => r.t.unclear.length > 0)
      ? results.flatMap((r) => r.t.unclear.map((u) => `- p${r.page}: ${u}`))
      : ["- none"]),
    "",
    "## ACT-only content flagged",
    "",
    ...results.flatMap((r) => r.t.act_only.map((a) => `- p${r.page}: ${a}`)),
    "",
  ].join("\n");
  writeFileSync(resolve(outDir, "report.md"), report);
  process.stdout.write(
    `\n${report}\nfiles: ${outDir}/{page-NN.md,combined.md,report.md}\n`,
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
