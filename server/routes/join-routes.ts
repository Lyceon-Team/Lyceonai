/**
 * /api/join — a teen looks up and claims a guardian's invite.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 4, 5, 6; SCL-282; SCL-202 (anonymous
 *        public reads are limited on an HMAC of the caller's IP); Doc 01 V8 §36.1 (both
 *        parties notified); supabase/migrations/20261206000000_guardian_invites.sql]
 *        | @implemented [2026-11-22]
 *
 * plain English:
 *   POST /api/join/lookup  public. { token } in the body. What /join may say before anyone
 *                          signs in: open (with the guardian's first name and the expiry),
 *                          claimed, cancelled, expired, or not_found. Nothing about any
 *                          account. Limited per IP (anonymousBucketRateLimit).
 *   POST /api/join/claim   a signed-in student with a complete profile. { token } in the body.
 *                          Re-checks that the inviting guardian is an adult, then claims in
 *                          ONE database transaction that creates the guardian link
 *                          (initiated_by 'guardian', via 'guardian_invite') and marks the invite
 *                          claimed. A retry by the same student answers `claimed` again.
 *
 * THE TOKEN IS NEVER IN A PATH. The request logger writes `req.path`
 * (server/middleware/request-id.ts), so the token travels in the POST body only, and nothing
 * here logs it.
 *
 * Deliberately NOT behind the under-13 link gate (ruling 4): an under-13 student claims here
 * precisely to get the link that gate is waiting for.
 */
import { NextFunction, Request, Response, Router } from "express";
import {
  requireProfileComplete,
  requireSupabaseAuth,
} from "../middleware/supabase-auth";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import { anonymousBucketRateLimit } from "../middleware/rate-limit";
import {
  claimGuardianInvite,
  lookupGuardianInvite,
} from "../lib/guardian-invites";
import { checkGuardianIsAdult } from "../lib/guardian-age";
import { dispatchQueuedMessages } from "../lib/notifications/dispatch";
import { notificationEventId } from "../lib/notifications/event-id";
import { chargeGuardianInviteOnClaim } from "../lib/guardian-invite-card";
import { logger } from "../logger";
import {
  joinTokenRequestSchema,
  type JoinClaimResponse,
  type JoinLookupResponse,
} from "../../packages/shared/src/guardian-invite-schema";

const router = Router();

/** The anonymous lookup bucket, seeded by 20261206000000 (60 an hour per IP). */
const JOIN_LOOKUP_BUCKET = "guardian_invite_lookup_ip";

function failure(
  res: Response,
  action: string,
  err: unknown,
  requestId: string | undefined,
): void {
  logger.error("JOIN", action, "Invite operation failed", {
    error: err instanceof Error ? err.message : "unknown",
    requestId,
  });
  res.status(500).json({ error: "Internal server error", requestId });
}

/**
 * POST /api/join/lookup
 *
 * CSRF_EXEMPT_REASON: unauthenticated and read-only; no cookie or session is read, so there is
 * no ambient credential to forge, and nothing is written. IP-limited (SCL-202).
 */
router.post(
  "/lookup",
  anonymousBucketRateLimit(JOIN_LOOKUP_BUCKET, "join_lookup"),
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const parsed = joinTokenRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      // A malformed token is not distinguishable from an unknown one.
      const body: JoinLookupResponse = { data: { state: "not_found" } };
      return res.json(body);
    }
    try {
      const found = await lookupGuardianInvite(parsed.data.token);
      const body: JoinLookupResponse =
        found.state === "open"
          ? {
              data: {
                state: "open",
                guardianFirstName: found.guardian_first_name,
                expiresAt: found.expires_at,
              },
            }
          : { data: { state: found.state } };
      return res.json(body);
    } catch (err: unknown) {
      return failure(res, "lookup", err, requestId);
    }
  },
);

/**
 * Only a student claims an invite. An inline role gate rather than `requireStudentAccount`,
 * because that one carries the under-13 link gate the claim must come before (ruling 4).
 */
function requireStudentRole(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role === "student" && !req.user.isAdmin) {
    next();
    return;
  }
  res.status(403).json({
    error: {
      code: "ROLE_NOT_PERMITTED",
      message: "Sign in with a student account to join.",
    },
    requestId: req.requestId,
  });
}

/** POST /api/join/claim */
router.post(
  "/claim",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireStudentRole,
  requireProfileComplete,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const studentId = req.user!.id;
    const parsed = joinTokenRequestSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      const body: JoinClaimResponse = { data: { outcome: "not_found" } };
      return res.json(body);
    }
    const token = parsed.data.token;
    try {
      // The teen is the caller, so the INVITING guardian's age is checked here, by id, before
      // any link is made (owner ruling 2026-11-21). Only an open invite can make a link; for
      // every other state the claim below answers without writing.
      const found = await lookupGuardianInvite(token);
      if (found.state === "open") {
        const adult = await checkGuardianIsAdult(found.guardian_profile_id);
        if (!adult.ok) {
          logger.warn(
            "JOIN",
            "claim",
            "Inviting guardian failed the age rule",
            {
              code: adult.refusal.code,
              requestId,
            },
          );
          const body: JoinClaimResponse = { data: { outcome: "unavailable" } };
          return res.json(body);
        }
      }

      const result = await claimGuardianInvite({
        token,
        studentProfileId: studentId,
        ...(requestId ? { requestId } : {}),
      });
      if (result.outcome !== "claimed") {
        logger.info("JOIN", "claim", "Invite not claimed", {
          outcome: result.outcome,
          requestId,
        });
        const body: JoinClaimResponse = { data: { outcome: result.outcome } };
        return res.json(body);
      }

      if (result.created_link) {
        // The link's `guardian_linked` notification was queued in the claim's transaction;
        // deliver it now, awaited, as link-code redemption does. The dispatcher never throws.
        await dispatchQueuedMessages({
          eventId: notificationEventId("guardian_linked", result.link_id),
        });
      }
      logger.info("JOIN", "claim", "Invite claimed", {
        inviteId: result.invite_id,
        createdLink: result.created_link,
        requestId,
      });
      // Card on file (owner ruling 2026-11-21 3; SCL-286): AFTER the link's transaction has
      // committed, charge the card the guardian saved on this invite, if any. The guard is in
      // SQL (claimed by this student, link active, exactly one winner); this never throws, and
      // the teen's answer is "claimed" whatever the charge does. A repeated claim by the same
      // student reaches here too and tries a released charge again under the same key; the /join
      // page itself does not repeat a claim (SCL-286 PR notes the gap).
      await chargeGuardianInviteOnClaim({
        inviteId: result.invite_id,
        studentProfileId: studentId,
        ...(requestId ? { requestId } : {}),
      });
      const body: JoinClaimResponse = { data: { outcome: "claimed" } };
      return res.json(body);
    } catch (err: unknown) {
      return failure(res, "claim", err, requestId);
    }
  },
);

export default router;
