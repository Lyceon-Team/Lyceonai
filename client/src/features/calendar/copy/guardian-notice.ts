/**
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Transparency
 *        (student-facing)": "Wherever a student edits their schedule, clears a day or removes
 *        blocks, one line: 'Your guardian is notified when you change your study plan.' Only
 *        shown when an active guardian link exists."] | @implemented [2026-10-13]
 *
 * plain English: the one sentence, in one place, so the day menu, the block panel and the
 * schedule settings sheet cannot word it differently. It is drawn only where the server records
 * the change — clearing a day, removing or moving a block (`calendar_write_version`'s day-edit
 * hook), and changing study days, minutes per day or the practice-test frequency (the
 * `student_study_profile` trigger; SCL-230, approved by Karl 2026-10-13, which put the line on
 * the settings sheet too) — and only when the student has an active guardian link.
 */
export const GUARDIAN_NOTICE_LINE =
  "Your guardian is notified when you change your study plan.";
