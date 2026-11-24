/**
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 5, 6, 7; SCL-282;
 *        supabase/migrations/20261206000000_guardian_invites.sql; Privacy Policy v6 §5.1 (what a
 *        linked guardian can see); Coding Standards §7.2 (schema first, types inferred)]
 *        | @implemented [2026-11-22]
 *
 * plain English: the shapes of the guardian → teen invite, shared by the server and the client.
 * A guardian starts an invite (emailed to the teen, or a link they copy), and can resend, copy
 * a fresh link, or cancel it. A teen opens /join/<token>, signs up or signs in as a student,
 * and claims it; claiming creates the guardian link. A token is the link: every new link
 * (send, resend, copy) replaces the one before it, and lasts 14 days.
 *
 * Nothing here ever says whether an email address has an account.
 */
import { z } from "zod";
import { billingPeriodSchema } from "./billing-schema";

/** At most this many open, unexpired invites per guardian (ruling 5). Enforced in SQL. */
export const GUARDIAN_INVITE_MAX_OPEN = 3;

/* A link lasts 14 days from the moment it is issued (ruling 5); enforced in SQL only. */

/** A token as it appears in /join/<token>: 32 random bytes, base64url, no padding. */
const guardianInviteTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** The teen's address, normalised the same way the existing invite normalises it. */
const guardianInviteEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

/**
 * POST /api/guardian/invites — start a DRAFT invite (card first, owner ruling 2026-11-22, 2).
 * No address: a draft has no card, so nothing can be sent for it. The link goes out from
 * `/:id/resend` or `/:id/link` once a card is saved (20261210000000). Starting an invite is
 * where the guardian accepts the Parent / Guardian Terms, so the acceptance is required, as at
 * link-code redemption.
 */
export const issueGuardianInviteRequestSchema = z
  .object({
    acceptParentGuardianTerms: z.literal(true),
  })
  .strict();

/** POST /api/guardian/invites/:id/resend — a new link, emailed to this address. */
export const resendGuardianInviteRequestSchema = z
  .object({ email: guardianInviteEmailSchema })
  .strict();

/** One open invite as the guardian's card shows it. Never the token or a hash. */
export const guardianInviteViewSchema = z
  .object({
    id: z.string().uuid(),
    /** When the current link was issued. */
    issuedAt: z.string(),
    /** When the current link stops working. */
    expiresAt: z.string(),
    expired: z.boolean(),
    /** The current link was emailed (true) or only copied (false). */
    emailed: z.boolean(),
    /**
     * The card saved for this invite, if any (owner ruling 2026-11-21 3; SCL-286). `pending`: the
     * guardian opened Stripe's card page and it has not been completed yet. `saved`: the card is
     * on file and will be charged for `plan` when the teen joins. Never a card detail.
     */
    card: z
      .object({
        plan: billingPeriodSchema,
        status: z.enum(["pending", "saved"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type GuardianInviteView = z.infer<typeof guardianInviteViewSchema>;

export const guardianInvitesResponseSchema = z
  .object({
    data: z.object({ invites: z.array(guardianInviteViewSchema) }).strict(),
  })
  .strict();
export type GuardianInvitesResponse = z.infer<
  typeof guardianInvitesResponseSchema
>;

/**
 * What issue, resend and copy return. `url` carries the new token and is returned to the
 * guardian alone, once; the server keeps only its hash, so the same link cannot be shown again.
 * `emailed` is false for a copied link, and false when the email could not be sent (the link
 * can still be copied).
 */
export const guardianInviteLinkResponseSchema = z
  .object({
    data: z
      .object({
        invite: guardianInviteViewSchema,
        url: z.string().url(),
        emailed: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type GuardianInviteLinkResponse = z.infer<
  typeof guardianInviteLinkResponseSchema
>;

/** POST /api/guardian/invites answers with the draft only: no link exists for it yet. */
export const guardianInviteDraftResponseSchema = z
  .object({
    data: z.object({ invite: guardianInviteViewSchema }).strict(),
  })
  .strict();
export type GuardianInviteDraftResponse = z.infer<
  typeof guardianInviteDraftResponseSchema
>;

/** POST /api/join/lookup and POST /api/join/claim: the token goes in the body, never a path. */
export const joinTokenRequestSchema = z
  .object({ token: guardianInviteTokenSchema })
  .strict();

/** What /join may say about a token before anyone signs in. */
export const joinLookupResponseSchema = z
  .object({
    data: z.discriminatedUnion("state", [
      z
        .object({
          state: z.literal("open"),
          /** The guardian's first name, shown before the teen signs in (ruling 6). */
          guardianFirstName: z.string(),
          expiresAt: z.string(),
        })
        .strict(),
      z.object({ state: z.literal("claimed") }).strict(),
      z.object({ state: z.literal("cancelled") }).strict(),
      z.object({ state: z.literal("expired") }).strict(),
      z.object({ state: z.literal("not_found") }).strict(),
    ]),
  })
  .strict();
export type JoinLookupResponse = z.infer<typeof joinLookupResponseSchema>;
type JoinLookupState = JoinLookupResponse["data"]["state"];

/**
 * What a claim answers.
 *   claimed      the link exists (new, or one the pair already had).
 *   claimed_by_other / cancelled / expired / not_found
 *                the token cannot be claimed; the same words /join shows for the lookup.
 *   unavailable  the inviting account cannot be linked to (it is not an adult guardian).
 *                Said without saying why: the teen is not told anything about the guardian.
 */
export const joinClaimOutcomeSchema = z.enum([
  "claimed",
  "claimed_by_other",
  "cancelled",
  "expired",
  "not_found",
  "unavailable",
]);
export type JoinClaimOutcome = z.infer<typeof joinClaimOutcomeSchema>;

export const joinClaimResponseSchema = z
  .object({ data: z.object({ outcome: joinClaimOutcomeSchema }).strict() })
  .strict();
export type JoinClaimResponse = z.infer<typeof joinClaimResponseSchema>;

/** The /join path for a token. */
export function joinPath(token: string): string {
  return `/join/${token}`;
}

/**
 * The line /join shows before the teen claims (ruling 7): what a linked guardian sees, in the
 * words of Privacy Policy v6 §5.1, and what they do not.
 */
export function joinConsentLine(guardianFirstName: string): string {
  const who =
    guardianFirstName.trim().length > 0
      ? guardianFirstName.trim()
      : "Your parent";
  return (
    `When you join, ${who} will see your mastery for each subject area, your study calendar ` +
    "and progress, your projected and target scores, and your full-length practice test " +
    "results. They won't see skill-level detail, your answers, or your conversations with LISA."
  );
}

/** The words for each state a token can be in, shared by the lookup and the claim. */
export const JOIN_STATE_MESSAGE = {
  claimed: "This invite has already been used.",
  claimed_by_other: "This invite has already been used.",
  cancelled: "This invite was cancelled. Ask your parent to send a new one.",
  expired: "This invite has expired. Ask your parent to send a new one.",
  not_found:
    "We couldn't find this invite. Check the link, or ask your parent to send a new one.",
  unavailable:
    "This invite can't be used. Ask your parent to check their Lyceon account.",
} as const satisfies Record<
  Exclude<JoinClaimOutcome | JoinLookupState, "open">,
  string
>;
