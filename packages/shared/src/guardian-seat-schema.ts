/**
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §1-§3; supabase/migrations/20261205000000_guardian_seats.sql; Coding Standards §7.2
 *        (schema first, types inferred)] | @implemented [2026-11-19]
 *
 * plain English: the shapes of the parent seat flow, shared by the server and the client.
 * A guardian buys a seat with no student; while it is unassigned the guardian can email an
 * invite, copy the invite link, resend or cancel it. A teen opens /join/<token>, signs up or
 * signs in, and claims the seat. Every invalid token gets the same answer, and nothing here
 * says whether an account exists.
 */
import { z } from "zod";

/** The value the checkout route stamps on a seat subscription's metadata (`purchase_kind`). */
export const GUARDIAN_SEAT_PURCHASE_KIND = "guardian_seat" as const;

export const guardianSeatStatusSchema = z.enum([
  "unassigned",
  "claimed",
  "cancelled",
]);

/** One unassigned seat as the guardian's seat card shows it. */
export const guardianSeatViewSchema = z
  .object({
    id: z.string().uuid(),
    /** The live invite, or null when none is out. The token itself is never returned here. */
    invite: z
      .object({
        email: z.string().nullable(),
        expiresAt: z.string(),
      })
      .strict()
      .nullable(),
    /** A student who already had Pro tried to claim this seat; it was not used. */
    claimRefused: z.boolean(),
  })
  .strict();
export type GuardianSeatView = z.infer<typeof guardianSeatViewSchema>;

export const guardianSeatsResponseSchema = z
  .object({ seats: z.array(guardianSeatViewSchema) })
  .strict();
export type GuardianSeatsResponse = z.infer<typeof guardianSeatsResponseSchema>;

/** Send an invite by email. With no email, Resend sends again to the last address. */
export const guardianSeatInviteRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254).optional(),
  })
  .strict();

/** What Send, Resend and Copy link return: the new link and when it stops working. */
export const guardianSeatInviteResponseSchema = z
  .object({
    url: z.string().url(),
    expiresAt: z.string(),
    emailed: z.boolean(),
  })
  .strict();
export type GuardianSeatInviteResponse = z.infer<
  typeof guardianSeatInviteResponseSchema
>;

/** A token as it appears in /join/<token>: 32 random bytes, base64url, no padding. */
export const seatJoinTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const seatJoinStatusResponseSchema = z
  .object({ valid: z.boolean() })
  .strict();
export type SeatJoinStatusResponse = z.infer<
  typeof seatJoinStatusResponseSchema
>;

export const seatClaimOutcomeSchema = z.enum([
  "claimed",
  "invalid",
  "already_paid",
]);
export type SeatClaimOutcome = z.infer<typeof seatClaimOutcomeSchema>;

export const seatClaimResponseSchema = z
  .object({ outcome: seatClaimOutcomeSchema })
  .strict();
export type SeatClaimResponse = z.infer<typeof seatClaimResponseSchema>;

/** The /join path for a token. */
export function seatJoinPath(token: string): string {
  return `/join/${token}`;
}

/** The one answer for an unknown, expired, used or cancelled invite. */
export const SEAT_INVITE_INVALID_MESSAGE =
  "This invite isn't valid. Ask your parent to send a new one.";

/** What a student who already has Pro sees instead of claiming. */
export const SEAT_ALREADY_PRO_MESSAGE = "You already have Pro.";

/** The line shown before claiming. */
export const SEAT_CLAIM_DISCLOSURE =
  "Your parent will see your progress: your areas and scores, not your answers.";
