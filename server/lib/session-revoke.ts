/**
 * Revoke every OTHER session of the signed-in user, keeping the one that asked.
 *
 * @spec [Doc 01 §40.2 step 4 / §40.2.1 Phase 3 as amended by SCL-190 (register F-32, F-44);
 *        Doc 01 §12.1 step 6 "all active sessions invalidated" (register F-46, Brief 12 ruling 1,
 *        owner 2026-10-02); Coding Standards §12.1, §13] | @implemented [2026-10-02]
 *
 * plain English: Supabase's admin API revokes by the user's own access token, not by user id —
 * `auth.admin.signOut(jwt, 'others')` ends every refresh token of that user except the session
 * `jwt` belongs to. The token is read from the request's own SSR client, whose session the auth
 * middleware has already validated and, if needed, refreshed (the cookie may still hold the
 * pre-refresh token).
 *
 * Two callers, one implementation (CLAUDE.md: extend the canonical definition, never fork it):
 *   - a deletion request (F-32 / F-44): the requester keeps its session so it can reach the
 *     pending-deletion screen and cancel;
 *   - a recovery password update (F-46): the recovery session keeps working, every other device
 *     is signed out.
 *
 * Edge cases: best-effort. In both callers the change has already been committed, so a failure
 * here never fails the request. It is logged once at ERROR with the caller's event name and the
 * request id only: no person field, no token, no provider message.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../logger";

/** The one admin method this needs, so a caller can pass the real service-role client. */
export type SessionRevokeAdmin = {
  auth: { admin: { signOut: SupabaseClient["auth"]["admin"]["signOut"] } };
};

export type SessionRevokeLog = {
  component: string;
  event: string;
  message: string;
  requestId: string | undefined;
};

export async function revokeOtherSessions(
  admin: SessionRevokeAdmin,
  sessionClient: SupabaseClient | undefined,
  log: SessionRevokeLog,
): Promise<void> {
  try {
    const session = sessionClient
      ? (await sessionClient.auth.getSession()).data.session
      : null;
    if (!session) {
      throw new Error("no session on the authenticated request");
    }
    const { error } = await admin.auth.admin.signOut(
      session.access_token,
      "others",
    );
    if (error) throw error;
  } catch {
    logger.error(log.component, log.event, log.message, undefined, {
      requestId: log.requestId,
    });
  }
}
