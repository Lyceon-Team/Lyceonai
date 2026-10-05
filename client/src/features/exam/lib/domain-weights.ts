/**
 * The exam report's domain weight lines: what share of each section a domain is, and how many
 * questions it has, per College Board's published test specification.
 *
 * @spec [DESIGN.md §4 "Exam report" ("Domain weight lines come from College Board's published
 *        specification"); evidence/wiring-table.md §8 ("Domain weight lines (College Board,
 *        static) | none needed | Client only (static constant)"); prototype Report.dc.html
 *        `LYC_REPORT` (the wording, copied verbatim)] | @implemented [2026-10-03]
 *
 * plain English: a static description of the SAT, not of the student. Source: the domain
 * tables of College Board's "Assessment Framework for the Digital SAT Suite" and its "What's on
 * the SAT" pages (Reading and Writing: Information and Ideas ≈26%, 12–14 questions; Craft and
 * Structure ≈28%, 13–15; Expression of Ideas ≈20%, 8–12; Standard English Conventions ≈26%,
 * 11–15. Math: Algebra ≈35%, 13–15; Advanced Math ≈35%, 13–15; Problem Solving and Data
 * Analysis ≈15%, 5–7; Geometry and Trigonometry ≈15%, 5–7). The strings are the prototype's.
 *
 * trade-offs: these numbers are College Board's ranges for the real test, never this student's
 * counts and never this form's (the student payload carries neither, ruling 7). A domain name the
 * table does not know draws no line rather than a guessed one.
 */
import type { ExamSection } from "@lyceon/shared/exam-runtime-schema";

const DOMAIN_WEIGHT_LINES: Readonly<
  Record<ExamSection, Readonly<Record<string, string>>>
> = {
  RW: {
    "Information and Ideas": "26% of the section, 12 to 14 questions",
    "Craft and Structure": "28% of the section, 13 to 15 questions",
    "Expression of Ideas": "20% of the section, 8 to 12 questions",
    "Standard English Conventions": "26% of the section, 11 to 15 questions",
  },
  M: {
    Algebra: "35% of the section, 13 to 15 questions",
    "Advanced Math": "35% of the section, 13 to 15 questions",
    "Problem Solving and Data Analysis": "15% of the section, 5 to 7 questions",
    "Geometry and Trigonometry": "15% of the section, 5 to 7 questions",
  },
};

/** The published weight line for a domain, or null when the table does not name it. */
export function domainWeightLine(
  section: ExamSection,
  domain: string,
): string | null {
  return DOMAIN_WEIGHT_LINES[section][domain] ?? null;
}
