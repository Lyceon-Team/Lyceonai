/**
 * The 2026-10-21 explanation corrections, applied to the real rows as the seeds wrote them.
 *
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part D and its test: "the corrected
 *        explanation content is served"; student-UI register F-57; docs/questions_governance.md
 *        §A.1 (`version` increments on a content edit), §A.6] | @implemented [2026-10-21]
 *
 * plain English: genesis + every migration, then SATM26DQWW4 exactly as its proving batch
 * inserted it (the INSERT line is read from the seed file, not restated) with its de-lettered
 * text (deletter_explanations.sql), published. The correction file is applied as Karl applies
 * it; the test reads what serving reads (`servable_questions`, the view every engine's snapshot
 * is built from) and requires the corrected text, a version bump of exactly one, and an
 * unchanged row on a second application. F-57 is CLOSED (owner rulings on #1277, Karl,
 * 2026-10-21: its pattern found 0 rows in production), so the file changes that one question
 * and nothing else, which the last case proves against a row the file must not touch.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapPgDatabase, PG_AVAILABLE } from "../helpers/pg-supabase";

const ROOT = join(__dirname, "..", "..");
const SEED = join(ROOT, "infra/supabase/seed");
const CORRECTIONS = join(
  SEED,
  "migrations/explanation_corrections_2026-10-21.sql",
);

let pg: Client;

/** The seed's own INSERT for `id`, one line in the proving batch. */
function seedInsert(batch: string, id: string): string {
  const line = readFileSync(join(SEED, batch), "utf8")
    .split("\n")
    .find((l) => l.startsWith("INSERT INTO") && l.includes(`VALUES ('${id}'`));
  if (line === undefined) throw new Error(`${id} not found in ${batch}`);
  return line;
}

/** deletter_explanations.sql's UPDATE for `id`. */
function deletterUpdate(id: string): string {
  const line = readFileSync(
    join(SEED, "migrations/deletter_explanations.sql"),
    "utf8",
  )
    .split("\n")
    .find((l) => l.startsWith("UPDATE") && l.includes(`WHERE id = '${id}'`));
  if (line === undefined) throw new Error(`${id} not in deletter file`);
  return line;
}

async function served(
  id: string,
): Promise<{ explanation: string; version: number } | undefined> {
  const r = await pg.query<{ explanation: string; version: number }>(
    `SELECT explanation, version FROM public.servable_questions WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

describe.skipIf(!PG_AVAILABLE)(
  "explanation corrections 2026-10-21 (real Postgres)",
  () => {
    beforeAll(async () => {
      pg = await bootstrapPgDatabase("explanation_corrections_ci");
      await pg.query(seedInsert("proving_batch_003.sql", "SATM26DQWW4"));
      await pg.query(deletterUpdate("SATM26DQWW4"));
      // A letter-naming explanation the file must NOT touch since F-57 closed.
      await pg.query(seedInsert("proving_batch_004.sql", "SATM2IRA60X"));
      await pg.query(
        `UPDATE public.questions SET status = 'published' WHERE id IN ('SATM26DQWW4', 'SATM2IRA60X')`,
      );
    }, 240_000);

    afterAll(async () => {
      if (pg) await pg.end();
    });

    it("before: the 2(x − 3) + 5 = 3x − 4 explanation gives the wrong reasons; SATM2IRA60X (the untouched control) names a choice by letter", async () => {
      const algebra = await served("SATM26DQWW4");
      expect(algebra?.explanation).toContain(
        "$-3$ results from a sign error when combining $-6 + 5$",
      );
      const lettered = await served("SATM2IRA60X");
      expect(lettered?.explanation).toMatch(/option [A-D]\b/);
    });

    it("after: the corrected explanation is what serving reads, version + 1; nothing else changes", async () => {
      const before = {
        algebra: (await served("SATM26DQWW4"))?.version ?? 0,
        lettered: (await served("SATM2IRA60X"))?.version ?? 0,
      };
      await pg.query(readFileSync(CORRECTIONS, "utf8"));

      const algebra = await served("SATM26DQWW4");
      expect(algebra?.explanation).toContain(
        "dividing only the left side by $-1$ gives $x = -3$",
      );
      expect(algebra?.explanation).toContain(
        "$2x - 1 + 3x - 4 = 0$, so $5x = 5$ and $x = 1$",
      );
      expect(algebra?.explanation).toContain("reading $x$ as $-1$");
      expect(algebra?.explanation).not.toContain("combining $-6 + 5$");
      expect(algebra?.version).toBe(before.algebra + 1);

      // F-57 closed: the file no longer re-states any other explanation.
      const lettered = await served("SATM2IRA60X");
      expect(lettered?.explanation).toMatch(/option [A-D]\b/);
      expect(lettered?.version).toBe(before.lettered);
    });

    it("a second application changes nothing", async () => {
      const once = {
        algebra: await served("SATM26DQWW4"),
        lettered: await served("SATM2IRA60X"),
      };
      await pg.query(readFileSync(CORRECTIONS, "utf8"));
      expect(await served("SATM26DQWW4")).toEqual(once.algebra);
      expect(await served("SATM2IRA60X")).toEqual(once.lettered);
    });
  },
);
