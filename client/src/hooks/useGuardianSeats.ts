/**
 * @spec [owner brief "Parent paid seat + teen invite" (Karl, 2026-11-19) §3.2] |
 *       @implemented [2026-11-19]
 *
 * plain English: the guardian's unassigned seats and the four things the seat card does with
 * them — send an invite, resend it, copy a new link, cancel it. Every response is parsed with
 * the shared schema. After any change the seat list is refetched; the server is the only
 * source of what the card shows.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  guardianSeatInviteResponseSchema,
  guardianSeatsResponseSchema,
  type GuardianSeatInviteResponse,
  type GuardianSeatsResponse,
} from "@lyceon/shared/guardian-seat-schema";

export const GUARDIAN_SEATS_QUERY_KEY = ["guardian-seats"] as const;

async function readSeats(): Promise<GuardianSeatsResponse> {
  const res = await csrfFetch("/api/guardian/seats", {
    credentials: "include",
  });
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not load your seat");
  return guardianSeatsResponseSchema.parse(await res.json());
}

export function useGuardianSeats() {
  const { user } = useSupabaseAuth();
  const guardianId = user?.id ?? null;
  return useQuery({
    queryKey: [...GUARDIAN_SEATS_QUERY_KEY, guardianId],
    queryFn: readSeats,
    enabled: guardianId !== null,
  });
}

async function postInvite(
  path: string,
  body: Record<string, string> | null,
  fallback: string,
): Promise<GuardianSeatInviteResponse> {
  const res = await csrfFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw await parseApiErrorFromResponse(res, fallback);
  return guardianSeatInviteResponseSchema.parse(await res.json());
}

/** Send (with an email) or Resend (without): a new link, emailed. */
export function sendSeatInvite(
  seatId: string,
  email: string | null,
): Promise<GuardianSeatInviteResponse> {
  return postInvite(
    `/api/guardian/seats/${encodeURIComponent(seatId)}/invite`,
    email === null ? null : { email },
    "Could not send the invite",
  );
}

/** Copy link: a new link, nothing sent. It replaces any earlier link. */
export function createSeatInviteLink(
  seatId: string,
): Promise<GuardianSeatInviteResponse> {
  return postInvite(
    `/api/guardian/seats/${encodeURIComponent(seatId)}/invite-link`,
    null,
    "Could not create a link",
  );
}

export async function cancelSeatInvite(seatId: string): Promise<void> {
  const res = await csrfFetch(
    `/api/guardian/seats/${encodeURIComponent(seatId)}/invite`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not cancel the invite");
}

/** A mutation that refetches the seat list when it settles. */
export function useSeatMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: GUARDIAN_SEATS_QUERY_KEY }),
  });
}
