/**
 * The words a button shows while its action waits on the server.
 *
 * @spec [owner QA list (Karl, 2026-10-07) item 5: "Disabled + visible pending label/spinner from
 *        the first click, no double submit"; DESIGN.md §1 (sentence case)] | @implemented [2026-10-07]
 *
 * plain English: one place for the pending labels, so every start reads "Starting…" and the
 * runner's footer says what it is doing ("Skipping…", "Checking…", "Loading…"). The spinner and
 * the disabled state come from `Button`'s `pending` prop; these are only its words.
 */

/** Any start that creates or launches a session: Home's plan, Practice, Review, Full-Length. */
export const STARTING_LABEL = "Starting…";

/** The runner's Skip while the skip and the next question load. */
export const SKIPPING_LABEL = "Skipping…";

/** The runner's Submit while the answer is checked. */
export const CHECKING_LABEL = "Checking…";

/** The runner's Next question / Done while the next step loads. */
export const LOADING_LABEL = "Loading…";
