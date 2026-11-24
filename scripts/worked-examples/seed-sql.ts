/**
 * Generates the seed SQL that writes worked-example rows, for Karl to apply.
 *
 * @spec [Step 0 ruling 4 (Karl, 2026-10-27): "render from the merged content file + seed SQL";
 *       owner brief "Worked examples: production system" data model]
 *       | @implemented [2026-10-27]
 *
 * plain English: `GITHUB_TOKEN=… GITHUB_REPOSITORY=… CONTENT_APPROVER_LOGIN=… pnpm exec tsx
 * scripts/worked-examples/seed-sql.ts --content <checkout of social> --week 2026-W45 > seed.sql`
 * prints one upsert per example in the week: approved (with Karl's merge as approved_by/at) when
 * GitHub's record shows his merge, retired when the file says so, otherwise draft. The rows mirror
 * the content file; video_script is every spoken line in order. The table's own trigger refuses an
 * approved row whose question is in a full-length form or a QOTD today or later, so applying it
 * is where the database's half of the leak rule bites. Nothing here touches a database.
 *
 * From 2026-11-24 (SCL-288) the weekly job writes the approved rows itself (weekly-admit.ts) from
 * the same values (seedRowValues), so this script and the job cannot disagree about a row. An
 * example approved by the scheduled task's trailer is recorded as approved_by
 * "worked-examples-task" at the commit's date; Karl's merge is still "Karl" at the merge's date.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  workedExampleId,
  type WorkedExampleContent,
} from "../../packages/shared/src/worked-example-schema";
import { approvalForCommit, type ExampleApproval } from "./approval";
import { scriptLines } from "./composition";
import { loadExamples } from "./content";
import { folderCommit, folderCommitRecord, pullForCommit } from "./github";
import { loadKit } from "./kit";

/** A dollar-quoted SQL literal whose tag cannot occur in the text. */
export function sqlLiteral(text: string): string {
  let tag = "we";
  while (text.includes(`$${tag}$`)) tag += "x";
  return `$${tag}$${text}$${tag}$`;
}

/** One public.worked_examples row, as the content file and its approval give it. */
export type WorkedExampleRow = {
  id: string;
  question_id: string;
  skill_code: string;
  signature_move: string;
  steps: WorkedExampleContent["steps"];
  trap: string;
  check_step: string;
  takeaway: string;
  video_script: string;
  hook_type: WorkedExampleContent["hook"]["type"];
  hook_line: string;
  post_on: string;
  status: "draft" | "approved" | "retired";
  approved_by: string | null;
  approved_at: string | null;
};

/** Who approved, as the row records it: "Karl" for his merge, the task's name for its trailer. */
export function approvedBy(approval: ExampleApproval): {
  by: string;
  at: string;
} {
  return "pr" in approval
    ? { by: "Karl", at: approval.mergedAt }
    : { by: approval.by, at: approval.at };
}

export function seedRowValues(
  example: WorkedExampleContent,
  approval: ExampleApproval | null,
  outroText: string,
): WorkedExampleRow {
  const status = example.retired ? "retired" : approval ? "approved" : "draft";
  const who = status === "approved" && approval ? approvedBy(approval) : null;
  return {
    id: workedExampleId(example.question_id),
    question_id: example.question_id,
    skill_code: example.skill_code,
    signature_move: example.signature_move,
    steps: example.steps,
    trap: example.trap.summary,
    check_step: example.check,
    takeaway: example.takeaway,
    video_script: scriptLines(example, outroText)
      .map((l) => l.text)
      .join("\n"),
    hook_type: example.hook.type,
    hook_line: example.hook.line,
    post_on: example.post_on,
    status,
    approved_by: who?.by ?? null,
    approved_at: who?.at ?? null,
  };
}

export function seedRow(
  example: WorkedExampleContent,
  approval: ExampleApproval | null,
  outroText: string,
): string {
  const r = seedRowValues(example, approval, outroText);
  const cols: [string, string][] = [
    ["id", sqlLiteral(r.id)],
    ["question_id", sqlLiteral(r.question_id)],
    ["skill_code", sqlLiteral(r.skill_code)],
    ["signature_move", sqlLiteral(r.signature_move)],
    ["steps", `${sqlLiteral(JSON.stringify(r.steps))}::jsonb`],
    ["trap", sqlLiteral(r.trap)],
    ["check_step", sqlLiteral(r.check_step)],
    ["takeaway", sqlLiteral(r.takeaway)],
    ["video_script", sqlLiteral(r.video_script)],
    ["hook_type", sqlLiteral(r.hook_type)],
    ["hook_line", sqlLiteral(r.hook_line)],
    ["post_on", `${sqlLiteral(r.post_on)}::date`],
    ["status", sqlLiteral(r.status)],
    [
      "approved_by",
      r.approved_by === null ? "NULL" : sqlLiteral(r.approved_by),
    ],
    [
      "approved_at",
      r.approved_at === null
        ? "NULL"
        : `${sqlLiteral(r.approved_at)}::timestamptz`,
    ],
  ];
  const names = cols.map(([n]) => n);
  return `INSERT INTO public.worked_examples (${names.join(", ")})
VALUES (${cols.map(([, v]) => v).join(", ")})
ON CONFLICT (id) DO UPDATE SET ${names
    .filter((n) => n !== "id" && n !== "question_id")
    .map((n) => `${n} = EXCLUDED.${n}`)
    .join(", ")};`;
}

async function main(): Promise<void> {
  const arg = (name: string): string => {
    const k = process.argv.indexOf(name);
    const v = k === -1 ? undefined : process.argv[k + 1];
    if (!v)
      throw new Error(
        `usage: seed-sql.ts --content <root> --week <YYYY-Www> (missing ${name})`,
      );
    return v;
  };
  const content = resolve(arg("--content"));
  const week = arg("--week");
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const token = process.env.GITHUB_TOKEN ?? "";
  if (!repo || !token)
    throw new Error(
      "GITHUB_REPOSITORY and GITHUB_TOKEN are required to read Karl's merge",
    );
  const kit = loadKit();
  const rows: string[] = [];
  for (const e of loadExamples(content).filter((x) => x.cycle === week)) {
    const sha = folderCommit(content, e.dir);
    const verdict = await approvalForCommit(
      folderCommitRecord(content, sha),
      (s) => pullForCommit(repo, s, token),
      process.env.CONTENT_APPROVER_LOGIN?.trim() || undefined,
    );
    if (!verdict.ok)
      process.stderr.write(
        `${e.dir}: not approved (${verdict.reason}); seeded as draft\n`,
      );
    rows.push(
      seedRow(
        e.content,
        verdict.ok ? verdict.approval : null,
        kit.voice.outro_text,
      ),
    );
  }
  process.stdout.write(
    `-- Worked examples ${week}, generated by scripts/worked-examples/seed-sql.ts. OWNER-RUN.\nBEGIN;\n${rows.join("\n")}\nCOMMIT;\n`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `seed-sql: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
