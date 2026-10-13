/**
 * @spec [owner brief "Guardian accountability loop" (Karl, 2026-10-13) "Transparency
 *        (student-facing)": "Wherever a student edits their schedule, clears a day or removes
 *        blocks, one line: 'Your guardian is notified when you change your study plan.' Only
 *        shown when an active guardian link exists."] | @implemented [2026-10-13]
 *
 * plain English: the one sentence, in one place, so the day menu and the block panel cannot word
 * it differently. It is drawn only where the server records the change (clearing a day, removing
 * or moving a block — `calendar_write_version`'s day-edit hook) and only when the student has an
 * active guardian link. NOT on the schedule settings sheet: changes to study days, minutes and
 * the practice-test cadence are not reported to a guardian yet (SCL-230, awaiting Karl), and the
 * line must not say something the system does not do.
 */
export const GUARDIAN_NOTICE_LINE =
  "Your guardian is notified when you change your study plan.";
