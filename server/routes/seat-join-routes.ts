/**
 * /api/join — a teen claims the seat their parent bought.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §2.2-§2.5; supabase/migrations/20261205000000_guardian_seats.sql; Doc 01 V8 §36.1
 *        (both parties notified)] | @implemented [2026-11-19]
 *
 * plain English:
 *   GET  /api/join/:token        public. { valid } — the same answer for an unknown, expired,
 *                                used or cancelled token, and nothing about any account.
 *   POST /api/join/:token/claim  a signed-in student with a complete profile. One database
 *                                transaction creates the guardian link and claims the seat;
 *                                then the student is named on the subscription and the
 *                                entitlement written through the one guardian writer. Outcomes:
 *                                claimed | invalid | already_paid (the seat stays unassigned).
 *
 * Deliberately NOT behind the under-13 link gate: an under-13 student claims here precisely
 * to get the link that gate is waiting for. The token is never logged.
 */
import { Request, Response, Router } from "express";
import {
  requireProfileComplete,
  requireSupabaseAuth,
} from "../middleware/supabase-auth";
import { doubleCsrfProtection } from "../middleware/csrf-double-submit";
import {
  claimGuardianSeat,
  isGuardianSeatInviteValid,
} from "../lib/guardian-seats";
import { attachGuardianSeatStudent } from "../lib/stripe/guardian-seat-attach";
import { dispatchQueuedMessages } from "../lib/notifications/dispatch";
import { notificationEventId } from "../lib/notifications/event-id";
import { logger } from "../logger";
import {
  seatJoinTokenSchema,
  type SeatClaimResponse,
  type SeatJoinStatusResponse,
} from "../../packages/shared/src/guardian-seat-schema";

const router = Router();

/** GET /api/join/:token — is this a live invite? */
router.get("/:token", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const token = seatJoinTokenSchema.safeParse(req.params.token);
  try {
    const body: SeatJoinStatusResponse = {
      valid: token.success
        ? await isGuardianSeatInviteValid(token.data)
        : false,
    };
    return res.json(body);
  } catch (err: unknown) {
    logger.error("SEAT_JOIN", "status", "Invite check failed", {
      error: err instanceof Error ? err.message : "unknown",
      requestId,
    });
    return res.status(500).json({ error: "Internal server error", requestId });
  }
});

/** Only a student claims a seat. No under-13 gate here (see the file header). */
function requireStudentRole(
  req: Request,
  res: Response,
  next: () => void,
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

/** POST /api/join/:token/claim */
router.post(
  "/:token/claim",
  requireSupabaseAuth,
  doubleCsrfProtection,
  requireStudentRole,
  requireProfileComplete,
  async (req: Request, res: Response) => {
    const requestId = req.requestId;
    const studentId = req.user!.id;
    const token = seatJoinTokenSchema.safeParse(req.params.token);
    if (!token.success) {
      const body: SeatClaimResponse = { outcome: "invalid" };
      return res.json(body);
    }
    try {
      const result = await claimGuardianSeat({
        token: token.data,
        studentProfileId: studentId,
        ...(requestId ? { requestId } : {}),
      });
      if (result.outcome !== "claimed") {
        logger.info("SEAT_JOIN", "claim", "Seat not claimed", {
          outcome: result.outcome,
          requestId,
        });
        const body: SeatClaimResponse = { outcome: result.outcome };
        return res.json(body);
      }

      await attachGuardianSeatStudent({
        seatId: result.seat_id,
        subscriptionId: result.stripe_subscription_id,
        itemId: result.stripe_subscription_item_id,
        studentProfileId: studentId,
      });

      // The link's `guardian_linked` notification was queued in the claim's transaction;
      // deliver it now, as link-code redemption does.
      await dispatchQueuedMessages({
        eventId: notificationEventId("guardian_linked", result.link_id),
      });

      logger.info("SEAT_JOIN", "claim", "Seat claimed", {
        seatId: result.seat_id,
        requestId,
      });
      const body: SeatClaimResponse = { outcome: "claimed" };
      return res.json(body);
    } catch (err: unknown) {
      logger.error("SEAT_JOIN", "claim", "Seat claim failed", {
        error: err instanceof Error ? err.message : "unknown",
        requestId,
      });
      return res
        .status(500)
        .json({ error: "Internal server error", requestId });
    }
  },
);

export default router;
