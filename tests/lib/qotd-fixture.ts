/**
 * @spec [docs/plans/seo/seo-marketing-vertical.md Q2, Q3] | @implemented [2026-10-05]
 *
 * plain English: the ONE Question of the Day fixture. The rows are what qotd_archive() and
 * qotd_question_for() returned for tests/fixtures/qotd/seed.sql (see the README there), parsed
 * with the same schema the server parses them with, so a test cannot assert a row shape the SQL
 * does not produce. FIXTURE_NOW sits inside 2026-10-05 in America/Chicago, the day the rows
 * were generated on: 2026-10-02..04 are archive days and 2026-10-05 is "today".
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  qotdRowSchema,
  toArchiveResponse,
  type QotdRow,
} from "../../shared/qotd/projection";
import type { QotdArchiveResponse } from "../../packages/shared/src/qotd-schema";

const fileSchema = z.object({
  generated_on: z.string(),
  archive: z.array(qotdRowSchema),
  today: z.array(qotdRowSchema).length(1),
});

const file = fileSchema.parse(
  JSON.parse(
    readFileSync(
      // Resolved from the repo root: vitest (node and jsdom) and Playwright both run there.
      resolve(process.cwd(), "tests/fixtures/qotd/rows.json"),
      "utf8",
    ),
  ),
);

/** Noon in Chicago on the day the fixture was generated. */
export const QOTD_FIXTURE_NOW = new Date("2026-10-05T17:00:00Z");
export const QOTD_FIXTURE_TODAY = file.generated_on;

export const QOTD_ARCHIVE_ROWS: readonly QotdRow[] = file.archive;

export function qotdTodayRow(): QotdRow {
  const row = file.today[0];
  if (!row) throw new Error("fixture has no today row");
  return { ...row };
}

export function qotdArchiveRow(date: string): QotdRow {
  const row = file.archive.find((r) => r.qotd_date === date);
  if (!row) throw new Error(`fixture has no archive row for ${date}`);
  return { ...row };
}

/** The archive days the prerender builds from, via the real projection. */
export function qotdArchiveDays(): QotdArchiveResponse[] {
  return file.archive.map(toArchiveResponse);
}
