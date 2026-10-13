/**
 * "Find your blind spots" — the student-facing name of the diagnostic.
 *
 * @spec [owner brief "Student dashboard — Getting started checklist + onboarding update" (final
 *       brief v2, Karl, 2026-10-13) §7 "'Diagnostic' becomes 'Find your blind spots', with the
 *       subtitle '40 questions · about 40 minutes'"; in-app only] | @implemented [2026-10-13]
 *
 * plain English: one place for the renamed copy, so Home, Practice, the checklist, the session
 * labels and the start/loading/error messages say the same thing. The question count is the
 * server's (`diagnosticTotalQuestions`, OQ-68 (d)); the minutes are Karl's stated estimate. The
 * public homepage and articles are NOT renamed (a separate SEO decision), and internal names,
 * routes and analytics events keep "diagnostic".
 */
export const BLIND_SPOTS_NAME = "Find your blind spots";

/** Karl's stated estimate (final brief v2 §7). */
export const BLIND_SPOTS_MINUTES = 40;

/** "40 questions · about 40 minutes"; without a count (the read failed), just the time. */
export function blindSpotsSubtitle(totalQuestions: number | null): string {
  const minutes = `about ${BLIND_SPOTS_MINUTES} minutes`;
  return totalQuestions === null
    ? `About ${BLIND_SPOTS_MINUTES} minutes`
    : `${totalQuestions} questions · ${minutes}`;
}

/** Ruling 4 (Karl, 2026-10-13): the Question of the Day's line. */
export const QOTD_BLIND_SPOTS_LINE =
  "One question a day keeps the blind spots at bay.";
