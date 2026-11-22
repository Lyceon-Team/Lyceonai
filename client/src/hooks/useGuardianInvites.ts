/**
 * @spec [owner rulings 2026-11-21 (counsel-approved) 2, 5; SCL-282] | @implemented [2026-11-22]
 *
 * plain English: the guardian's open invites, and the four things the invite card does with
 * them: start one (a draft, card first: 2026-11-22), send or resend it, copy a link, cancel it.
 * Every response is parsed with the shared schema. After any change the list is refetched; the
 * server is the only source of what the card shows. A link is returned once, by the call that
 * made it; the server keeps only its hash.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import {
  guardianInviteDraftResponseSchema,
  guardianInviteLinkResponseSchema,
  guardianInvitesResponseSchema,
  type GuardianInviteLinkResponse,
  type GuardianInviteView,
} from "@lyceon/shared/guardian-invite-schema";
import { guardianInviteCardResponseSchema } from "@lyceon/shared/guardian-invite-card-schema";
import type { BillingPlanMetadata } from "@lyceon/shared/billing-schema";

const GUARDIAN_INVITES_QUERY_KEY = ["guardian-invites"] as const;

type InviteLink = GuardianInviteLinkResponse["data"];

async function readInvites(): Promise<GuardianInviteView[]> {
  const res = await csrfFetch("/api/guardian/invites", {
    credentials: "include",
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not load your invites");
  }
  return guardianInvitesResponseSchema.parse(await res.json()).data.invites;
}

export function useGuardianInvites() {
  const { user } = useSupabaseAuth();
  const guardianId = user?.id ?? null;
  return useQuery({
    queryKey: [...GUARDIAN_INVITES_QUERY_KEY, guardianId],
    queryFn: readInvites,
    enabled: guardianId !== null,
  });
}

async function postForLink(
  path: string,
  body: Record<string, unknown>,
  fallback: string,
): Promise<InviteLink> {
  const res = await csrfFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await parseApiErrorFromResponse(res, fallback);
  return guardianInviteLinkResponseSchema.parse(await res.json()).data;
}

/**
 * Start a draft invite (card first, owner ruling 2026-11-22, 2): nothing is sent and no link is
 * made. The guardian saves a card on it next; only then can it be sent or copied.
 */
export async function startGuardianInvite(): Promise<GuardianInviteView> {
  const res = await csrfFetch("/api/guardian/invites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ acceptParentGuardianTerms: true }),
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not start the invite");
  }
  return guardianInviteDraftResponseSchema.parse(await res.json()).data.invite;
}

/** Resend: a new link, emailed to this address. The earlier link stops working. */
export function resendGuardianInvite(
  inviteId: string,
  email: string,
): Promise<InviteLink> {
  return postForLink(
    `/api/guardian/invites/${encodeURIComponent(inviteId)}/resend`,
    { email },
    "Could not resend the invite",
  );
}

/** Copy link: a new link, nothing sent. The earlier link stops working. */
export function newGuardianInviteLink(inviteId: string): Promise<InviteLink> {
  return postForLink(
    `/api/guardian/invites/${encodeURIComponent(inviteId)}/link`,
    {},
    "Could not make a new link",
  );
}

export async function cancelGuardianInvite(inviteId: string): Promise<void> {
  const res = await csrfFetch(
    `/api/guardian/invites/${encodeURIComponent(inviteId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not cancel the invite");
  }
}

/** A mutation that refetches the invite list when it settles. */
export function useGuardianInviteMutation<TArgs, TResult>(
  fn: (args: TArgs) => Promise<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: GUARDIAN_INVITES_QUERY_KEY }),
  });
}

/**
 * Save a card for a plan on an open invite (SCL-286). The guardian has ticked the Billing Terms
 * box. Returns Stripe's card page; nothing is charged until the teen joins.
 */
export async function saveGuardianInviteCard(
  inviteId: string,
  plan: BillingPlanMetadata["plan"],
): Promise<string> {
  const res = await csrfFetch(
    `/api/guardian/invites/${encodeURIComponent(inviteId)}/card`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ plan, acceptBillingTerms: true }),
    },
  );
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not open the card page");
  }
  return guardianInviteCardResponseSchema.parse(await res.json()).data.url;
}
