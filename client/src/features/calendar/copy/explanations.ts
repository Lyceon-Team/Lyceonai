/**
 * @spec [Doc_05F_Study_Calendar, §17.6 "why this block" copy (student only)]
 *       [Doc_05F_formula_sheet.md §8 item 16 — copy table re-keyed to what the generators emit]
 * @implemented [2026-09-23]
 *
 * plain English: turns an `explanation_key` into the sentence a student reads. Expected
 * outcome: every key the generators can emit has copy, and no key ever renders as raw text.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * PROVENANCE, AND THE ONE THING THE OWNER STILL HAS TO RULE ON
 *
 * Formula-sheet item 16 RE-KEYED this table to the vocabulary the generators actually emit
 * and retired `weak_domain`, `maintain_strength`, `post_exam_focus` and `spacing_revisit`.
 * It did not supply replacement sentences, and Doc 05F §17.6 still carries the retired keys
 * — `packages/shared/src/calendar/scope.ts` flags exactly this gap in its module header. So
 * the strings below come from three places, marked per entry:
 *
 *   [P]  the approved prototype, `docs/design/calendar-prototype.html` — its `WHY` map is
 *        written against the CURRENT vocabulary and is the design of record for this screen.
 *   [S]  Doc 05F §17.6, for the one key the re-key left unchanged.
 *   [O]  OWNER RULING 2026-09-22, which closed the gap item 16 left open.
 *
 * Nothing here is invented any more. The four strings that were proposed in this file
 * pending a decision have been replaced by the owner's wording, and `weighted` was ruled to
 * have NO block-level copy at all — see the note beside it. The ruling is recorded in
 * `docs/plans/Doc_05F_Change_Record_Addendum.md` as item 16.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * trade-offs: the lookup is TOTAL over `string | null`, not an exhaustive switch over the
 * two enums. `explanation_key` is `z.string().nullable()` on the wire because V-09 constrains
 * `generated` plans only — a student edit may carry any string and the database stores it.
 * An exhaustive switch would be a lie the compiler believes.
 *
 * edge cases: an unknown key returns `null`, and a null return renders NO info affordance at
 * all — not an empty popover and never the key itself. §16 gives a guardian no explanation
 * copy, and the guardian payload has no `explanation_key` at either level, so nothing on
 * that surface can call this.
 */

/** Block-level copy — `BLOCK_EXPLANATION_KEYS` in `packages/shared/src/calendar/scope.ts`. */
const BLOCK_COPY: Readonly<Record<string, string>> = {
  /** [P] */ review_due: "Questions you missed earlier are due for a retry.",
  /** [P] */ exam_review_placeholder:
    "Going over what you missed on your last practice test.",
  /** [P] */ exam_cadence:
    "A full-length every two weeks keeps you test-ready.",
  /** [P] */ final_rehearsal: "Your last full rehearsal before test day.",
  /** [S] */ cold_start:
    "We're still learning where you stand — this balances the sections.",
  /** [O] */ exam_review:
    "Going over what you missed on your last full-length.",
  /** [O] */ taper: "Test week: lighter days so you arrive rested.",
  /** [O] */ fallback:
    "A balanced session while we catch up on your progress data.",
  // `weighted` is DELIBERATELY ABSENT, by the same ruling. It is the block-level key on a
  // practice block that has a domain mix, and the mix's own per-domain reasons are both
  // more specific and already shown — `explanationLines` prefers them. A generic sentence
  // above them would say less and take more room. `blockExplanation("weighted")` returns
  // null, which renders no panel, and a `section`-level practice block carries `cold_start`
  // rather than `weighted`, so nothing is left unexplained.
};

/** Per-domain copy — `DOMAIN_EXPLANATION_KEYS` in the same module. */
const DOMAIN_COPY: Readonly<Record<string, string>> = {
  /** [P] */ weak: "One of your weaker areas right now.",
  /** [P] */ balanced: "Keeping this one moving.",
  /** [P] */ strength: "You're strong here — a short set keeps it sharp.",
  /** [P] */ exploring: "We haven't seen enough of this yet.",
  /** [P] */ post_exam: "Your last test pointed here.",
};

/**
 * The sentence for a BLOCK-level key, or null when there is none.
 *
 * Null is a rendering instruction, not a failure: the caller shows no "why this is here"
 * panel. A student edit can carry any string, and a block the student built themselves does
 * not need the system to explain it back to them.
 */
export function blockExplanation(key: string | null): string | null {
  return lookup(BLOCK_COPY, key);
}

/** The sentence for a PER-DOMAIN key, or null when there is none. */
export function domainExplanation(key: string | null): string | null {
  return lookup(DOMAIN_COPY, key);
}

/**
 * OWN properties only. `table[key] ?? null` looks the key up the PROTOTYPE CHAIN, so
 * `explanation_key: "toString"` returns `Object.prototype.toString` — a function, which
 * `??` never replaces and which TypeScript believes is a `string`. It would reach the
 * "Why this is here" panel and render as `function toString() { [native code] }`.
 *
 * Not hypothetical: `explanation_key` is `z.string().nullable()` on the wire precisely
 * because V-09 constrains generated plans only and a student edit may carry ANY string,
 * which the database stores. This lookup is the one that has to be total, so it is the one
 * that has to be safe. `constructor`, `valueOf` and `hasOwnProperty` are the same hole.
 */
function lookup(
  table: Readonly<Record<string, string>>,
  key: string | null,
): string | null {
  if (key === null) return null;
  // `Object.hasOwn` would be clearer but needs lib ES2022; this build targets lower.
  return Object.prototype.hasOwnProperty.call(table, key)
    ? (table[key] ?? null)
    : null;
}

/**
 * The lines shown under "Why this is here" for one block.
 *
 * A practice block with a mix explains itself through its DOMAINS, exactly as the prototype
 * does: the per-domain reasons are specific ("One of your weaker areas right now") where the
 * block key that covers them is generic ("weighted"). De-duplicated, because three domains
 * that are all `weak` is one reason, not three.
 *
 * Any block without a mix falls back to its own key. A block with a mix whose domain keys
 * are all unknown falls back too, rather than rendering nothing — the panel disappears only
 * when there is genuinely no copy to show.
 */
export function explanationLines(input: {
  blockKey: string | null;
  domainKeys?: readonly (string | null)[];
}): readonly string[] {
  const fromDomains = (input.domainKeys ?? [])
    .map(domainExplanation)
    .filter((line): line is string => line !== null);
  const deduped = [...new Set(fromDomains)];
  if (deduped.length > 0) return deduped;

  const fromBlock = blockExplanation(input.blockKey);
  return fromBlock === null ? [] : [fromBlock];
}

/** Exported for the test that proves every canonical key has copy. */
export const EXPLANATION_COPY_TABLES = {
  block: BLOCK_COPY,
  domain: DOMAIN_COPY,
} as const;
