/**
 * @spec [Doc-02B_V4 §14 practice modes; Doc-05A §11 diagnostic] | @implemented [2026-08-17]
 *
 * plain English: the single source of truth for what `practice_sessions.mode`
 * may be, split by WHO is allowed to set it. Practice sessions take their mode
 * from the client, so that input needs an enum. Diagnostic sessions are
 * server-assigned and must never be settable from a request body.
 *
 * expected outcome: a client can no longer name its own session mode. The
 * practice start route accepts three values; anything else is a 400 at the
 * boundary instead of an unvalidated string written into the row.
 *
 * trade-offs: `flow` is deliberately absent from the accepted set while
 * remaining valid at the DB layer — see SESSION_MODES_DB below.
 *
 * edge cases: `mode` is optional on the wire. Absent/null resolves to
 * DEFAULT_PRACTICE_SESSION_MODE, which is what every current client relies on.
 */
import { z } from "zod";

/**
 * Every value `practice_sessions_mode_check` accepts, in constraint order.
 *
 * This mirrors the DB CHECK (supabase/migrations/20260806000000_diagnostic_gate.sql)
 * and MUST keep listing `flow`. Eight production rows carry mode='flow' from a
 * client version that no longer exists; dropping it from the constraint would
 * invalidate real history for no gain. New `flow` writes are blocked at the Zod
 * boundary below instead — constrain the boundary, do not normalize the data.
 *
 * `practice_session_mode_to_event_kind()` maps every one of these to an
 * event_source_kind and RAISEs on anything else, so this list and that function
 * must stay in step.
 */
export const SESSION_MODES_DB = [
  "flow",
  "structured",
  "balanced",
  "timed",
  "diagnostic",
] as const;

export const sessionModeSchema = z.enum(SESSION_MODES_DB);
export type SessionMode = z.infer<typeof sessionModeSchema>;

/**
 * Modes a CLIENT may request when starting a practice session.
 *
 * Excludes `diagnostic` — that mode decides `event_source_kind`
 * ('diagnostic_attempt') and therefore how the answer is recorded in mastery.
 * Letting a request body choose it means letting a client classify its own
 * activity in the mastery record, and it routes around the once-only guard in
 * the diagnostic route entirely. Diagnostic sessions are created only by
 * POST /api/diagnostic/sessions, which hardcodes the mode server-side.
 *
 * Excludes `flow` — no server code writes it and no current client sends it.
 */
export const practiceSessionModeSchema = z.enum([
  "structured",
  "balanced",
  "timed",
]);
export type PracticeSessionMode = z.infer<typeof practiceSessionModeSchema>;

/** What an absent or null `mode` resolves to. Every current client relies on this. */
export const DEFAULT_PRACTICE_SESSION_MODE: PracticeSessionMode = "balanced";

/** Server-assigned only. Never accepted from a request body. */
export const DIAGNOSTIC_SESSION_MODE = "diagnostic" as const;
