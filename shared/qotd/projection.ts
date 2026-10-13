/**
 * Question of the Day: the database row, and the archive projection of a past day.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R20a (the dated archive is the one public
 *       exposure of bank content), Q2, Q3; Coding Standards §7.1 (parse at every boundary), §7.2
 *       (one schema, shared); owner Step 0 decisions 2026-10-05 (canonical option order; archive
 *       pages prerendered at build time)] | @implemented [2026-10-05]
 *
 * plain English: one parse of what qotd_question_for / qotd_archive return, and one projection of
 * a past day into the archive payload. The API route (server/services/qotd/qotd-service.ts) and
 * the build-time prerender (client/src/prerender/entry-server.tsx) both use these, so the archive
 * page a crawler reads and the archive response the browser fetches cannot drift apart.
 *
 * Server and build only: it imports the canonical bank contract, which the browser bundle does
 * not load.
 */
import { z } from "zod";
import {
  normalizeAnswerKey,
  parseCanonicalMcOptions,
} from "../question-bank-contract";
import {
  qotdArchiveIndexResponseSchema,
  qotdArchiveResponseSchema,
  qotdStat,
  type QotdArchiveIndexResponse,
  type QotdArchiveResponse,
  type QotdOption,
} from "../../packages/shared/src/qotd-schema";

export const qotdRowSchema = z.object({
  qotd_date: z.string(),
  question_id: z.string(),
  section: z.enum(["M", "RW"]),
  domain: z.string(),
  skill_codes: z.array(z.string()).nullable(),
  difficulty: z.number().nullable(),
  item_type: z.enum(["mcq", "grid_in"]),
  stem: z.string(),
  passage: z.string().nullable(),
  options: z.unknown(),
  correct_answer: z.string().nullable(),
  correct_variants: z.array(z.string()).nullable(),
  explanation: z.string().nullable(),
  attempts: z.number().int().nonnegative().optional(),
  correct: z.number().int().nonnegative().optional(),
});
export type QotdRow = z.infer<typeof qotdRowSchema>;

/**
 * A question whose stem repeats its passage word for word has no question prompt: posted, it asks
 * nothing. Seventeen published questions carry this defect, the live 2026-10-07 QOTD among them
 * (owner 2026-10-08: repairing them belongs to the questions vertical). The scheduler skips them
 * and the social generator refuses them, both through this one predicate. Whitespace is
 * collapsed so a trailing newline or a doubled space cannot hide a copy. Pure.
 */
export function stemRepeatsPassage(
  stem: string,
  passage: string | null,
): boolean {
  const norm = (text: string): string => text.replace(/\s+/g, " ").trim();
  const p = norm(passage ?? "");
  return p.length > 0 && norm(stem) === p;
}

/** Options in authored (canonical) order, each carrying its canonical key as its id. */
export function qotdServedOptions(row: QotdRow): QotdOption[] {
  if (row.item_type === "grid_in") return [];
  return parseCanonicalMcOptions(row.options).map((o) => ({
    id: o.key as QotdOption["id"],
    text: o.text,
  }));
}

export function qotdCorrectOptionId(row: QotdRow): QotdOption["id"] | null {
  if (row.item_type !== "mcq") return null;
  const key = normalizeAnswerKey(row.correct_answer);
  return key as QotdOption["id"] | null;
}

/** A past day with its answer and explanation (the archive), parsed against the strict schema. */
export function toArchiveResponse(row: QotdRow): QotdArchiveResponse {
  return qotdArchiveResponseSchema.parse({
    qotd_date: row.qotd_date,
    question: {
      section_code: row.section,
      domain: row.domain,
      item_type: row.item_type,
      stem: row.stem,
      passage:
        row.passage && row.passage.trim().length > 0 ? row.passage : null,
      options: qotdServedOptions(row),
      correct_option_id: qotdCorrectOptionId(row),
      correct_answer: row.item_type === "grid_in" ? row.correct_answer : null,
      explanation: row.explanation ?? "",
    },
    stats: qotdStat(row.attempts ?? 0, row.correct ?? 0),
  });
}

/** The hub's archive list (date, section, domain), newest first, parsed against the strict schema. */
export function toArchiveIndex(
  days: readonly {
    qotd_date: string;
    section_code: "M" | "RW";
    domain: string;
  }[],
): QotdArchiveIndexResponse {
  return qotdArchiveIndexResponseSchema.parse({
    days: [...days]
      .sort((a, b) =>
        a.qotd_date < b.qotd_date ? 1 : a.qotd_date > b.qotd_date ? -1 : 0,
      )
      .map((d) => ({
        qotd_date: d.qotd_date,
        section_code: d.section_code,
        domain: d.domain,
      })),
  });
}
