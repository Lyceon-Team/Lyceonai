/**
 * Writes the screenshot harness's fixtures from the seed corpus.
 *
 *   pnpm exec tsx scripts/shots-tables-fixtures.mts
 *
 * plain English: the questions the harness renders come from `loadSeedQuestions()` — the SAME
 * reader the question-markup CI gate and the underline tests use. An earlier cut of this hand-
 * rolled its own SQL unescaping and corrupted a control stem (`\$` lost its backslash, `\\n`
 * became a newline), which read as a rendering regression when it was a fixture bug. One reader,
 * not two.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { loadSeedQuestions } from "./ci/question-markup-gate";
import { hasTableBlock } from "../shared/question-tables";

type Fixture = { id: string; section: string; field: string; text: string };

const seeded = loadSeedQuestions();

const tables: Fixture[] = [];
for (const q of seeded) {
  const section = q.id.startsWith("SATRW") ? "RW" : "M";
  if (hasTableBlock(q.stem)) {
    tables.push({ id: q.id, section, field: "stem", text: q.stem });
  } else if (q.passage !== null && hasTableBlock(q.passage)) {
    tables.push({ id: q.id, section, field: "passage", text: q.passage });
  }
}

/** Controls: real stems with no table, a dozen of them, the owner's "at least 10". */
const plain: Fixture[] = seeded
  .filter((q) => !hasTableBlock(q.stem) && q.stem.length > 80 && q.stem.length < 700)
  .slice(0, 12)
  .map((q) => ({
    id: q.id,
    section: q.id.startsWith("SATRW") ? "RW" : "M",
    field: "stem",
    text: q.stem,
  }));

const out = path.resolve(
  import.meta.dirname,
  "../client/shots-tables/questions.json",
);
writeFileSync(out, `${JSON.stringify({ tables, plain }, null, 1)}\n`, "utf8");
process.stdout.write(
  `${tables.length} table questions, ${plain.length} controls -> ${out}\n`,
);
