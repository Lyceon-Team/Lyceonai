/**
 * `/join/:token` — a teen claims their guardian's invite.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 4, 6, 7; SCL-282; DESIGN.md §5 (one
 *        filled primary action; empty, loading and error states)] | @implemented [2026-11-22]
 *
 * plain English:
 *   * The page asks the server what the token is (POST /api/join/lookup; the token is in the
 *     body, never a URL the server logs). Claimed, cancelled, expired and unknown each get
 *     their own clear line; nothing here says whether any account exists.
 *   * Open, signed out: the guardian's first name, what they will see once the teen joins (the
 *     Privacy Policy v6 §5.1 words), and two choices: create a student account (primary), or
 *     sign in. Either way `/join/<token>` rides through sign-up and onboarding as `next` and
 *     lands back here.
 *   * Open, signed in as a student with a complete profile: the same line, then **Join**.
 *     Joining refreshes the user first, so an under-13 student's guardian requirement is
 *     already met when the dashboard loads.
 *   * Signed in as anything else: told the invite is for a student account.
 * The server decides every outcome; the page only shows it. Not behind RequireRole, so an
 * under-13 student with no guardian link reaches it (ruling 4).
 */
import { useState } from "react";
import { Redirect, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BareCardHeader } from "@/components/layout/BareCardShell";
import { Notice } from "@/components/student-ui/Notice";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { csrfFetch } from "@/lib/csrf";
import { parseApiErrorFromResponse } from "@/lib/api-error";
import { authEntryPath } from "@lyceon/shared/auth-entry";
import { isProfileGateSatisfied } from "@lyceon/shared/profile-completion";
import { onboardingPathWithReturn } from "@lyceon/shared/return-path";
import {
  JOIN_STATE_MESSAGE,
  joinClaimResponseSchema,
  joinConsentLine,
  joinLookupResponseSchema,
  joinPath,
  type JoinClaimOutcome,
  type JoinLookupResponse,
} from "@lyceon/shared/guardian-invite-schema";

type Lookup = JoinLookupResponse["data"];

async function postLookup(token: string): Promise<Lookup> {
  const res = await fetch("/api/join/lookup", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw await parseApiErrorFromResponse(res, "Could not check this invite");
  }
  return joinLookupResponseSchema.parse(await res.json()).data;
}

async function postClaim(token: string): Promise<JoinClaimOutcome> {
  const res = await csrfFetch("/api/join/claim", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await parseApiErrorFromResponse(res, "Could not join");
  return joinClaimResponseSchema.parse(await res.json()).data.outcome;
}

function StateMessage({
  title,
  testId,
}: {
  title: string;
  testId: string;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <BareCardHeader title={title} />
    </div>
  );
}

export default function JoinPage({
  params,
}: {
  params: { token: string };
}): JSX.Element {
  const token = params.token;
  const here = joinPath(token);
  const [, navigate] = useLocation();
  const { user, isAuthenticated, authLoading, refreshUser } = useSupabaseAuth();
  const [outcome, setOutcome] = useState<Exclude<
    JoinClaimOutcome,
    "claimed"
  > | null>(null);

  const invite = useQuery({
    queryKey: ["join-invite", token],
    queryFn: () => postLookup(token),
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
    return (
      <div
        role="status"
        aria-label="Checking your invite"
        className="flex flex-col gap-4"
        data-testid="join-loading"
      >
        <Skeleton variant="lyc" className="h-8 w-3/4" />
        <Skeleton variant="lyc" className="h-4 w-full" />
        <Skeleton variant="lyc" className="h-11 w-1/2" />
      </div>
    );
  }
  if (invite.isError || invite.data === undefined) {
    return (
      <div className="flex flex-col gap-4" data-testid="join-error">
        <Notice
          tone="danger"
          title="We couldn't check this invite"
          message="Check your connection and try again."
          actionLabel="Try again"
          onAction={() => void invite.refetch()}
        />
      </div>
    );
  }

  if (outcome !== null) {
    return (
      <StateMessage
        title={JOIN_STATE_MESSAGE[outcome]}
        testId={`join-${outcome}`}
      />
    );
  }
  const found = invite.data;
  if (found.state !== "open") {
    return (
      <StateMessage
        title={JOIN_STATE_MESSAGE[found.state]}
        testId={`join-${found.state}`}
      />
    );
  }

  const who =
    found.guardianFirstName.trim().length > 0
      ? found.guardianFirstName.trim()
      : "Your parent";
  const consent = joinConsentLine(found.guardianFirstName);

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col gap-4" data-testid="join-signed-out">
        <BareCardHeader title={`${who} invited you to Lyceon`} />
        <p
          className="m-0 text-lyc-body text-lyc-ink"
          data-testid="join-consent"
        >
          {consent}
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
      <div className="flex flex-col gap-4" data-testid="join-not-student">
        <BareCardHeader
          title="This invite is for a student account"
          description="Sign out, then sign in or sign up with your own student account."
        />
      </div>
    );
  }

  // Onboarding first, with this page as the return path, so the claim (which needs a complete
  // profile) is never refused into a redirect that would drop the token.
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
      <BareCardHeader title={`Join ${who} on Lyceon`} />
      <p className="m-0 text-lyc-body text-lyc-ink" data-testid="join-consent">
        {consent}
      </p>
      {claim.isError && (
        <Notice
          tone="danger"
          title="Something went wrong"
          message="Please try again."
          data-testid="join-claim-error"
        />
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
