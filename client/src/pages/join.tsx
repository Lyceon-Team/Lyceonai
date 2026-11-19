/**
 * `/join/:token` — a teen claims the Lyceon Pro seat their parent bought.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §2.2-§2.4; DESIGN.md §5 (one filled primary action; loading and error states)] |
 *       @implemented [2026-11-19]
 *
 * plain English:
 *   * Any invalid invite (unknown, expired, used, cancelled) shows one line: "This invite
 *     isn't valid. Ask your parent to send a new one." Nothing here says whether an account
 *     exists.
 *   * Signed out: create a student account, or sign in. Either way `/join/<token>` rides
 *     through sign-up and onboarding as `next` and lands back here.
 *   * Signed in as a student with a complete profile: one line on what the parent will see,
 *     then **Join**. A claimed seat goes to the dashboard (the user is refreshed first, so an
 *     under-13 student's guardian requirement is already met when the dashboard loads).
 *     A student who already has Pro sees "You already have Pro."
 *   * Signed in as anything else: told the invite is for a student account.
 * The server decides every outcome; the page only shows it. Not behind RequireRole, so an
 * under-13 student with no guardian link reaches it.
 */
import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { authEntryPath } from "@lyceon/shared/auth-entry";
import { isProfileGateSatisfied } from "@lyceon/shared/profile-completion";
import { onboardingPathWithReturn } from "@lyceon/shared/return-path";
import {
  SEAT_ALREADY_PRO_MESSAGE,
  SEAT_CLAIM_DISCLOSURE,
  SEAT_INVITE_INVALID_MESSAGE,
  seatClaimResponseSchema,
  seatJoinPath,
  seatJoinStatusResponseSchema,
  type SeatClaimOutcome,
} from "@lyceon/shared/guardian-seat-schema";

async function readInviteValid(token: string): Promise<boolean> {
  const res = await fetch(`/api/join/${encodeURIComponent(token)}`, {
    credentials: "include",
  });
  if (!res.ok)
    throw await parseApiErrorFromResponse(res, "Could not check this invite");
  return seatJoinStatusResponseSchema.parse(await res.json()).valid;
}

async function postClaim(token: string): Promise<SeatClaimOutcome> {
  const res = await csrfFetch(`/api/join/${encodeURIComponent(token)}/claim`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw await parseApiErrorFromResponse(res, "Could not join");
  return seatClaimResponseSchema.parse(await res.json()).outcome;
}

function Message({
  title,
  body,
  testId,
}: {
  title: string;
  body?: string;
  testId: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <BareCardHeader title={title} />
      {body !== undefined && (
        <p className="m-0 text-lyc-body text-lyc-ink">{body}</p>
      )}
    </div>
  );
}

export default function JoinPage({
  params,
}: {
  params: { token: string };
}): JSX.Element {
  const token = params.token;
  const here = seatJoinPath(token);
  const [, navigate] = useLocation();
  const { user, isAuthenticated, authLoading, refreshUser } = useSupabaseAuth();
  const [outcome, setOutcome] = useState<SeatClaimOutcome | null>(null);

  const invite = useQuery({
    queryKey: ["seat-join", token],
    queryFn: () => readInviteValid(token),
    retry: false,
  });

  const claim = useMutation({
    mutationFn: () => postClaim(token),
    onSuccess: async (result) => {
      if (result === "claimed") {
        await refreshUser();
        navigate("/dashboard");
        return;
      }
      setOutcome(result);
    },
  });

  if (invite.isLoading || authLoading) {
    return <Message title="Checking your invite…" testId="join-loading" />;
  }
  if (invite.isError) {
    return (
      <div className="flex flex-col gap-4" data-testid="join-error">
        <BareCardHeader title="We couldn't check this invite" />
        <Button
          variant="lyc-outline"
          className="self-start"
          onClick={() => void invite.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  if (outcome === "already_paid") {
    return (
      <div className="flex flex-col gap-4" data-testid="join-already-pro">
        <BareCardHeader title={SEAT_ALREADY_PRO_MESSAGE} />
        <Button
          variant="lyc-primary"
          className="self-start"
          onClick={() => navigate("/dashboard")}
        >
          Go to your dashboard
        </Button>
      </div>
    );
  }
  if (outcome === "invalid" || invite.data !== true) {
    return (
      <Message title={SEAT_INVITE_INVALID_MESSAGE} testId="join-invalid" />
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col gap-4" data-testid="join-signed-out">
        <BareCardHeader title="Your parent got you Lyceon Pro" />
        <p className="m-0 text-lyc-body text-lyc-ink">
          {SEAT_CLAIM_DISCLOSURE}
        </p>
        <Button
          variant="lyc-primary"
          className="self-start"
          onClick={() =>
            navigate(
              authEntryPath({ mode: "signup", role: "student", next: here }),
            )
          }
          data-testid="join-sign-up"
        >
          Create a student account
        </Button>
        <Button
          variant="lyc-outline"
          className="self-start"
          onClick={() =>
            navigate(authEntryPath({ mode: "signin", next: here }))
          }
          data-testid="join-sign-in"
        >
          I already have an account
        </Button>
      </div>
    );
  }

  if (user.role !== "student") {
    return (
      <Message
        title="This invite is for a student account"
        body="Sign out, then sign in or sign up with your own student account."
        testId="join-not-student"
      />
    );
  }

  const needsOnboarding =
    user.requiredProfileComplete === false ||
    !isProfileGateSatisfied({
      isAdmin: false,
      role: user.role,
      profileCompletedAt: user.profile_completed_at,
    });
  if (needsOnboarding) {
    return <Redirect to={onboardingPathWithReturn(here)} replace />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="join-ready">
      <BareCardHeader title="Join your parent's Lyceon Pro" />
      <p
        className="m-0 text-lyc-body text-lyc-ink"
        data-testid="join-disclosure"
      >
        {SEAT_CLAIM_DISCLOSURE}
      </p>
      {claim.isError && (
        <p role="alert" className="m-0 text-lyc-body text-lyc-ink">
          Something went wrong. Please try again.
        </p>
      )}
      <Button
        variant="lyc-primary"
        className="self-start"
        disabled={claim.isPending}
        onClick={() => claim.mutate()}
        data-testid="join-claim"
      >
        {claim.isPending ? "Joining…" : "Join"}
      </Button>
    </div>
  );
}
