/**
 * The criteria a practice or review session was started with, as the student chose them.
 *
 * @spec [student-UI register §9 OQ-22, owner ruling (Karl) 2026-10-02: "The chosen criteria
 *        on practice and review `/state` and `/sessions/open`, with no counts."; wiring table
 *        §14 OQ-22: `criteria: {sections, domains, skills, difficulties}`, never the raw
 *        `filters`; register §2 Content rules: students never see bank counts]
 *        | @implemented [2026-10-03]
 *
 * plain English: one shape for both engines, so the runner title and the open-session rows
 * on Home, Practice and Review can name a session ("Math: Algebra") from what the student
 * picked. expected outcome: exactly four arrays of chosen values, and nothing else: no pool
 * size, no requested count, no idempotency key, no other key from the stored `filters`.
 * The schema is `.strict()` so a fifth key fails it.
 *
 * Rule for "nothing chosen": a criterion that was not chosen is an EMPTY ARRAY, never null
 * and never absent. That covers a missing spec (diagnostic sessions, review queue mode,
 * review "redo a past session" mode, rows written before the spec existed), a stored null,
 * and a stored non-array. Empty arrays mean "no constraint", which is what the pool
 * selection already does with them (select_practice_pool_random; review-pool matchesFilter).
 *
 * trade-offs: values are the stored selection, not display labels; the client labels them.
 * Practice stores normalised values (canonical section codes, canonical domains, sorted);
 * review stores the filter as sent. Each engine projects through `toSessionCriteria`, and
 * review passes its own difficulty rule so its criteria say what its pool actually applied.
 * edge cases: non-string and empty-string entries are dropped (the pool drops them too);
 * duplicates are dropped, first occurrence kept.
 */
import { z } from "zod";

export const SESSION_CRITERIA_DIFFICULTIES = [
  "easy",
  "medium",
  "hard",
] as const;
export const sessionCriteriaDifficultySchema = z.enum(
  SESSION_CRITERIA_DIFFICULTIES,
);
export type SessionCriteriaDifficulty = z.infer<
  typeof sessionCriteriaDifficultySchema
>;

export const sessionCriteriaSchema = z
  .object({
    sections: z.array(z.string().min(1)),
    domains: z.array(z.string().min(1)),
    skills: z.array(z.string().min(1)),
    difficulties: z.array(sessionCriteriaDifficultySchema),
  })
  .strict();
export type SessionCriteria = z.infer<typeof sessionCriteriaSchema>;

/** Non-empty strings from a stored list, deduplicated, first occurrence kept. */
function chosenValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length === 0) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** Practice's rule: the stored value is already one of the three labels, or it is dropped. */
function exactDifficulty(token: string): SessionCriteriaDifficulty | null {
  const parsed = sessionCriteriaDifficultySchema.safeParse(token);
  return parsed.success ? parsed.data : null;
}

/**
 * Projects a stored spec object (practice `filters.session_spec`, review `filters`) to the
 * four criteria arrays. Builds a fresh object key by key; nothing from `stored` is spread,
 * so no other stored key can reach a response through this function.
 */
export function toSessionCriteria(
  stored: unknown,
  difficultyLabel: (
    token: string,
  ) => SessionCriteriaDifficulty | null = exactDifficulty,
): SessionCriteria {
  const spec =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const difficulties: SessionCriteriaDifficulty[] = [];
  for (const token of chosenValues(spec.difficulties)) {
    const label = difficultyLabel(token);
    if (label !== null && !difficulties.includes(label))
      difficulties.push(label);
  }
  return {
    sections: chosenValues(spec.sections),
    domains: chosenValues(spec.domains),
    skills: chosenValues(spec.skills),
    difficulties,
  };
}
