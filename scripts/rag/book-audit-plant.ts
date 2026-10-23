/**
 * @spec [Karl's ruling 2026-10-23: ACT-scoped advice is dropped from an entry, never un-scoped;
 *       the audit must fail a chunk that states an [ACT NOTE] point as general; prove it by
 *       planting a generalised chunk and watching the audit reject it] | @implemented [2026-10-23]
 *
 * plain English: runs the book pipeline's AUDIT prompt (book-prompts.ts) on planted
 * (source, entry) pairs and checks one verdict per pair: act_scope_respected must be what the
 * plant expects. A plant is a JSON line {name, source, entry, expect_act_scope_respected}; the
 * file lives in the book's gitignored cache because sources and entries are book text. Each
 * plant is audited `--runs` times (temperature 0 is not a guarantee of one answer), and every
 * run must agree. Exit 1 on any disagreement. It prints verdicts and the audit's issues, never
 * anything else; nothing is cached or written.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/book-audit-plant.ts \
 *          --plants scripts/rag/.cache/book-meltzer-grammar/plants.jsonl [--runs 2]
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  AUDIT_SYSTEM,
  auditFailure,
  auditResponseSchema,
  auditSchema,
} from "./book-prompts";
import {
  GENERATION_MODEL_DEFAULT,
  assertProxied,
  generateJson,
} from "./vertex";

const plantSchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  entry: z.string().min(1),
  expect_act_scope_respected: z.boolean(),
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      plants: { type: "string" },
      runs: { type: "string", default: "2" },
      model: { type: "string", default: GENERATION_MODEL_DEFAULT },
    },
  });
  assertProxied();
  const plants = readFileSync(z.string().parse(values.plants), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => plantSchema.parse(JSON.parse(l)));
  const runs = z.coerce.number().int().min(1).max(5).parse(values.runs);
  let wrong = 0;
  for (const p of plants) {
    for (let r = 0; r < runs; r += 1) {
      // The same user message the pipeline sends; the context is left empty so the verdict
      // rests on the source and the entry alone.
      const audit = await generateJson({
        step: `audit-plant:${p.name}`,
        model: values.model ?? GENERATION_MODEL_DEFAULT,
        system: AUDIT_SYSTEM,
        user: `SOURCE:\n${p.source}\n\nCONTEXT BEFORE:\n\n\nCONTEXT AFTER:\n\n\nENTRY:\n${p.entry}`,
        responseSchema: auditResponseSchema,
        schema: auditSchema,
      });
      const ok = audit.act_scope_respected === p.expect_act_scope_respected;
      if (!ok) wrong += 1;
      process.stdout.write(
        `${ok ? "AS EXPECTED" : "WRONG"}  ${p.name} run ${r + 1}: act_scope_respected=${audit.act_scope_respected} (expected ${p.expect_act_scope_respected}); audit result ${auditFailure(audit) ?? "pass"}; issues: ${audit.issues}\n`,
      );
    }
  }
  process.stdout.write(
    `\n${plants.length} plants x ${runs} runs: ${wrong === 0 ? "every verdict as expected" : `${wrong} verdicts WRONG`}\n`,
  );
  if (wrong > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
