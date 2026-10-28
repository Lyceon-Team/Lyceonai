/**
 * The pull-request check for worked-example content: every rule, on every example and plan.
 *
 * @spec [owner brief "Worked examples: production system" (Karl, 2026-10-27): "weekly batch PR (3
 *       examples; Codex audits the maths and hook rules; Karl merges)", "monthly plan PR", hook
 *       rules, "the monthly plan rotates hook types"] | @implemented [2026-10-27]
 *
 * plain English: `pnpm exec tsx scripts/worked-examples/check-content.ts --content <root>` reads
 * content/worked-examples/ under <root> and fails (exit 1, every problem listed) when an example
 * breaks a content, hook, style, plan or voice rule, when two live examples share a post_on (one a
 * day), or when a monthly plan does not rotate its hook types. Run by
 * .github/workflows/worked-example-checks.yml on pull requests into `social`, so Codex audits the
 * maths of content that already passes the mechanical rules; the daily job runs the same rules
 * again before it renders.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planProblems } from "../../shared/worked-examples/rules";
import {
  CONTENT_DIR,
  exampleProblems,
  loadExamples,
  loadPlan,
} from "./content";
import type { ExampleOnBranch } from "./approval";
import { loadKit } from "./kit";

/** Two live (not retired) examples on one day. */
export function sameDayProblems(
  examples: readonly ExampleOnBranch[],
): string[] {
  const byDay = new Map<string, string[]>();
  for (const e of examples) {
    if (e.content.retired) continue;
    byDay.set(e.content.post_on, [
      ...(byDay.get(e.content.post_on) ?? []),
      e.dir,
    ]);
  }
  return [...byDay]
    .filter(([, dirs]) => dirs.length > 1)
    .map(
      ([day, dirs]) =>
        `${dirs.length} examples post on ${day} (${dirs.join(", ")}): one a day`,
    );
}

export function checkContent(contentRoot: string): string[] {
  const kit = loadKit();
  const problems: string[] = [];
  let examples: ExampleOnBranch[];
  try {
    examples = loadExamples(contentRoot);
  } catch (err: unknown) {
    if (!(err instanceof Error)) throw err;
    return [err.message];
  }
  for (const e of examples)
    problems.push(...exampleProblems(contentRoot, e, kit).problems);
  problems.push(...sameDayProblems(examples));
  const base = join(contentRoot, CONTENT_DIR);
  if (existsSync(base))
    for (const name of readdirSync(base).sort()) {
      const m = /^(\d{4}-\d{2})-plan$/.exec(name);
      if (!m?.[1]) continue;
      const plan = loadPlan(contentRoot, m[1]);
      if (plan)
        problems.push(
          ...planProblems(plan).map((p) => `${CONTENT_DIR}/${name}: ${p}`),
        );
    }
  return problems;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const k = process.argv.indexOf("--content");
  const root = resolve(k === -1 ? "." : (process.argv[k + 1] ?? "."));
  const problems = checkContent(root);
  if (problems.length > 0) {
    process.stderr.write(
      `check-content: ${problems.length} problem(s)\n  ${problems.join("\n  ")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    `check-content: ${loadExamples(root).length} example(s) pass every rule\n`,
  );
}
