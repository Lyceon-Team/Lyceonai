/**
 * The guardian's seat card: list unassigned seats, send / resend / copy / cancel the invite.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §2.1, §3.2; supabase/migrations/20261205000000_guardian_seats.sql] | @implemented
 *        [2026-11-19]
 *
 * plain English: mounted at /api/guardian/seats behind Supabase auth, CSRF and the guardian
 * role. Every operation acts only on the CALLER's own unassigned seat (the SQL functions
 * check ownership; anything else is a 404). Send and Resend email a new link and are rate
 * limited (10 a day per guardian, 3 a day per guardian + address); Copy link issues a new
 * link without sending anything. Every new link replaces the previous one, and Cancel kills
 * it. The raw token appears only in the link returned to the guardian and in the email; it is
 * never logged.
 */
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireGuardianRole } from "../middleware/guardian-role";
import { applyGuardianSeatInviteRateLimit } from "../middleware/guardian-link-rate-limit";
import {
  cancelGuardianSeatInvite,
  issueGuardianSeatInvite,
  listUnassignedGuardianSeats,
  newSeatInviteToken,
  toGuardianSeatView,
} from "../lib/guardian-seats";
import { sendGuardianSeatInviteEmail } from "../lib/notifications/direct-sends";
import { siteUrlFromEnv } from "../lib/notifications/templates";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";
import { logger } from "../logger";
import {
  guardianSeatInviteRequestSchema,
  seatJoinPath,
  type GuardianSeatInviteResponse,
  type GuardianSeatsResponse,
} from "../../packages/shared/src/guardian-seat-schema";

const router = Router();

const requireGuardianAccess = requireGuardianRole({
  message: "You do not have permission to access guardian resources",
});
router.use(requireGuardianAccess);

const seatIdSchema = z.string().uuid();

function notFound(res: Response, requestId: string | undefined): void {
  res.status(404).json({
    error: { code: "SEAT_NOT_FOUND", message: "Seat not found." },
    requestId,
  });
}

function failure(
  res: Response,
  action: string,
  err: unknown,
  requestId: string | undefined,
): void {
  logger.error("GUARDIAN_SEAT", action, "Seat operation failed", {
    error: err instanceof Error ? err.message : "unknown",
    requestId,
  });
  res.status(500).json({ error: "Internal server error", requestId });
}

async function guardianDisplayName(guardianId: string): Promise<string> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("display_name")
    .eq("id", guardianId)
    .maybeSingle();
  if (error) throw new Error("guardian display name read failed");
  const name: unknown = data?.display_name;
  return typeof name === "string" ? name : "";
}

/** GET /api/guardian/seats — the caller's unassigned seats, as the seat card shows them. */
router.get("/", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  try {
    const rows = await listUnassignedGuardianSeats(req.user!.id);
    const body: GuardianSeatsResponse = {
      seats: rows.map((r) => toGuardianSeatView(r, Date.now())),
    };
    return res.json(body);
  } catch (err: unknown) {
    return failure(res, "list", err, requestId);
  }
});

/**
 * POST /api/guardian/seats/:seatId/invite — Send (with an email) or Resend (no email: to the
 * address the last invite went to). Issues a new link, replacing the previous one, and emails
 * it. The response carries the link too, so a failed send can still be copied.
 */
router.post("/:seatId/invite", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const guardianId = req.user!.id;
  const seatId = seatIdSchema.safeParse(req.params.seatId);
  if (!seatId.success) return notFound(res, requestId);
  const parsed = guardianSeatInviteRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: { message: "Invalid input", details: parsed.error.flatten() },
      requestId,
    });
  }
  try {
    let toEmail = parsed.data.email ?? null;
    if (toEmail === null) {
      const seats = await listUnassignedGuardianSeats(guardianId);
      const seat = seats.find((s) => s.id === seatId.data);
      if (!seat) return notFound(res, requestId);
      if (!seat.invite_email) {
        return res.status(409).json({
          error: {
            code: "SEAT_INVITE_NO_EMAIL",
            message: "Enter your teen's email to send the invite.",
          },
          requestId,
        });
      }
      toEmail = seat.invite_email;
    }

    if (
      await applyGuardianSeatInviteRateLimit(
        res,
        guardianId,
        toEmail,
        requestId,
      )
    ) {
      return;
    }

    const { token, tokenHash } = newSeatInviteToken();
    const seat = await issueGuardianSeatInvite({
      guardianProfileId: guardianId,
      seatId: seatId.data,
      tokenHash,
      email: toEmail,
    });
    if (!seat || !seat.invite_expires_at) return notFound(res, requestId);

    const sent = await sendGuardianSeatInviteEmail({
      seatId: seat.id,
      guardianProfileId: guardianId,
      guardianDisplayName: await guardianDisplayName(guardianId),
      token,
      tokenHash,
      expiresAt: seat.invite_expires_at,
      toEmail,
      ...(requestId ? { requestId } : {}),
    });
    const body: GuardianSeatInviteResponse = {
      url: `${siteUrlFromEnv()}${seatJoinPath(token)}`,
      expiresAt: seat.invite_expires_at,
      emailed: sent.ok,
    };
    return res.json(body);
  } catch (err: unknown) {
    return failure(res, "invite_send", err, requestId);
  }
});

/** POST /api/guardian/seats/:seatId/invite-link — Copy link: a new link, nothing sent. */
router.post("/:seatId/invite-link", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const seatId = seatIdSchema.safeParse(req.params.seatId);
  if (!seatId.success) return notFound(res, requestId);
  try {
    const { token, tokenHash } = newSeatInviteToken();
    const seat = await issueGuardianSeatInvite({
      guardianProfileId: req.user!.id,
      seatId: seatId.data,
      tokenHash,
      email: null,
    });
    if (!seat || !seat.invite_expires_at) return notFound(res, requestId);
    const body: GuardianSeatInviteResponse = {
      url: `${siteUrlFromEnv()}${seatJoinPath(token)}`,
      expiresAt: seat.invite_expires_at,
      emailed: false,
    };
    return res.json(body);
  } catch (err: unknown) {
    return failure(res, "invite_link", err, requestId);
  }
});

/** DELETE /api/guardian/seats/:seatId/invite — Cancel: the link stops working. */
router.delete("/:seatId/invite", async (req: Request, res: Response) => {
  const requestId = req.requestId;
  const seatId = seatIdSchema.safeParse(req.params.seatId);
  if (!seatId.success) return notFound(res, requestId);
  try {
    const seat = await cancelGuardianSeatInvite({
      guardianProfileId: req.user!.id,
      seatId: seatId.data,
    });
    if (!seat) return notFound(res, requestId);
    return res.status(204).end();
  } catch (err: unknown) {
    return failure(res, "invite_cancel", err, requestId);
  }
});

export default router;
