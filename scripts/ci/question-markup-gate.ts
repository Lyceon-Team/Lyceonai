/**
 * Question markup gate: the seeded question bank carries no markup but a paired <u>...</u>,
 * and every "the underlined ..." stem has exactly one underlined target in its passage.
 *
 * @spec [questions_governance.md §A (assembly gate); shared/question-markup.ts; live bug
 *       2026-10-11 (18 Text Structure and Purpose passages printed their <u> tags); the Codex
 *       `missing_underlined_target` finding] | @implemented [2026-10-11]
 *
 * plain English: reads every `INSERT INTO questions` in infra/supabase/seed/proving_batch_*.sql
 * — the rows the assembly gate emitted and the bank was loaded from — and runs the same
 * `questionMarkupViolations` the assembly gate (scripts/assemble-batch.ts) runs on new batches,
 * over stem, passage, every option's text and the explanation. A violation fails the build
 * unless its question id and rule are in the baseline below.
 *
 * trade-offs:
 *  - The baseline is a RATCHET, not an allowlist: it holds the published items whose stem says
 *    "the underlined sentence" with no <u> anywhere in the passage (content repairs owed to the
 *    questions workstream, which must decide which sentence is the target). A new violation
 *    fails; a baselined item that stops violating ALSO fails until its line is deleted, so the
 *    list can only shrink.
 *  - It reads the seed files, not production. Content changed out of band since seeding is
 *    invisible here; the repo is what a reviewer can check, and what CI can pin.
 *
 * edge cases: the parser understands exactly what the assembly gate writes — E'...' / '...'
 * strings (backslash and doubled-quote escapes), $tag$...$tag$ JSON, ARRAY[...], numbers and
 * NULL. A statement it cannot read is a gate failure, never a skip.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { questionMarkupViolations } from "../../shared/question-markup";

// Run from the repo root, as `pnpm run gate:question-markup` and vitest both do.
export const SEED_DIR = resolve("infra/supabase/seed");

/**
 * Published items whose stem references "the underlined ..." but whose passage has no
 * <u>...</u> span. Owed: a content repair choosing the target sentence (questions branch).
 * Delete a line when its item is repaired; the gate fails until you do.
 */
export const MISSING_TARGET_BASELINE: ReadonlySet<string> = new Set<string>([
  "SATRW23MNIGI", // proving_batch_003
  "SATRW2AN7BMA", // proving_batch_003
  "SATRW2H7EGLW", // proving_batch_003
  "SATRW2P8SGZC", // proving_batch_003
  "SATRW2XARLYW", // proving_batch_003
  "SATRW2Y02CGR", // proving_batch_003
  "SATRW2YUR3ON", // proving_batch_003
  "SATRW2SFLBXM", // proving_batch_012
  "SATRW231X9UO", // proving_batch_014
  "SATRW2TS5OI0", // proving_batch_015
  "SATRW2YXAET0", // proving_batch_028
  "SATRW27UMYDP", // proving_batch_030
  "SATRW2KLVFDL", // proving_batch_032
  "SATRW2WXCE73", // proving_batch_033
  "SATRW21FU69B", // proving_batch_034
  "SATRW2G4JMZO", // proving_batch_037
  "SATRW2SQ4V4N", // proving_batch_038
  "SATRW2CAPZOS", // proving_batch_042
  "SATRW2DF9JKE", // proving_batch_043
  "SATRW2OJV1VS", // proving_batch_044
  "SATRW2DRIG5E", // proving_batch_045
  "SATRW21O98BS", // proving_batch_047
  "SATRW2RF1D6J", // proving_batch_048
  "SATRW2GS78ME", // proving_batch_049
  "SATRW2X9K42K", // proving_batch_052
  "SATRW2U2NT21", // proving_batch_057
  "SATRW21I3WVE", // proving_batch_058
  "SATRW2BCTJJ7", // proving_batch_059
  "SATRW2ZM1KWS", // proving_batch_060
  "SATRW2CS60ID", // proving_batch_062
  "SATRW2DJVNWF", // proving_batch_063
  "SATRW2EX5MXR", // proving_batch_064
  "SATRW2SH7ZH3", // proving_batch_066
  "SATRW2E1DEXW", // proving_batch_067
  "SATRW2NDCG42", // proving_batch_068
  "SATRW223A5UN", // proving_batch_069
  "SATRW20C7KVQ", // proving_batch_070
  "SATRW2DD582X", // proving_batch_071
  "SATRW23ED2Z4", // proving_batch_072
  "SATRW2JAA9CM", // proving_batch_073
  "SATRW2HT4ONR", // proving_batch_075
  "SATRW26VNCBT", // proving_batch_076
  "SATRW21QND0N", // proving_batch_077
  "SATRW26GFD9L", // proving_batch_078
]);

const optionSchema = z.array(z.object({ key: z.string(), text: z.string() }));

export type SeedQuestion = {
  file: string;
  id: string;
  stem: string;
  passage: string | null;
  options: Array<{ key: string; text: string }>;
  explanation: string;
};

type SqlValue = string | number | null | { raw: string };

/** Reads one VALUES tuple's top-level items, starting just after its "(". */
function readTuple(
  sql: string,
  from: number,
): { values: SqlValue[]; end: number } {
  const values: SqlValue[] = [];
  let i = from;
  const skipSpace = () => {
    while (i < sql.length && /\s/.test(sql[i]!)) i++;
  };
  for (;;) {
    skipSpace();
    if (sql.startsWith("E'", i) || sql[i] === "'") {
      const escaped = sql[i] === "E";
      i += escaped ? 2 : 1;
      let out = "";
      for (;;) {
        const ch = sql[i];
        if (ch === undefined) throw new Error("unterminated string literal");
        if (escaped && ch === "\\") {
          const next = sql[i + 1];
          out += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
          i += 2;
          continue;
        }
        if (ch === "'") {
          if (sql[i + 1] === "'") {
            out += "'";
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        out += ch;
        i += 1;
      }
      values.push(out);
    } else if (sql[i] === "$") {
      const tagEnd = sql.indexOf("$", i + 1);
      const tag = sql.slice(i, tagEnd + 1);
      const close = sql.indexOf(tag, tagEnd + 1);
      if (tagEnd === -1 || close === -1)
        throw new Error("unterminated dollar-quoted literal");
      values.push(sql.slice(tagEnd + 1, close));
      i = close + tag.length;
    } else {
      // NULL, a number, ARRAY[...], or anything else up to the next top-level , or ).
      let depth = 0;
      const start = i;
      while (i < sql.length) {
        const ch = sql[i]!;
        if (ch === "'") {
          const close = sql.indexOf("'", i + 1);
          i = close === -1 ? sql.length : close + 1;
          continue;
        }
        if (ch === "[" || ch === "(") depth++;
        else if (ch === "]" || (ch === ")" && depth > 0)) depth--;
        else if ((ch === "," || ch === ")") && depth === 0) break;
        i++;
      }
      const raw = sql.slice(start, i).trim();
      values.push(
        raw === "NULL"
          ? null
          : /^-?\d+(\.\d+)?$/.test(raw)
            ? Number(raw)
            : { raw },
      );
    }
    // A cast such as ::jsonb follows the literal.
    skipSpace();
    while (sql.startsWith("::", i)) {
      i += 2;
      while (i < sql.length && /[A-Za-z_[\]]/.test(sql[i]!)) i++;
      skipSpace();
    }
    if (sql[i] === ",") {
      i++;
      continue;
    }
    if (sql[i] === ")") return { values, end: i + 1 };
    throw new Error(`unexpected character ${JSON.stringify(sql[i])} at ${i}`);
  }
}

/**
 * The options JSON. Batches 001-003 predate the dollar-quoted form and some of their option
 * literals are not valid JSON (`$\\\dfrac...$` in a standard string); those are still
 * checked, as one field holding the literal's whole text, rather than skipped.
 */
function readOptions(raw: string): Array<{ key: string; text: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err: unknown) {
    if (!(err instanceof SyntaxError)) throw err;
    return [{ key: "(unparsed literal)", text: raw }];
  }
  return optionSchema.parse(parsed);
}

/** Every question row in one seed file. Throws on a statement it cannot read. */
export function parseSeedQuestions(file: string, sql: string): SeedQuestion[] {
  const out: SeedQuestion[] = [];
  const head = /INSERT INTO questions \(([^)]*)\) VALUES \(/g;
  for (let m = head.exec(sql); m !== null; m = head.exec(sql)) {
    const columns = m[1]!.split(",").map((c) => c.trim());
    const { values, end } = readTuple(sql, m.index + m[0].length);
    head.lastIndex = end;
    if (values.length !== columns.length) {
      throw new Error(
        `${file}: ${values.length} values for ${columns.length} columns`,
      );
    }
    const col = (name: string): SqlValue => {
      const k = columns.indexOf(name);
      if (k === -1) throw new Error(`${file}: no ${name} column`);
      return values[k] ?? null;
    };
    const str = (name: string): string => {
      const v = col(name);
      if (typeof v !== "string")
        throw new Error(`${file}: ${name} is not a string literal`);
      return v;
    };
    const passage = col("passage");
    const optionsRaw = col("options");
    out.push({
      file,
      id: str("id"),
      stem: str("stem"),
      passage: typeof passage === "string" ? passage : null,
      options: typeof optionsRaw === "string" ? readOptions(optionsRaw) : [],
      explanation: str("explanation"),
    });
  }
  return out;
}

export function loadSeedQuestions(dir: string = SEED_DIR): SeedQuestion[] {
  return readdirSync(dir)
    .filter((f) => /^proving_batch_\d+\.sql$/.test(f))
    .sort()
    .flatMap((f) => parseSeedQuestions(f, readFileSync(join(dir, f), "utf-8")));
}

export type GateFinding = {
  id: string;
  file: string;
  field: string;
  message: string;
};

export function questionMarkupFindings(
  questions: ReadonlyArray<SeedQuestion>,
): GateFinding[] {
  return questions.flatMap((q) =>
    questionMarkupViolations({
      stem: q.stem,
      passage: q.passage,
      others: [
        ...q.options.map((o) => ({ field: `options.${o.key}`, value: o.text })),
        { field: "explanation", value: q.explanation },
      ],
    }).map((v) => ({ id: q.id, file: q.file, ...v })),
  );
}

export function isMissingTarget(f: GateFinding): boolean {
  return f.message.startsWith("MISSING_UNDERLINED_TARGET");
}

export function runGate(
  questions: ReadonlyArray<SeedQuestion>,
  baseline: ReadonlySet<string> = MISSING_TARGET_BASELINE,
): { failures: string[]; baselined: number } {
  const findings = questionMarkupFindings(questions);
  const failures: string[] = [];
  let baselined = 0;
  for (const f of findings) {
    if (isMissingTarget(f) && baseline.has(f.id)) {
      baselined++;
      continue;
    }
    failures.push(`${f.file} ${f.id} ${f.field}: ${f.message}`);
  }
  const stillMissing = new Set(
    findings.filter(isMissingTarget).map((f) => f.id),
  );
  for (const id of baseline) {
    if (!stillMissing.has(id)) {
      failures.push(
        `${id}: in MISSING_TARGET_BASELINE but no longer missing its target — delete the line`,
      );
    }
  }
  return { failures, baselined };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const questions = loadSeedQuestions();
  const { failures, baselined } = runGate(questions);
  if (failures.length > 0) {
    console.error(`question-markup gate: ${failures.length} failure(s)`);
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `question-markup gate: ${questions.length} seeded questions clean ` +
      `(${baselined} baselined missing-target item(s) owed a content repair)`,
  );
}
