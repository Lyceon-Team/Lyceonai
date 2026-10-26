/**
 * @spec [Karl's ruling 2026-10-23: ACT-scoped advice is dropped from an entry, never un-scoped;
 *       the audit must fail a chunk that states an [ACT NOTE] point as general; prove it by
 *       planting a generalised chunk and watching the audit reject it] | @implemented [2026-10-23]
 *       and [Karl's ruling 2026-10-26: the drop-only example check, proven on the real chunk 6:1
 *       dropped and the other kept chunks passing, false-positive rate reported]
 *
 * plain English: runs the book pipeline's AUDIT prompt (book-prompts.ts) on planted
 * (source, entry) pairs and checks one verdict per pair. A plant is a JSON line {name, source,
 * entry, rule_opening?, expect_act_scope_respected? | expect_example_check? | expect_result?}:
 * `rule_opening` is sent as the audit's RULE OPENING; `expect_act_scope_respected` checks that
 * audit field; `expect_example_check` ("pass" or "drop") runs the EXAMPLE CHECK instead of the
 * audit, on the entry alone, and checks the code's decision; `expect_result` checks the whole
 * audit ("pass", the drop reason auditFailure
 * gives, or "fail" for any failure). The file lives in the book's gitignored cache because
 * sources and entries are book text. Each plant is audited `--runs` times (temperature 0 is not
 * a guarantee of one answer), and every run must agree. Exit 1 on any disagreement. It prints
 * verdicts, the audit's issues and the measured cost; nothing is cached or written.
 *
 * Usage: NODE_USE_ENV_PROXY=1 pnpm exec tsx scripts/rag/book-audit-plant.ts \
 *          --plants scripts/rag/.cache/book-meltzer-grammar/plants.jsonl [--runs 2]
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  AUDIT_SYSTEM,
  EXAMPLE_CHECK_SYSTEM,
  auditFailure,
  auditResponseSchema,
  auditSchema,
  auditUserMessage,
  exampleCheckFailure,
  exampleCheckResponseSchema,
  exampleCheckSchema,
  exampleCheckUserMessage,
} from "./book-prompts";
import {
  GENERATION_MODEL_DEFAULT,
  type Usage,
  assertProxied,
  generateJson,
} from "./vertex";

const plantSchema = z
  .object({
    name: z.string().min(1),
    source: z.string().min(1),
    entry: z.string().min(1),
    rule_opening: z.string().nullable().default(null),
    expect_act_scope_respected: z.boolean().optional(),
    expect_example_check: z.enum(["pass", "drop"]).optional(),
    expect_result: z.string().min(1).optional(),
  })
  .refine(
    (p) =>
      [
        p.expect_act_scope_respected,
        p.expect_example_check,
        p.expect_result,
      ].filter((x) => x !== undefined).length === 1,
    "a plant expects exactly one of expect_act_scope_respected, expect_example_check or expect_result",
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
  let usd = 0;
  const onUsage = (u: Usage): void => {
    usd += u.usd;
  };
  const model = values.model ?? GENERATION_MODEL_DEFAULT;
  for (const p of plants) {
    for (let r = 0; r < runs; r += 1) {
      if (p.expect_example_check !== undefined) {
        // The same call ingest-book makes on an entry the audit passed; the code decides.
        const check = await generateJson({
          step: `example-check-plant:${p.name}`,
          model,
          system: EXAMPLE_CHECK_SYSTEM,
          user: exampleCheckUserMessage(p.entry),
          responseSchema: exampleCheckResponseSchema,
          schema: exampleCheckSchema,
          onUsage,
        });
        const why = exampleCheckFailure(check);
        const got = why === null ? "pass" : "drop";
        const ok = got === p.expect_example_check;
        if (!ok) wrong += 1;
        process.stdout.write(
          `${ok ? "AS EXPECTED" : "WRONG"}  ${p.name} run ${r + 1}: example check ${got} (expected ${p.expect_example_check}); ${check.pairs.length} pairs${why === null ? "" : `; ${why}`}\n`,
        );
        continue;
      }
      // The same user message the pipeline sends; the context is left empty so the verdict
      // rests on the source and the entry alone.
      const audit = await generateJson({
        step: `audit-plant:${p.name}`,
        model,
        system: AUDIT_SYSTEM,
        user: auditUserMessage({
          source: p.source,
          before: "",
          after: "",
          entry: p.entry,
          ruleOpening: p.rule_opening,
        }),
        responseSchema: auditResponseSchema,
        schema: auditSchema,
        onUsage,
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
        `${ok ? "AS EXPECTED" : "WRONG"}  ${p.name} run ${r + 1}: result ${result}, act_scope_respected=${audit.act_scope_respected} (expected ${expected}); issues: ${audit.issues}\n`,
      );
    }
  }
  process.stdout.write(
    `cost: $${usd.toFixed(4)} (third-party price figures; see vertex.ts)\n`,
  );
  process.stdout.write(
    `\n${plants.length} plants x ${runs} runs: ${wrong === 0 ? "every verdict as expected" : `${wrong} verdicts WRONG`}\n`,
  );
  if (wrong > 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
