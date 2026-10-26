/**
 * @spec [Karl's ruling 2026-10-23: ACT-scoped advice is dropped from an entry, never un-scoped;
 *       the audit must fail a chunk that states an [ACT NOTE] point as general; prove it by
 *       planting a generalised chunk and watching the audit reject it] | @implemented [2026-10-23]
 *
 *       and [Karl's ruling 2026-10-26: a sentence the book contradicts is dropped, never
 *       corrected; the audit treats the omission as faithful; prove it on the real rule 6 case,
 *       the corrected-omission version passing and an actually-unfaithful version failing]
 *
 * plain English: runs the book pipeline's AUDIT prompt (book-prompts.ts) on planted
 * (source, entry) pairs and checks one verdict per pair. A plant is a JSON line {name, source,
 * entry, omitted?, expect_act_scope_respected? | expect_result?}: `omitted` is the list the
 * rewrite would send as OMITTED AS SELF-CONTRADICTED; `expect_act_scope_respected` checks that
 * one field; `expect_result` checks the whole audit ("pass", or the drop reason auditFailure
 * gives, or "fail" for any failure). The file lives in the book's gitignored cache because
 * sources and entries are book text. Each plant is audited `--runs` times (temperature 0 is not
 * a guarantee of one answer), and every run must agree. Exit 1 on any disagreement. It prints verdicts and the audit's issues, never
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
  auditUserMessage,
} from "./book-prompts";
import {
  GENERATION_MODEL_DEFAULT,
  assertProxied,
  generateJson,
} from "./vertex";

const plantSchema = z
  .object({
    name: z.string().min(1),
    source: z.string().min(1),
    entry: z.string().min(1),
    omitted: z.array(z.string()).default([]),
    expect_act_scope_respected: z.boolean().optional(),
    expect_result: z.string().min(1).optional(),
  })
  .refine(
    (p) =>
      (p.expect_act_scope_respected === undefined) !==
      (p.expect_result === undefined),
    "a plant expects exactly one of expect_act_scope_respected or expect_result",
  );

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
        user: auditUserMessage({
          source: p.source,
          before: "",
          after: "",
          entry: p.entry,
          omitted: p.omitted,
        }),
        responseSchema: auditResponseSchema,
        schema: auditSchema,
      });
      const result = auditFailure(audit) ?? "pass";
      const ok =
        p.expect_result === "fail"
          ? result !== "pass"
          : p.expect_result !== undefined
            ? result === p.expect_result
            : audit.act_scope_respected === p.expect_act_scope_respected;
      if (!ok) wrong += 1;
      const expected =
        p.expect_result !== undefined
          ? `result ${p.expect_result}`
          : `act_scope_respected=${String(p.expect_act_scope_respected)}`;
      process.stdout.write(
        `${ok ? "AS EXPECTED" : "WRONG"}  ${p.name} run ${r + 1}: result ${result}, act_scope_respected=${audit.act_scope_respected}, contradictions_verified=${audit.contradictions_verified} (expected ${expected}); issues: ${audit.issues}\n`,
      );
    }
  }
  process.stdout.write(
    `\n${plants.length} plants x ${runs} runs: ${wrong === 0 ? "every verdict as expected" : `${wrong} verdicts WRONG`}\n`,
  );
  if (wrong > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
