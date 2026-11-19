/**
 * "Waiting for your teen" — the guardian's unassigned seat and its invite.
 *
 * @spec [owner brief "Parent paid seat + teen invite + book-a-call — build" (Karl, 2026-11-19)
 *        §2.1, §2.4, §3.2-§3.3; DESIGN.md §5 (one filled primary action; empty, loading and
 *        error states)] | @implemented [2026-11-19]
 *
 * plain English: one card per unassigned seat. With no invite out: an email field and
 * **Send invite** (the one filled button), plus **Copy link**. With an invite out: who it went
 * to and when it stops working, **Resend**, **Copy link** and **Cancel invite**. Every new
 * link (send, resend, copy) replaces the last one, and the card says so. If a teen who already
 * had Pro tried the invite, the card says the seat was not used. Once the seat is claimed the
 * server stops listing it, so the card goes away and the student appears as usual.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isApiError } from "@/lib/api-error";
import {
  cancelSeatInvite,
  createSeatInviteLink,
  sendSeatInvite,
  useGuardianSeats,
  useSeatMutation,
} from "@/hooks/useGuardianSeats";
import type { GuardianSeatView } from "@lyceon/shared/guardian-seat-schema";

function expiresText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "in 7 days"
    : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function errorText(err: unknown, fallback: string): string {
  if (isApiError(err) && err.status === 429) {
    return "Too many invites today. Try again tomorrow, or copy the link instead.";
  }
  return err instanceof Error ? err.message : fallback;
}

function SeatCard({ seat }: { seat: GuardianSeatView }): JSX.Element {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useSeatMutation((to: string | null) =>
    sendSeatInvite(seat.id, to),
  );
  const copy = useSeatMutation(() => createSeatInviteLink(seat.id));
  const cancel = useSeatMutation(() => cancelSeatInvite(seat.id));
  const pending = send.isPending || copy.isPending || cancel.isPending;

  const onSend = (to: string | null): void => {
    setError(null);
    setNotice(null);
    send.mutate(to, {
      onSuccess: (r) => {
        setEmail("");
        setNotice(
          r.emailed
            ? "Invite sent. Any earlier link no longer works."
            : "We couldn't send the email. Copy the link and send it yourself.",
        );
      },
      onError: (err) => setError(errorText(err, "Could not send the invite")),
    });
  };

  const onCopy = (): void => {
    setError(null);
    setNotice(null);
    copy.mutate(undefined, {
      onSuccess: (r) => {
        // No clipboard (an insecure context or a denied permission): show the link to copy.
        void navigator.clipboard.writeText(r.url).then(
          () => setNotice("Link copied. Any earlier link no longer works."),
          () => setNotice(`Copy this link: ${r.url}`),
        );
      },
      onError: (err) => setError(errorText(err, "Could not create a link")),
    });
  };

  const onCancel = (): void => {
    setError(null);
    setNotice(null);
    cancel.mutate(undefined, {
      onSuccess: () => setNotice("Invite cancelled. The link no longer works."),
      onError: (err) => setError(errorText(err, "Could not cancel the invite")),
    });
  };

  return (
    <section
      className="mx-auto flex w-full max-w-xl flex-col gap-3 rounded-lg border border-border p-5 text-left"
      data-testid="guardian-seat-card"
    >
      <h2 className="text-xl font-semibold">Waiting for your teen</h2>
      <p className="text-base text-muted-foreground">
        Your Lyceon Pro seat is paid for. Invite your teen to join; you&rsquo;ll
        see their progress once they do.
      </p>
      {seat.claimRefused && (
        <p
          role="status"
          className="rounded-md bg-muted p-3 text-base"
          data-testid="guardian-seat-already-pro"
        >
          Your teen already has Lyceon Pro, so this seat wasn&rsquo;t used. You
          can invite another teen to it.
        </p>
      )}
      {seat.invite === null ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim().length > 0) onSend(email.trim());
          }}
        >
          <Label htmlFor={`seat-email-${seat.id}`} className="text-base">
            Your teen&rsquo;s email
          </Label>
          <Input
            id={`seat-email-${seat.id}`}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="text-base"
            data-testid="guardian-seat-email"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={pending || email.trim().length === 0}
              className="min-h-[48px] text-base"
              data-testid="guardian-seat-send"
            >
              {send.isPending ? "Sending…" : "Send invite"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onCopy}
              className="min-h-[48px] text-base"
              data-testid="guardian-seat-copy"
            >
              Copy link
            </Button>
          </div>
        </form>
      ) : (
        <div
          className="flex flex-col gap-2"
          data-testid="guardian-seat-invite-out"
        >
          <p className="text-base">
            {seat.invite.email !== null
              ? `Invite sent to ${seat.invite.email}.`
              : "Invite link created."}{" "}
            It works until {expiresText(seat.invite.expiresAt)}.
          </p>
          <div className="flex flex-wrap gap-2">
            {seat.invite.email !== null && (
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onSend(null)}
                className="min-h-[48px] text-base"
                data-testid="guardian-seat-resend"
              >
                {send.isPending ? "Sending…" : "Resend"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onCopy}
              className="min-h-[48px] text-base"
              data-testid="guardian-seat-copy"
            >
              Copy link
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={onCancel}
              className="min-h-[48px] text-base"
              data-testid="guardian-seat-cancel"
            >
              Cancel invite
            </Button>
          </div>
        </div>
      )}
      {notice !== null && (
        <p
          role="status"
          className="break-all text-base"
          data-testid="guardian-seat-notice"
        >
          {notice}
        </p>
      )}
      {error !== null && (
        <p
          role="alert"
          className="text-base text-destructive"
          data-testid="guardian-seat-error"
        >
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Every unassigned seat the guardian has. Renders nothing when there are none (the empty
 * state is the caller's), a line while loading, and a retry on error.
 */
export function GuardianSeatCards(): JSX.Element | null {
  const seats = useGuardianSeats();
  if (seats.isLoading) {
    return (
      <p className="text-center text-base" data-testid="guardian-seats-loading">
        Loading your seat…
      </p>
    );
  }
  if (seats.isError) {
    return (
      <div
        className="flex flex-col items-center gap-2"
        data-testid="guardian-seats-error"
      >
        <p role="alert" className="text-base text-destructive">
          We couldn&rsquo;t load your seat.
        </p>
        <Button
          variant="outline"
          className="min-h-[48px] text-base"
          onClick={() => void seats.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  const list = seats.data?.seats ?? [];
  if (list.length === 0) return null;
  return (
    <div className="flex flex-col gap-4" data-testid="guardian-seat-cards">
      {list.map((seat) => (
        <SeatCard key={seat.id} seat={seat} />
      ))}
    </div>
  );
}

/** Whether the guardian has an unassigned seat (the no-student page swaps its buy button). */
export function useHasUnassignedSeat(): boolean {
  const seats = useGuardianSeats();
  return (seats.data?.seats.length ?? 0) > 0;
}
