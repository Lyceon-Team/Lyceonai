/**
 * The canonical SAT (section, domain) pairing — single source of truth, browser-safe.
 *
 * Moved verbatim from `question-bank-contract.ts` on 2026-10-01, which re-exports it: that
 * module imports Node's `crypto`, so the client (which must draw all eight domains, owner
 * decision 2026-10-01 on PR 1003) could only import TYPES from it. Same pattern as
 * `canonical-id.ts`. This module has no Node.js dependencies.
 */

/**
 * @spec [Doc-05B_V1.0 §4.2 domain canonicality is BLOCKING in 05B] | @implemented [2026-08-16]
 * plain English: the canonical (section, domain) pairing, single-sourced. It mirrors
 * the two lists inside refresh_domain_mastery exactly — that function raises
 * DOMAIN_SECTION_MISMATCH on anything else and rolls back the whole mastery event,
 * so a drifted string here is not cosmetic. Note 'Problem Solving and Data Analysis'
 * has NO hyphen. The DB enforces the same pairing independently
 * (questions_domain_section_canonical / psi_question_domain_section_canonical);
 * this is the application-side source, not a substitute for that floor.
 */
export const CANONICAL_DOMAINS_BY_SECTION: Readonly<
  Record<"M" | "RW", readonly string[]>
> = {
  M: [
    "Algebra",
    "Advanced Math",
    "Problem Solving and Data Analysis",
    "Geometry and Trigonometry",
  ],
  RW: [
    "Craft and Structure",
    "Information and Ideas",
    "Standard English Conventions",
    "Expression of Ideas",
  ],
};
