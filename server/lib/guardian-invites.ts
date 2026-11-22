/**
 * Guardian → teen invites: the server's one data layer for them.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 5, 6; SCL-282;
 *        supabase/migrations/20261206000000_guardian_invites.sql] | @implemented [2026-11-22]
 *
 * plain English: every read and write of `public.guardian_invites` goes through here, and every
 * write is one of the migration's SECURITY DEFINER functions, so the rules (ownership, the
 * open-invite cap, the 14-day expiry, one claim) live in SQL once. A token is 32 random bytes
 * (base64url), handed to the guardian once in the link; only its SHA-256 reaches the database.
 * An address is reduced to its SHA-256 before it reaches the database, and only for the
 * per-address rate limit. Nothing here logs a token, a hash or an address.
 *
 * Expected outcome: an invite is issued, re-issued (new token, old one dead) or cancelled only
 * by its own guardian, and claimed exactly once, in one transaction that creates the link.
 * Edge cases: an operation on an invite that is not the caller's open invite returns null (the
 * route answers 404); the fourth open invite raises `GuardianInviteLimitError`.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { GuardianInviteView } from "../../packages/shared/src/guardian-invite-schema";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

/** SQLSTATE the issue function raises when the guardian already has 3 open invites. */
const OPEN_INVITE_LIMIT_SQLSTATE = "LY010";

export class GuardianInviteLimitError extends Error {
  readonly code = "GUARDIAN_INVITE_LIMIT" as const;
  constructor() {
    super("guardian already has the maximum number of open invites");
    this.name = "GuardianInviteLimitError";
  }
}

/** A new invite token and the hash the database keeps. */
export function newGuardianInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashGuardianInviteToken(token) };
}

/** SHA-256, lowercase hex: the only form of a token the database ever sees. */
function hashGuardianInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** SHA-256 of the normalised address, for the per-address rate limit only. */
export function hashGuardianInviteEmail(email: string): string {
  return createHash("sha256")
    .update(email.trim().toLowerCase(), "utf8")
    .digest("hex");
}

const inviteRowSchema = z
  .object({
    id: z.string().uuid(),
    guardian_profile_id: z.string().uuid(),
    status: z.enum(["open", "claimed", "cancelled"]),
    token_issued_at: z.string(),
    expires_at: z.string(),
    email_hash: z.string().nullable(),
    // The card on file (20261207000000, SCL-286). Every function returning a whole row carries
    // them; a NULL plan is no card.
    card_plan: z.enum(["monthly", "quarterly", "yearly"]).nullable(),
    charge_status: z.enum([
      "none",
      "card_pending",
      "card_saved",
      "charging",
      "charged",
      "payment_failed",
      "already_funded",
      "not_charged",
    ]),
  })
  .passthrough();
export type GuardianInviteRow = z.infer<typeof inviteRowSchema>;

const INVITE_COLUMNS =
  "id, guardian_profile_id, status, token_issued_at, expires_at, email_hash, card_plan, charge_status";

/**
 * A composite-returning function with no matching row comes back as a row of NULLs, not as
 * NULL; both mean "not this guardian's open invite".
 */
function parseNullableInviteRow(
  data: unknown,
  op: string,
): GuardianInviteRow | null {
  if (data === null || data === undefined) return null;
  if (
    typeof data === "object" &&
    "id" in data &&
    (data as { id: unknown }).id === null
  ) {
    return null;
  }
  const parsed = inviteRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`guardian invite ${op}: unexpected row shape`);
  }
  return parsed.data;
}

function rpcFailure(
  op: string,
  error: { code?: string; message: string },
): Error {
  return new Error(`guardian invite ${op} failed (${error.code ?? "unknown"})`);
}

/** The card's view of an invite: never the token or a hash. */
export function toGuardianInviteView(
  row: GuardianInviteRow,
  nowMs: number,
): GuardianInviteView {
  return {
    id: row.id,
    issuedAt: row.token_issued_at,
    expiresAt: row.expires_at,
    expired: Date.parse(row.expires_at) <= nowMs,
    emailed: row.email_hash !== null,
    card: cardView(row),
  };
}

/**
 * What the guardian's card shows about a saved card. Only an OPEN invite is listed, so the charge
 * states after a claim never reach the view; a pending session with no plan yet is not a card.
 */
function cardView(row: GuardianInviteRow): GuardianInviteView["card"] {
  if (row.charge_status === "card_saved" && row.card_plan !== null) {
    return { plan: row.card_plan, status: "saved" };
  }
  if (row.charge_status === "card_pending" && row.card_plan !== null) {
    return { plan: row.card_plan, status: "pending" };
  }
  return null;
}

/** The guardian's open invites, oldest first, expired ones included (they can be renewed). */
export async function listOpenGuardianInvites(
  guardianProfileId: string,
): Promise<GuardianInviteRow[]> {
  const { data, error } = await supabaseServer
    .from("guardian_invites")
    .select(INVITE_COLUMNS)
    .eq("guardian_profile_id", guardianProfileId)
    .eq("status", "open")
    .order("created_at", { ascending: true });
  if (error) throw rpcFailure("list", error);
  return z.array(inviteRowSchema).parse(data ?? []);
}

/**
 * Start an invite (`inviteId` null) or re-issue the token of the guardian's own open invite.
 * `emailHash` null on a re-issue keeps the hash already on the row (Copy link).
 * Null when `inviteId` is not this guardian's open invite.
 */
export async function issueGuardianInvite(input: {
  guardianProfileId: string;
  tokenHash: string;
  emailHash: string | null;
  inviteId: string | null;
  requestId?: string;
}): Promise<GuardianInviteRow | null> {
  const { data, error } = await supabaseServer.rpc(
    "issue_guardian_invite_audited",
    {
      p_guardian_id: input.guardianProfileId,
      p_token_hash: input.tokenHash,
      p_email_hash: input.emailHash,
      p_invite_id: input.inviteId,
      p_request_id: input.requestId ?? null,
    },
  );
  if (error) {
    if (error.code === OPEN_INVITE_LIMIT_SQLSTATE)
      throw new GuardianInviteLimitError();
    throw rpcFailure("issue", error);
  }
  return parseNullableInviteRow(data, "issue");
}

/** Cancel the guardian's own open invite. Null when it is not theirs, or not open. */
export async function cancelGuardianInvite(input: {
  guardianProfileId: string;
  inviteId: string;
  requestId?: string;
}): Promise<GuardianInviteRow | null> {
  const { data, error } = await supabaseServer.rpc(
    "cancel_guardian_invite_audited",
    {
      p_guardian_id: input.guardianProfileId,
      p_invite_id: input.inviteId,
      p_request_id: input.requestId ?? null,
    },
  );
  if (error) throw rpcFailure("cancel", error);
  return parseNullableInviteRow(data, "cancel");
}

const lookupResultSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("open"),
      guardian_profile_id: z.string().uuid(),
      guardian_first_name: z.string(),
      expires_at: z.string(),
    })
    .strict(),
  z.object({ state: z.literal("claimed") }).strict(),
  z.object({ state: z.literal("cancelled") }).strict(),
  z.object({ state: z.literal("expired") }).strict(),
  z.object({ state: z.literal("not_found") }).strict(),
]);
type GuardianInviteLookup = z.infer<typeof lookupResultSchema>;

/** What a token is, and for an open one, whose. The guardian id never leaves the server. */
export async function lookupGuardianInvite(
  token: string,
): Promise<GuardianInviteLookup> {
  const { data, error } = await supabaseServer.rpc("guardian_invite_lookup", {
    p_token_hash: hashGuardianInviteToken(token),
  });
  if (error) throw rpcFailure("lookup", error);
  return lookupResultSchema.parse(data);
}

const claimResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("claimed"),
      invite_id: z.string().uuid(),
      link_id: z.string().uuid(),
      guardian_profile_id: z.string().uuid(),
      created_link: z.boolean(),
    })
    .strict(),
  z.object({ outcome: z.literal("claimed_by_other") }).strict(),
  z.object({ outcome: z.literal("cancelled") }).strict(),
  z.object({ outcome: z.literal("expired") }).strict(),
  z.object({ outcome: z.literal("not_found") }).strict(),
]);
type GuardianInviteClaim = z.infer<typeof claimResultSchema>;

/** The claim, in one database transaction (link + invite). */
export async function claimGuardianInvite(input: {
  token: string;
  studentProfileId: string;
  requestId?: string;
}): Promise<GuardianInviteClaim> {
  const { data, error } = await supabaseServer.rpc(
    "claim_guardian_invite_audited",
    {
      p_token_hash: hashGuardianInviteToken(input.token),
      p_student_id: input.studentProfileId,
      p_request_id: input.requestId ?? null,
    },
  );
  if (error) throw rpcFailure("claim", error);
  return claimResultSchema.parse(data);
}
