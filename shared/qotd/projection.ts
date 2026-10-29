/**
 * Question of the Day: the database row, and the archive projection of a past day.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R20a (the dated archive is the one public
 *       exposure of bank content), Q2, Q3; Coding Standards §7.1 (parse at every boundary), §7.2
 *       (one schema, shared); owner Step 0 decisions 2026-10-05 (archive pages prerendered at
 *       build time); Karl's rulings 2026-10-28, SCL-258 (the options are shuffled once, in the
 *       database, when a day is scheduled; the stored order and letter are served everywhere;
 *       this supersedes the 2026-10-05 / 2026-10-23 "canonical order everywhere")]
 *       | @implemented [2026-10-05, served order 2026-10-28]
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
  /** The canonical keys in the order this day shows them (SCL-258). '{}' for a grid-in. */
  option_order: z.array(z.string()),
  /** The correct option's letter in option_order, written by the database. Null for a grid-in. */
  correct_display_letter: z.string().nullable(),
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

const DISPLAY_LETTERS = ["A", "B", "C", "D"] as const;
type DisplayLetter = (typeof DISPLAY_LETTERS)[number];

/**
 * A stored day whose order does not fit its question. The message names the day and the reason
 * only, never a key or a letter: it reaches logs and the social run's Slack notice, and for today
 * a letter would be the answer.
 */
export class QotdServedOrderError extends Error {
  readonly code = "qotd_served_order_mismatch" as const;
  readonly reason: string;
  constructor(qotdDate: string, reason: string) {
    super(`QOTD ${qotdDate}: stored option order refused (${reason})`);
    this.name = "QotdServedOrderError";
    this.reason = reason;
  }
}

export type QotdServedChoices = {
  /** The options in the order the day shows them, each carrying its canonical key as its id. */
  options: QotdOption[];
  /** The letter the correct option is shown under. Null for a grid-in. */
  correctLetter: DisplayLetter | null;
};

/**
 * THE served order (Karl, 2026-10-28; SCL-258). Every surface letters a day from this: the site,
 * the dashboard, the archive, the image, the Reddit post, the alt text, the reveal, the TikTok
 * slides and the practice item. It reads the order the database stored at scheduling, derives the
 * correct letter from it, and REFUSES the row (QotdServedOrderError) when the order is not a
 * permutation of the question's options or the derived letter disagrees with the stored one.
 * There is no fallback to canonical order: a refused row is an error the caller surfaces. Pure.
 */
export function qotdServedChoices(row: QotdRow): QotdServedChoices {
  if (row.item_type === "grid_in") {
    if (row.option_order.length !== 0 || row.correct_display_letter !== null) {
      throw new QotdServedOrderError(row.qotd_date, "grid-in carries an order");
    }
    return { options: [], correctLetter: null };
  }
  const byKey = new Map<string, string>(
    parseCanonicalMcOptions(row.options).map((o) => [o.key, o.text] as const),
  );
  const order = row.option_order;
  const options: QotdOption[] = [];
  for (const key of order) {
    const text = byKey.get(key);
    if (text === undefined) break;
    options.push({ id: key as QotdOption["id"], text });
  }
  if (
    order.length === 0 ||
    options.length !== order.length ||
    order.length !== byKey.size ||
    new Set(order).size !== order.length
  ) {
    throw new QotdServedOrderError(
      row.qotd_date,
      "order is not a permutation of the options",
    );
  }
  const correctKey = normalizeAnswerKey(row.correct_answer);
  const index = correctKey === null ? -1 : order.indexOf(correctKey);
  const derived = DISPLAY_LETTERS[index];
  if (derived === undefined) {
    throw new QotdServedOrderError(row.qotd_date, "answer is not in the order");
  }
  if (derived !== row.correct_display_letter) {
    throw new QotdServedOrderError(
      row.qotd_date,
      "stored letter disagrees with the order",
    );
  }
  return { options, correctLetter: derived };
}

/** Options in the served order (qotdServedChoices), each carrying its canonical key as its id. */
export function qotdServedOptions(row: QotdRow): QotdOption[] {
  return qotdServedChoices(row).options;
}

/** The correct option's canonical key (its id in qotdServedOptions). */
export function qotdCorrectOptionId(row: QotdRow): QotdOption["id"] | null {
  if (row.item_type !== "mcq") return null;
  const key = normalizeAnswerKey(row.correct_answer);
  return key as QotdOption["id"] | null;
}

/** A past day with its answer and explanation (the archive), parsed against the strict schema. */
export function toArchiveResponse(row: QotdRow): QotdArchiveResponse {
  const choices = qotdServedChoices(row);
  return qotdArchiveResponseSchema.parse({
    qotd_date: row.qotd_date,
    question: {
      section_code: row.section,
      domain: row.domain,
      item_type: row.item_type,
      stem: row.stem,
      passage:
        row.passage && row.passage.trim().length > 0 ? row.passage : null,
      options: choices.options,
      correct_option_id: qotdCorrectOptionId(row),
      correct_letter: choices.correctLetter,
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
