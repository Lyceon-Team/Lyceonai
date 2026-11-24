/**
 * Whether one due worked example may be built this week: every pull-request check, then its
 * approval, then its approved row in the database.
 *
 * @spec [Karl's ruling "Worked examples: drop the merge gate" (2026-11-24, SCL-288): "The weekly
 *       job runs everything worked-example-checks.yml runs on a PR, on each due example, before
 *       build. A failing example is refused, not rendered."; "Anti-leak stays: an approved
 *       question must never go into a full-length form or a later QOTD. The weekly job writes the
 *       approved rows itself (what seed-sql.ts produces), using the service role it already has,
 *       before rendering. If the database refuses a row, refuse that example."]
 *       | @implemented [2026-11-24]
 *
 * plain English: examples now reach `social` by a direct push from the scheduled task, so no pull
 * request ran `worked-example-checks.yml` on them. The weekly job runs that same check
 * (checkContent over the checkout) once, and an example is refused when any problem names its
 * folder, its day (two examples on one day) or its month's plan, or when a problem names no
 * example at all (the tree could not be read). Then its approval (the task's trailer or Karl's
 * merge, approval.ts). Then its row, the same values seed-sql.ts prints (seedRowValues), is
 * upserted as approved through the service role. The table's trigger refuses an approved row whose
 * question is in a full-length form or a QOTD today or later, and the QOTD scheduler and the
 * full-length guard skip approved rows from then on (20261118000000_worked_examples.sql), so the
 * row is the anti-leak half and must exist before anything is rendered. A refused row refuses the
 * example.
 *
 * Expected outcome: an example is rendered only when it passes every check, is approved, and its
 * approved row is in the database. Trade-off: a row written for an example whose render later
 * fails stays approved; that is the safe direction for the leak rule (the question stays out of
 * forms and future QOTDs).
 */
import type { ExampleApproval, ExampleOnBranch } from "./approval";
import { CONTENT_DIR } from "./content";
import { seedRowValues, type WorkedExampleRow } from "./seed-sql";

/** The check's problems that belong to this example: its folder, its day, its month's plan. */
export function checkProblemsFor(
  problems: readonly string[],
  e: ExampleOnBranch,
): string[] {
  const plan = `${CONTENT_DIR}/${e.content.post_on.slice(0, 7)}-plan:`;
  return problems.filter(
    (p) =>
      p.startsWith(`${e.dir}:`) ||
      p.includes(`${e.dir},`) ||
      p.includes(`${e.dir})`) ||
      p.startsWith(plan) ||
      // A problem that names no example (the tree could not be read) refuses every example.
      !p.includes(`${CONTENT_DIR}/`),
  );
}

export type RowWrite = { ok: true } | { ok: false; reason: string };

export type AdmitDeps = {
  /** checkContent(content): everything worked-example-checks.yml runs on a pull request. */
  checkProblems: readonly string[];
  approve: (
    e: ExampleOnBranch,
  ) => Promise<
    { ok: true; approval: ExampleApproval } | { ok: false; reason: string }
  >;
  writeRow: (row: WorkedExampleRow) => Promise<RowWrite>;
  outroText: string;
};

export type Admission =
  | { ok: true; approval: ExampleApproval }
  | { ok: false; reason: string };

export async function admitExample(
  e: ExampleOnBranch,
  deps: AdmitDeps,
): Promise<Admission> {
  const failing = checkProblemsFor(deps.checkProblems, e);
  if (failing.length > 0)
    return { ok: false, reason: `check failed: ${failing.join("; ")}` };
  const verdict = await deps.approve(e);
  if (!verdict.ok)
    return { ok: false, reason: `not approved: ${verdict.reason}` };
  const row = seedRowValues(e.content, verdict.approval, deps.outroText);
  if (row.status !== "approved")
    return {
      ok: false,
      reason: `the row would be ${row.status}, not approved`,
    };
  const written = await deps.writeRow(row);
  if (!written.ok)
    return {
      ok: false,
      reason: `the database refused the approved row: ${written.reason}`,
    };
  return { ok: true, approval: verdict.approval };
}

/**
 * The one table call the writer makes, typed structurally so the service-role client and the
 * real-Postgres test double both fit.
 */
export type RowTableClient = {
  from(table: "worked_examples"): {
    upsert(
      row: WorkedExampleRow,
      opts: { onConflict: string },
    ): PromiseLike<{ error: { message: string } | null }>;
  };
};

/** Upserts the row through the service role; the database's refusal is returned, not thrown. */
export function supabaseRowWriter(
  client: RowTableClient,
): (row: WorkedExampleRow) => Promise<RowWrite> {
  return async (row) => {
    const { error } = await client
      .from("worked_examples")
      .upsert(row, { onConflict: "id" });
    return error ? { ok: false, reason: error.message } : { ok: true };
  };
}
