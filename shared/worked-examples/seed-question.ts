/**
 * Reads a bank question from the seed SQL that created it, so a worked example's video shows the
 * question exactly as the bank holds it.
 *
 * @spec [Step 0 ruling 4 (Karl, 2026-10-27): "render from the merged content file + seed SQL"]
 *       | @implemented [2026-10-27]
 *
 * plain English: the question batches under infra/supabase/seed/ are `INSERT INTO questions
 * (columns) VALUES (...)` statements. parseQuestionInsert finds the one tuple whose first value is
 * the question id and reads its values with a small SQL literal reader: '...' (with ''), E'...'
 * (with backslash escapes), $tag$...$tag$, numbers, true/false, NULL and ARRAY[...], each with an
 * optional ::type cast. Nothing is evaluated. seedQuestionFromValues then checks the shape the
 * video needs (a multiple-choice question with four choices and a key A-D).
 *
 * edge cases: a question whose options still carry the doubled backslashes that
 * infra/supabase/seed/migrations/fix_doubled_latex_backslashes.sql repairs in the database is
 * refused (the seed text is not what the bank serves); so is a question a seed patch names by id
 * (scripts/worked-examples/seed-question.ts checks the patch files).
 */
import { z } from "zod";

export type SqlValue = string | number | boolean | null | SqlValue[];

type Cursor = { text: string; i: number };

function skipSpace(c: Cursor): void {
  while (c.i < c.text.length) {
    const ch = c.text[c.i];
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") c.i++;
    else if (c.text.startsWith("--", c.i)) {
      const nl = c.text.indexOf("\n", c.i);
      c.i = nl === -1 ? c.text.length : nl + 1;
    } else break;
  }
}

function fail(c: Cursor, what: string): never {
  throw new SyntaxError(`${what} at offset ${c.i}`);
}

function readQuoted(c: Cursor, escapes: boolean): string {
  c.i++; // opening quote
  let out = "";
  while (c.i < c.text.length) {
    const ch = c.text[c.i];
    if (ch === "'") {
      if (c.text[c.i + 1] === "'") {
        out += "'";
        c.i += 2;
        continue;
      }
      c.i++;
      return out;
    }
    if (escapes && ch === "\\") {
      const next = c.text[c.i + 1];
      const mapped =
        next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
      if (mapped === undefined) fail(c, "unterminated escape");
      out += mapped;
      c.i += 2;
      continue;
    }
    out += ch;
    c.i++;
  }
  fail(c, "unterminated string");
}

function readDollar(c: Cursor): string {
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(c.text.slice(c.i));
  if (!m) fail(c, "bad dollar quote");
  const tag = m[0];
  const start = c.i + tag.length;
  const end = c.text.indexOf(tag, start);
  if (end === -1) fail(c, `unterminated ${tag}`);
  c.i = end + tag.length;
  return c.text.slice(start, end);
}

function skipCast(c: Cursor): void {
  const m = /^::\s*[A-Za-z_][A-Za-z0-9_ ]*?(\[\])?(?=\s*[,)\]])/.exec(
    c.text.slice(c.i),
  );
  if (m) c.i += m[0].length;
}

function readValue(c: Cursor): SqlValue {
  skipSpace(c);
  const rest = c.text.slice(c.i, c.i + 6);
  let value: SqlValue;
  if (c.text[c.i] === "'") value = readQuoted(c, false);
  else if (/^[Ee]'/.test(rest)) {
    c.i++;
    value = readQuoted(c, true);
  } else if (c.text[c.i] === "$") value = readDollar(c);
  else if (/^ARRAY\[/i.test(rest)) {
    c.i += 6;
    const items: SqlValue[] = [];
    skipSpace(c);
    if (c.text[c.i] === "]") c.i++;
    else
      for (;;) {
        items.push(readValue(c));
        skipSpace(c);
        if (c.text[c.i] === ",") c.i++;
        else if (c.text[c.i] === "]") {
          c.i++;
          break;
        } else fail(c, "expected , or ] in ARRAY");
      }
    value = items;
  } else {
    const m = /^(NULL|true|false|-?\d+(\.\d+)?)\b/i.exec(c.text.slice(c.i));
    if (!m?.[1]) fail(c, "unknown SQL value");
    c.i += m[0].length;
    const word = m[1].toLowerCase();
    value =
      word === "null"
        ? null
        : word === "true"
          ? true
          : word === "false"
            ? false
            : Number(m[1]);
  }
  skipSpace(c);
  skipCast(c);
  return value;
}

/**
 * The values of the tuple that inserts `questionId` into questions, keyed by column, or null when
 * this SQL has no such tuple. Throws SyntaxError when the statement cannot be read.
 */
export function parseQuestionInsert(
  sql: string,
  questionId: string,
): Record<string, SqlValue> | null {
  const at = sql.indexOf(`('${questionId}'`);
  if (at === -1) return null;
  const head = sql.lastIndexOf("INSERT INTO", at);
  if (head === -1) return null;
  const header =
    /^INSERT INTO\s+(?:public\.)?questions\s*\(([^)]*)\)\s*VALUES\s*/i.exec(
      sql.slice(head),
    );
  if (!header?.[1]) return null;
  const columns = header[1].split(",").map((s) => s.trim());
  const c: Cursor = { text: sql, i: at + 1 };
  const values: SqlValue[] = [];
  for (;;) {
    values.push(readValue(c));
    if (c.text[c.i] === ",") c.i++;
    else if (c.text[c.i] === ")") break;
    else fail(c, "expected , or ) in VALUES");
  }
  if (values.length !== columns.length)
    throw new SyntaxError(
      `${questionId}: ${values.length} values for ${columns.length} columns`,
    );
  return Object.fromEntries(columns.map((col, k) => [col, values[k] ?? null]));
}

const optionsSchema = z
  .array(
    z
      .object({ key: z.enum(["A", "B", "C", "D"]), text: z.string().min(1) })
      .strict(),
  )
  .length(4);

export const seedQuestionSchema = z.object({
  id: z.string().regex(/^SAT(M|RW)[12][A-Z0-9]{6}$/),
  section: z.enum(["M", "RW"]),
  skill_codes: z.array(z.string().min(1)).min(1),
  item_type: z.literal("mcq"),
  stem: z.string().min(1),
  passage: z.string().nullable(),
  options: optionsSchema,
  correct_answer: z.enum(["A", "B", "C", "D"]),
});
export type SeedQuestion = z.infer<typeof seedQuestionSchema>;

/** The doubled-backslash signature fix_doubled_latex_backslashes.sql repairs (`\\` + non-space). */
const DOUBLED_BACKSLASH = /\\\\\S/;

export function seedQuestionFromValues(
  values: Record<string, SqlValue>,
): { ok: true; question: SeedQuestion } | { ok: false; problem: string } {
  let options: unknown = values["options"];
  if (typeof options === "string") {
    try {
      options = JSON.parse(options);
    } catch (e: unknown) {
      if (e instanceof SyntaxError)
        return { ok: false, problem: "options is not JSON" };
      throw e;
    }
  }
  const parsed = seedQuestionSchema.safeParse({ ...values, options });
  if (!parsed.success)
    return {
      ok: false,
      problem: `not a four-choice multiple-choice question: ${parsed.error.issues
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    };
  const q = parsed.data;
  if (q.options.some((o) => DOUBLED_BACKSLASH.test(o.text)))
    return {
      ok: false,
      problem: `${q.id}: its seed options carry doubled backslashes that a seed patch repairs in the database; the seed text is not what the bank serves`,
    };
  if (q.options.map((o) => o.key).join("") !== "ABCD")
    return { ok: false, problem: `${q.id}: options are not in order A-D` };
  return { ok: true, question: q };
}
