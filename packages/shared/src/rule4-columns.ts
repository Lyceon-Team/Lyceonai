/**
 * @spec [Doc 05 Parent AC#20 (RB-05P-V1-14) — student and guardian read surfaces expose
 *   `mastery_level` only; `mastery_score`/`mastery_pct` are admin/internal/audit-only;
 *   Doc 05B §6.7 + §10.5 KPI admin-only columns; Doc 05C §10.5 projection blend anchors;
 *   owner ruling 2026-08-20 RULE 4] | @implemented [2026-08-27]
 *
 * plain English: the columns that may never cross to a student or guardian, at any depth of
 * any response. ONE list, consumed by every anti-leak gate.
 *
 * WHY THIS IS A SHARED MODULE AND NOT A CONSTANT IN A TEST FILE.
 *   It was a `const` inside tests/ci/guardian.anti-leak.ci.test.ts. A second gate needing the
 *   same list would have copied it, and two lists for one fact is precisely the shape that
 *   let SAT_TAXONOMY's slugs diverge from the database unnoticed. Adding a column to the
 *   forbidden set must be one edit, not a search for every copy.
 *
 * A NOTE ON WHAT IS *NOT* HERE. Bare `accuracy` is absent deliberately. It is forbidden on
 * the MASTERY surface, where an accuracy figure is the probability framing RULE 4 bans, but
 * sanctioned on the KPI surface by the owner ruling of 2026-08-23: a 7-day accuracy the
 * student sees on their own dashboard is not raw internal machinery, it is the same derived
 * aggregate read through a gate. Surface-specific extras belong with their surface's gate.
 *
 * LEAKS ARE NOT ONLY PROJECTIONS. A forbidden column also leaks through ORDER BY, through a
 * filter predicate, and through a pagination boundary — the ranking carries the column's
 * information content even when the value never appears in the body. That is what retired the
 * weakest-skills routes, which ranked by `mastery_score` (owner ruling 2026-08-27, OQ4). A recursive key-walk cannot see it; only reading the query can.
 */
export const RULE_4_COLUMNS = [
  // Doc 05A §7.4 / Parent AC#20 — mastery internals.
  "mastery_score",
  "mastery_pct",
  "acc_test",
  "acc_practice",
  "acc_review",
  "event_count_total",
  "constants_snapshot_hash",
  "mastery_model_version",
  "last_event_id",
  "last_event_occurred_at",
  "confidence",
  // Doc 05B §6.7 / §10.5 — KPI admin-only columns.
  "refreshed_at",
  "refreshed_at_t_now",
  "kpi_refresh_version",
  // Doc 05C §10.5 — projection blend anchors.
  "mastery_term",
  "fl1_score",
  "fl2_score",
  "blend_denominator",
  "projection_constants_hash",
] as const;

export type Rule4Column = (typeof RULE_4_COLUMNS)[number];

/** Every key path in an object tree whose leaf key is a RULE-4 column. */
export function findRule4Keys(value: unknown, prefix = "", into: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) findRule4Keys(entry, `${prefix}[]`, into);
    return into;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if ((RULE_4_COLUMNS as readonly string[]).includes(key)) into.push(path);
      findRule4Keys(child, path, into);
    }
  }
  return into;
}
