/**
 * @spec [Doc-04B_V4.3 §11.2; CodingStandards_v1 §9] | @implemented [2026-09-02]
 * THE section display mapping. The single place in the repository where a section
 * value is turned into human-readable text.
 *
 * plain English: internally a section is always the canonical code the database
 * stores — 'M' or 'RW' (16 CHECK constraints, `questions_section_check` and its
 * siblings). Long forms like "Math" and "Reading & Writing" are RENDER OUTPUT and
 * nothing else: they are never compared, never stored, never sent to a query. This
 * module produces them; `scripts/ci/section-vocabulary-gate.mjs` fails the build if
 * any other non-display file spells one out.
 *
 * expected outcome: one label per section, identical on every surface.
 * trade-offs: callers that need a label must import rather than inline a ternary —
 * which is the point. Eleven files previously inlined it and two of them imported
 * `isMathSection` from here and then hand-rolled the label, so the module and its own
 * consumers disagreed on the RW label ("R&W" here, "Reading & Writing" everywhere
 * else). "Reading & Writing" won on both count and consumer intent.
 * edge cases: unknown input returns null / false — never a defaulted section. A
 * calculator must not appear because a section string was unrecognised, and a card
 * must not read "Math" because a value was missing.
 */

import type { CanonicalSectionCode } from "./question-bank-contract";

/**
 * Accepted inputs are the canonical codes and the four exam module ids
 * (`exam-form-builder.ts` `ModuleId`), case-insensitively. Nothing else: the
 * display-form and MATH vocabularies were deleted in this change, so a caller
 * holding one of those has a bug that should surface as `null`, not be absorbed.
 *
 * The two sets are deliberately symmetric. They were not: MATH_TOKENS carried the
 * 'm1'/'m2' module ids while RW_TOKENS omitted 'rw1'/'rw2', so
 * sectionDisplayLabel('M1') returned "Math" and sectionDisplayLabel('RW1') returned
 * null for the same shape of input.
 */
const MATH_TOKENS: ReadonlySet<string> = new Set(["m", "m1", "m2"]);
const RW_TOKENS: ReadonlySet<string> = new Set(["rw", "rw1", "rw2"]);

/** The rendered long forms. Defined once; exported so tests can assert on them. */
export const SECTION_LABEL_MATH = "Math" as const;
export const SECTION_LABEL_RW = "Reading & Writing" as const;

export type SectionDisplayLabel =
  | typeof SECTION_LABEL_MATH
  | typeof SECTION_LABEL_RW;

function token(section: string | null | undefined): string {
  return typeof section === "string" ? section.trim().toLowerCase() : "";
}

export function isMathSection(section: string | null | undefined): boolean {
  return MATH_TOKENS.has(token(section));
}

export function isRwSection(section: string | null | undefined): boolean {
  return RW_TOKENS.has(token(section));
}

/**
 * Canonicalises a display-layer input to the section code it belongs to. Returns
 * null for anything unrecognised — callers render a neutral label rather than guess.
 */
export function sectionCodeForDisplay(
  section: string | null | undefined,
): CanonicalSectionCode | null {
  if (isMathSection(section)) return "M";
  if (isRwSection(section)) return "RW";
  return null;
}

export function sectionDisplayLabel(
  section: string | null | undefined,
): SectionDisplayLabel | null {
  const code = sectionCodeForDisplay(section);
  if (code === "M") return SECTION_LABEL_MATH;
  if (code === "RW") return SECTION_LABEL_RW;
  return null;
}

/**
 * The exact inverse of `sectionDisplayLabel`: a rendered label back to its code.
 *
 * plain English: this exists for one reason — the calendar persists task summaries as
 * already-rendered display text in a jsonb blob, so reading that blob back requires
 * turning a label into a code. That is the only legitimate label→code direction, and
 * keeping it here means the long forms still appear in exactly one file. Every other
 * caller should hold the code and render late.
 *
 * edge cases: accepts the codes too, so a caller reading a mixed-vintage blob does not
 * need to know which form it is holding. "R&W" is accepted because this module emitted
 * it before this change and old rows may carry it. Unknown input returns null.
 */
const LABEL_TO_CODE: ReadonlyMap<string, CanonicalSectionCode> = new Map([
  [SECTION_LABEL_MATH.toLowerCase(), "M"],
  [SECTION_LABEL_RW.toLowerCase(), "RW"],
  ["reading and writing", "RW"],
  ["r&w", "RW"],
]);

export function sectionCodeFromLabel(
  label: string | null | undefined,
): CanonicalSectionCode | null {
  const key = token(label);
  return LABEL_TO_CODE.get(key) ?? sectionCodeForDisplay(label);
}

/**
 * The same mapping for callers that must render something for an unknown value.
 * Explicit fallback at the call site beats a silent default inside the mapping.
 */
export function sectionDisplayLabelOr<T extends string>(
  section: string | null | undefined,
  fallback: T,
): SectionDisplayLabel | T {
  return sectionDisplayLabel(section) ?? fallback;
}
