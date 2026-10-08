/**
 * The full-length phone notice: its copy and the per-visit memory of "Continue anyway". Read only
 * by the one shared pre-start check, `useFullLengthPhonePrecheck` (owner ruling, Karl, 2026-10-05,
 * OQ-63: "show it for every full-length start on a phone, including calendar-launched starts").
 *
 * @spec [owner ruling (Karl, 2026-10-05): "On phone widths, Full-Length still works, but its home
 *        shows: \"Full-length tests are built for a laptop or tablet, like test day.\" with
 *        \"Continue anyway\". Never blocked."; DESIGN.md §2 Mobile] | @implemented [2026-10-05]
 *
 * plain English: the notice's two strings are the ruling's words exactly, held here once so the
 * check and its tests read the same text. Continuing is remembered for this browser tab
 * (sessionStorage), so a student who chose to continue is not asked again on every full-length
 * start during the visit; a new tab or a new visit asks again.
 *
 * edge cases: storage can be unavailable (private mode, blocked site data) and reads or writes
 * can throw. A failed read answers "not continued", so the student sees the notice and one tap
 * passes it; a failed write only means the notice returns next time. Neither can block anything:
 * the choice itself always takes effect for the page in front of the student.
 */
export const PHONE_NOTICE_TEXT =
  "Full-length tests are built for a laptop or tablet, like test day.";
export const PHONE_NOTICE_CONTINUE = "Continue anyway";
/**
 * Owner QA list (Karl, 2026-10-07) item 15 | @implemented [2026-10-07]: the notice's second
 * button, which closes it as Close does (the start is cancelled). The app's modals' own words
 * for that action (the upgrade modal's "Not now").
 */
export const PHONE_NOTICE_NOT_NOW = "Not now";

const STORAGE_KEY = "lyceon.full-length.phone-notice.continued";

/** Did the student continue past the notice earlier in this tab? */
export function readPhoneNoticeContinued(): boolean {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch (err: unknown) {
    // Unreadable storage is a definite "not continued": the notice shows and one tap passes it.
    // Nothing to log on the client (no console in production code).
    void err;
    return false;
  }
}

/** Remember "Continue anyway" for this tab. Never throws into the UI. */
export function rememberPhoneNoticeContinued(): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch (err: unknown) {
    // A failed write means the notice returns on the next visit to the home; the page in front
    // of the student is already revealed by the caller's own state.
    void err;
  }
}
