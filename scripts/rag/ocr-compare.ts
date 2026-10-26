/**
 * @spec [CC Brief "Tune the Book Pipeline for Cost" (Karl, 2026-10-23) §4 (every change is
 *       measured against the accepted extraction: label sequence identical, markdown diff, the
 *       layout pages and the idiom table exact; a single label difference rejects the change)]
 *       | @implemented [2026-10-23]
 *
 * plain English: compares one OCR run (scripts/rag/.cache/book-<slug>/<run>/page-NN.md) with
 * the accepted extraction (…/<gold>/page-NN.md), page by page:
 *  - the Correct/Incorrect label sequence, label and example start (labelsInMarkdown), which
 *    must be identical: any difference is a REJECT;
 *  - whether the page is byte-identical, and if not, how many lines differ and how many
 *    characters the page grew or shrank, with the differing lines printed for reading;
 *  - the grammar points: the bold spans inside every labelled example, which must be
 *    identical: a REJECT otherwise;
 *  - the pages named by --exact (the layout pages): their content, with emphasis, quotes and
 *    blank lines normalized, must be identical: a REJECT otherwise.
 * Byte-identity is reported, not required: re-running the accepted configuration itself
 * reproduces only 16 of 30 pages byte for byte (measured 2026-10-23), the rest differing in
 * curly quotes, blank lines and emphasis outside the examples.
 * Exit 1 on any REJECT. It reads files only; no model is called.
 *
 * Usage: pnpm exec tsx scripts/rag/ocr-compare.ts --slug meltzer-grammar --run ocr-min
 *        [--gold gold] [--exact 15,21,29] [--show 20]
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { BOOK_SLUG_RE } from "./book";
import { CACHE_DIR } from "./fetch-transcripts";
import { compareLabels, labelsInMarkdown } from "./ocr-book";

/** The page body without the generated header comments. */
function body(md: string): string {
  return md
    .split("\n")
    .filter((l) => !l.startsWith("<!-- "))
    .join("\n")
    .trim();
}

/** Curly quotes folded to straight; blank lines dropped. Cosmetic run-to-run drift. */
function cosmetic(md: string): string {
  return md
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .split("\n")
    .filter((l) => l.trim() !== "")
    .join("\n");
}

/**
 * Pure. The grammar points: for each labelled example ("**Correct:** ..."), its label and the
 * bold spans inside the example, in order. These are what a student is taught to look at.
 */
export function examplePoints(md: string): string[] {
  const out: string[] = [];
  for (const m of cosmetic(md).matchAll(
    /^\*\*([^*\n]{1,40}?):\*\*[ \t]*(.*)$/gm,
  )) {
    const label = (m[1] ?? "").trim();
    if (!/correct/i.test(label)) continue;
    const spans = [...(m[2] ?? "").matchAll(/\*\*(.+?)\*\*/g)].map((x) =>
      (x[1] ?? "").replace(/<\/?u>/g, "").trim(),
    );
    out.push(`${label}: ${spans.join(" | ")}`);
  }
  return out;
}

/** Pure. A layout page's content with emphasis, quotes and blank lines normalized away. */
export function layoutContent(md: string): string {
  return cosmetic(md)
    .replace(/<\/?u>|\*+/g, "")
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
}

/** Pure. Lines of `a` not in `b` and of `b` not in `a`, as multisets, in order. */
export function lineDiff(
  a: string,
  b: string,
): { removed: string[]; added: string[] } {
  const count = (lines: string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const al = a.split("\n");
  const bl = b.split("\n");
  const ac = count(al);
  const bc = count(bl);
  const take = (
    lines: string[],
    own: Map<string, number>,
    other: Map<string, number>,
  ): string[] => {
    const left = new Map(own);
    const out: string[] = [];
    for (const l of lines) {
      const extra = (left.get(l) ?? 0) - (other.get(l) ?? 0);
      if (extra > 0) {
        out.push(l);
        left.set(l, (left.get(l) ?? 0) - 1);
      }
    }
    return out;
  };
  return { removed: take(al, ac, bc), added: take(bl, bc, ac) };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      run: { type: "string" },
      gold: { type: "string", default: "gold" },
      exact: { type: "string", default: "15,21,29" },
      show: { type: "string", default: "12" },
      guard: { type: "boolean", default: false },
    },
  });
  const slug = z.string().regex(BOOK_SLUG_RE).parse(values.slug);
  const dir = (name: string): string =>
    resolve(
      CACHE_DIR,
      `book-${slug}`,
      z
        .string()
        .regex(/^[a-z0-9-]+$/)
        .parse(name),
    );
  const goldDir = dir(values.gold ?? "gold");
  const runDir = dir(z.string().parse(values.run));
  const exact = new Set(
    (values.exact ?? "")
      .split(",")
      .filter((x) => x !== "")
      .map(Number),
  );
  const show = z.coerce.number().int().min(0).parse(values.show);
  const pages = readdirSync(goldDir)
    .map((f) => /^page-(\d+)\.md$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .sort();

  let rejects = 0;
  let identical = 0;
  let cosmeticOnly = 0;
  let labels = 0;
  let shown = 0;
  for (const p of pages) {
    const g = body(readFileSync(resolve(goldDir, `page-${p}.md`), "utf8"));
    const r = body(readFileSync(resolve(runDir, `page-${p}.md`), "utf8"));
    const gl = labelsInMarkdown(g);
    const rl = labelsInMarkdown(r);
    labels += gl.length;
    const labelsSame = JSON.stringify(gl) === JSON.stringify(rl);
    const gp = examplePoints(g);
    const rp = examplePoints(r);
    const pointsSame = JSON.stringify(gp) === JSON.stringify(rp);
    const same = g === r;
    if (same) identical += 1;
    if (cosmetic(g) === cosmetic(r)) cosmeticOnly += 1;
    const n = Number(p);
    const verdict = !labelsSame
      ? "REJECT: labels differ"
      : !pointsSame
        ? "REJECT: grammar-point emphasis differs"
        : exact.has(n) && layoutContent(g) !== layoutContent(r)
          ? "REJECT: layout content differs"
          : same
            ? "identical"
            : "differs (cosmetic or outside the examples)";
    if (verdict.startsWith("REJECT")) rejects += 1;
    if (same) continue;
    const d = lineDiff(g, r);
    if (!pointsSame) {
      const dp = lineDiff(gp.join("\n"), rp.join("\n"));
      for (const [i, x] of dp.removed.entries())
        process.stdout.write(
          `    point gold: ${x}\n    point run:  ${dp.added[i] ?? ""}\n`,
        );
    }
    process.stdout.write(
      `page ${p}: ${verdict}; ${d.removed.length} lines changed; ${r.length - g.length >= 0 ? "+" : ""}${r.length - g.length} chars${labelsSame ? "" : `; gold labels ${gl.map((l) => l.label[0]).join("")}, run ${rl.map((l) => l.label[0]).join("")}`}\n`,
    );
    for (const [i, line] of d.removed.entries()) {
      if (shown >= show) break;
      shown += 1;
      process.stdout.write(
        `    - ${line.slice(0, 200)}\n    + ${(d.added[i] ?? "").slice(0, 200)}\n`,
      );
    }
  }
  if (values.guard === true) {
    // The label guard, end to end, with this run's independent reading as the checker: it must
    // agree with the accepted transcription on every page, and flipping any one accepted label
    // (Correct <-> Incorrect) must be reported.
    let agreeing = 0;
    let caught = 0;
    let missed = 0;
    for (const p of pages) {
      const g = body(readFileSync(resolve(goldDir, `page-${p}.md`), "utf8"));
      const reading = z
        .array(z.object({ label: z.string(), example_start: z.string() }))
        .parse(
          JSON.parse(
            readFileSync(resolve(runDir, `page-${p}.labels.json`), "utf8"),
          ),
        );
      const base = compareLabels(labelsInMarkdown(g), reading);
      if (base.length === 0) agreeing += 1;
      else {
        rejects += 1;
        process.stdout.write(
          `page ${p}: REJECT: reading disagrees with accepted labels: ${base.join("; ")}\n`,
        );
      }
      const marks = [...g.matchAll(/^\*\*(Incorrect|Correct):\*\*/gm)];
      for (const m of marks) {
        const at = m.index ?? 0;
        const flipped =
          g.slice(0, at) +
          (m[1] === "Correct" ? "**Incorrect:**" : "**Correct:**") +
          g.slice(at + m[0].length);
        if (compareLabels(labelsInMarkdown(flipped), reading).length > 0)
          caught += 1;
        else {
          missed += 1;
          rejects += 1;
          process.stdout.write(
            `page ${p}: REJECT: flipped label at offset ${at} not caught\n`,
          );
        }
      }
    }
    process.stdout.write(
      `guard: reading agrees on ${agreeing}/${pages.length} pages; flipped labels caught ${caught}/${caught + missed}\n`,
    );
  }
  process.stdout.write(
    `\n${pages.length} pages: ${identical} byte-identical, ${cosmeticOnly} identical but for quotes and blank lines; ${labels} gold labels; ${rejects} REJECT\n${rejects === 0 ? "ACCEPT" : "REJECTED"}\n`,
  );
  if (rejects > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
