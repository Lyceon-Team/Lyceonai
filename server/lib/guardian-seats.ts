/**
 * Guardian paid seats: the server's one data layer for them.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §1-§2; supabase/migrations/20261205000000_guardian_seats.sql; the SCL entries for the
 *        unassigned seat and the seat invite] | @implemented [2026-11-19]
 *
 * plain English: every read and write of `public.guardian_seats` goes through here, and every
 * write is one of the migration's SECURITY DEFINER functions, so the rules live in SQL once.
 * An invite token is 32 random bytes (base64url) handed to the guardian once, in the link;
 * only its SHA-256 is sent to the database. Nothing here logs a token, a hash or an address.
 *
 * Expected outcome: a seat is recorded once per subscription, cancelled when it ends, and
 * claimed exactly once, in one transaction that also creates the guardian link.
 * Edge cases: an invite operation on a seat that is not the caller's unassigned seat returns
 * null (the route answers 404); every invalid token claims as "invalid".
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  guardianSeatStatusSchema,
  type GuardianSeatView,
} from "../../packages/shared/src/guardian-seat-schema";
import { supabaseServer } from "../../apps/api/src/lib/supabase-server";

/** A new invite token and the hash the database keeps. */
export function newSeatInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashSeatInviteToken(token) };
}

/** SHA-256, lowercase hex: the only form of a token the database ever sees. */
function hashSeatInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const seatRowSchema = z
  .object({
    id: z.string().uuid(),
    guardian_profile_id: z.string().uuid(),
    stripe_subscription_id: z.string().min(1),
    stripe_subscription_item_id: z.string().nullable(),
    status: guardianSeatStatusSchema,
    student_profile_id: z.string().uuid().nullable(),
    invite_token_hash: z.string().nullable(),
    invite_expires_at: z.string().nullable(),
    invite_email: z.string().nullable(),
    claim_refused_at: z.string().nullable(),
  })
  .passthrough();
type GuardianSeatRow = z.infer<typeof seatRowSchema>;

function parseSeatRow(data: unknown, op: string): GuardianSeatRow | null {
  if (data === null || data === undefined) return null;
  const parsed = seatRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`guardian seat ${op}: unexpected row shape`);
  }
  // A composite-returning function with no matching row comes back as all-null fields.
  return parsed.data;
}

function parseNullableSeatRow(
  data: unknown,
  op: string,
): GuardianSeatRow | null {
  if (
    data !== null &&
    typeof data === "object" &&
    "id" in data &&
    (data as { id: unknown }).id === null
  ) {
    return null;
  }
  return parseSeatRow(data, op);
}

function rpcFailure(
  op: string,
  error: { code?: string; message: string },
): Error {
  return new Error(`guardian seat ${op} failed (${error.code ?? "unknown"})`);
}

/** The webhook: record the seat for this subscription once. Idempotent. */
export async function recordGuardianSeat(input: {
  guardianProfileId: string;
  subscriptionId: string;
  itemId: string | null;
}): Promise<GuardianSeatRow> {
  const { data, error } = await supabaseServer.rpc("guardian_seat_record", {
    p_guardian_id: input.guardianProfileId,
    p_subscription_id: input.subscriptionId,
    p_item_id: input.itemId,
  });
  if (error) throw rpcFailure("record", error);
  const row = parseSeatRow(data, "record");
  if (!row) throw new Error("guardian seat record: no row returned");
  return row;
}

/** The webhook: the subscription ended. Idempotent. */
export async function markGuardianSeatCancelled(
  subscriptionId: string,
): Promise<void> {
  const { error } = await supabaseServer.rpc("guardian_seat_mark_cancelled", {
    p_subscription_id: subscriptionId,
  });
  if (error) throw rpcFailure("mark_cancelled", error);
}

/** The guardian's unassigned seats, as the seat card shows them. */
export async function listUnassignedGuardianSeats(
  guardianProfileId: string,
): Promise<GuardianSeatRow[]> {
  const { data, error } = await supabaseServer
    .from("guardian_seats")
    .select(
      "id, guardian_profile_id, stripe_subscription_id, stripe_subscription_item_id, status, student_profile_id, invite_token_hash, invite_expires_at, invite_email, claim_refused_at",
    )
    .eq("guardian_profile_id", guardianProfileId)
    .eq("status", "unassigned")
    .order("created_at", { ascending: true });
  if (error) throw rpcFailure("list", error);
  return z.array(seatRowSchema).parse(data ?? []);
}

/** The seat card's view: never the token or its hash. An expired invite shows as none. */
export function toGuardianSeatView(
  row: GuardianSeatRow,
  nowMs: number,
): GuardianSeatView {
  const live =
    row.invite_token_hash !== null &&
    row.invite_expires_at !== null &&
    Date.parse(row.invite_expires_at) > nowMs;
  return {
    id: row.id,
    invite: live
      ? { email: row.invite_email, expiresAt: row.invite_expires_at ?? "" }
      : null,
    claimRefused: row.claim_refused_at !== null,
  };
}

/**
 * Issue a new token for the guardian's unassigned seat, replacing any earlier one. `email`
 * null keeps the address already on the seat (Copy link). Null when the seat is not theirs
 * or not unassigned.
 */
export async function issueGuardianSeatInvite(input: {
  guardianProfileId: string;
  seatId: string;
  tokenHash: string;
  email: string | null;
}): Promise<GuardianSeatRow | null> {
  const { data, error } = await supabaseServer.rpc(
    "guardian_seat_issue_invite",
    {
      p_guardian_id: input.guardianProfileId,
      p_seat_id: input.seatId,
      p_token_hash: input.tokenHash,
      p_email: input.email,
    },
  );
  if (error) throw rpcFailure("issue_invite", error);
  return parseNullableSeatRow(data, "issue_invite");
}

/** Cancel the live invite. Null when the seat is not theirs or not unassigned. */
export async function cancelGuardianSeatInvite(input: {
  guardianProfileId: string;
  seatId: string;
}): Promise<GuardianSeatRow | null> {
  const { data, error } = await supabaseServer.rpc(
    "guardian_seat_cancel_invite",
    { p_guardian_id: input.guardianProfileId, p_seat_id: input.seatId },
  );
  if (error) throw rpcFailure("cancel_invite", error);
  return parseNullableSeatRow(data, "cancel_invite");
}

/** One boolean for every token: live, or not. */
export async function isGuardianSeatInviteValid(
  token: string,
): Promise<boolean> {
  const { data, error } = await supabaseServer.rpc(
    "guardian_seat_invite_valid",
    { p_token_hash: hashSeatInviteToken(token) },
  );
  if (error) throw rpcFailure("invite_valid", error);
  return data === true;
}

const claimResultSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("claimed"),
      link_id: z.string().uuid(),
      seat_id: z.string().uuid(),
      guardian_profile_id: z.string().uuid(),
      stripe_subscription_id: z.string().min(1),
      stripe_subscription_item_id: z.string().nullable(),
    })
    .strict(),
  z.object({ outcome: z.literal("invalid") }).strict(),
  z.object({ outcome: z.literal("already_paid") }).strict(),
]);
type GuardianSeatClaimResult = z.infer<typeof claimResultSchema>;

/** The claim, in one database transaction (link + seat). */
export async function claimGuardianSeat(input: {
  token: string;
  studentProfileId: string;
  requestId?: string;
}): Promise<GuardianSeatClaimResult> {
  const { data, error } = await supabaseServer.rpc("guardian_seat_claim", {
    p_token_hash: hashSeatInviteToken(input.token),
    p_student_id: input.studentProfileId,
    p_request_id: input.requestId ?? null,
  });
  if (error) throw rpcFailure("claim", error);
  return claimResultSchema.parse(data);
}
