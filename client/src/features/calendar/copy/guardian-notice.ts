/**
 * @spec [owner brief "student cleanups" (Karl, 2026-10-21) Part A: "Copy (exact): title 'Your
 *        guardian will be notified'; body 'Changing your study plan sends them an update.';
 *        buttons 'Make change' (primary), 'Cancel'." and "Remove the static 'Your guardian is
 *        notified…' lines; the dialog replaces them."; SCL-238] | @implemented [2026-10-21]
 *
 * plain English: the confirmation's four strings, in one place. They replace the static line
 * "Your guardian is notified when you change your study plan." (owner brief 2026-10-13,
 * "Transparency"), which the day menu, the block panel and the schedule sheet drew whenever an
 * active link existed; the dialog now says it once, at the moment it is true, before the write.
 */
export const GUARDIAN_CONFIRM_TITLE = "Your guardian will be notified";
export const GUARDIAN_CONFIRM_BODY =
  "Changing your study plan sends them an update.";
export const GUARDIAN_CONFIRM_ACTION = "Make change";
export const GUARDIAN_CONFIRM_CANCEL = "Cancel";
