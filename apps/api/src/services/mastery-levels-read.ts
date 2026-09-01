import { getSupabaseAdmin } from "../lib/supabase-admin";
import {
  masteryLevelLabelSchema,
  MASTERY_LEVEL_KEYS,
  type MasteryLevelLabel,
} from "../../../../packages/shared/src/mastery-levels";

/**
 * @spec [Doc 05 Parent §4.5, Acceptance Criteria #19/#20; owner ruling 2026-08-20
 *   RULE 1 (the six names), RULE 3 (`unmeasured` is a row, not a code branch)]
 * | @implemented [2026-08-20]
 *
 * plain English: loads the six display names out of `public.mastery_levels` and hands
 * back a lookup from the integer the mastery formula emitted (or NULL) to the name a
 * student sees. Reference data: read once per process, never written at runtime.
 *
 * WHY THIS THROWS INSTEAD OF FALLING BACK.
 *   Every previous conflation of NULL with level 0 was a CASE statement whose author
 *   did not write the NULL arm, and each one rendered a student's unmeasured skill as
 *   their weakest. There is deliberately no default branch here: an unlabelled level
 *   raises, and a route that cannot label a level answers 500 rather than inventing a
 *   name. RULE 3 is "must fail, not fall back."
 *
 * WHY AN EMPTY TABLE IS AN ERROR, NOT AN EMPTY RESULT.
 *   `mastery_levels` is seeded by its own migration. Zero rows therefore means the
 *   migration has not been applied to this database — a deployment fault. Returning an
 *   empty lookup would let every surface render "" for every level, which reads as
 *   working software. Empty and failed are different answers, and only one of them is
 *   representable here.
 *
 * expected outcome: one process-lifetime read; every level 0-4 plus `unmeasured`
 * resolvable; anything else raises with the offending level named.
 * trade-offs: the process cache means a name change needs a restart as well as a
 * migration. That is correct for locked owner vocabulary and wrong for configuration —
 * which is why nothing configurable is allowed in this table (RULE 2).
 * edge cases: a rejected load is NOT cached, so a transient database failure does not
 * permanently disable the mastery surfaces.
 */

export type MasteryLevelLabels = {
  /** The label for a level the formula emitted, or for NULL (the unmeasured state). */
  forLevel(level: number | null): MasteryLevelLabel;
  /** All six labels, in the table's own `sort_order`. */
  all(): readonly MasteryLevelLabel[];
};

type MasteryLevelRow = {
  level_key: unknown;
  level: unknown;
  display_name: unknown;
  sort_order: unknown;
};

/** The levels the mastery formula can emit. Mirrors `mastery_levels_level_range`. */
const EMITTABLE_LEVELS = [0, 1, 2, 3, 4] as const;

let cached: MasteryLevelLabels | null = null;
let inflight: Promise<MasteryLevelLabels> | null = null;

function indexLabels(labels: MasteryLevelLabel[]): MasteryLevelLabels {
  const byLevel = new Map<number, MasteryLevelLabel>();
  let unmeasured: MasteryLevelLabel | null = null;

  for (const label of labels) {
    if (label.level === null) {
      unmeasured = label;
      continue;
    }
    if (byLevel.has(label.level)) {
      throw new Error(
        `mastery_levels_duplicate_level: level ${label.level} is labelled more than once`,
      );
    }
    byLevel.set(label.level, label);
  }

  // Driven from the levels the FORMULA can emit, not from the rows we happen to have
  // read. Counting the table's own rows can only ever report what is present; this
  // asks the opposite question, which is the one that catches a missing label.
  for (const level of EMITTABLE_LEVELS) {
    if (!byLevel.has(level)) {
      throw new Error(
        `mastery_levels_missing_label: the formula can emit level ${level} but mastery_levels has no row for it`,
      );
    }
  }
  if (!unmeasured) {
    throw new Error(
      "mastery_levels_missing_label: no row carries a NULL level, so the unmeasured state has no name",
    );
  }

  const resolvedUnmeasured = unmeasured;
  const ordered = [...labels];

  return {
    forLevel(level: number | null): MasteryLevelLabel {
      if (level === null) {
        return resolvedUnmeasured;
      }
      const label = byLevel.get(level);
      if (!label) {
        throw new Error(
          `mastery_levels_unlabelled_level: no display name for mastery level ${level}`,
        );
      }
      return label;
    },
    all(): readonly MasteryLevelLabel[] {
      return ordered;
    },
  };
}

async function fetchAndIndex(): Promise<MasteryLevelLabels> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("mastery_levels")
    .select("level_key, level, display_name, sort_order")
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`mastery_levels_query_failed: ${error.message}`);
  }
  const rows = (data ?? []) as MasteryLevelRow[];
  if (rows.length === 0) {
    throw new Error(
      "mastery_levels_empty: public.mastery_levels holds no rows — migration 20260820000000 has not been applied to this database",
    );
  }

  const labels = rows.map((row) => {
    const parsed = masteryLevelLabelSchema.safeParse({
      levelKey: row.level_key,
      level:
        row.level === null || row.level === undefined
          ? null
          : Number(row.level),
      displayName: row.display_name,
    });
    if (!parsed.success) {
      throw new Error(
        `mastery_levels_invalid_row: level_key=${String(row.level_key)} ` +
          `level=${String(row.level)} — ${parsed.error.issues.map((i) => i.message).join("; ")}`,
      );
    }
    return parsed.data;
  });

  const knownKeys = new Set<string>(MASTERY_LEVEL_KEYS);
  for (const label of labels) {
    if (!knownKeys.has(label.levelKey)) {
      throw new Error(
        `mastery_levels_unknown_key: ${label.levelKey} is not one of the six owner-ruled keys`,
      );
    }
  }

  return indexLabels(labels);
}

export async function loadMasteryLevels(): Promise<MasteryLevelLabels> {
  if (cached) {
    return cached;
  }
  if (!inflight) {
    inflight = fetchAndIndex().then(
      (value) => {
        cached = value;
        inflight = null;
        return value;
      },
      (err: unknown) => {
        inflight = null;
        throw err;
      },
    );
  }
  return inflight;
}

/** Test-only: drops the process cache so a suite can vary the seeded rows. */
export function resetMasteryLevelsCache(): void {
  cached = null;
  inflight = null;
}
