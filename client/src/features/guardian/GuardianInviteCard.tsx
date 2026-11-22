/**
 * The guardian's "Waiting for your teen" card: invite a teen by email or by a copied link, and
 * resend, copy a new link, or cancel an open invite.
 *
 * @spec [owner rulings 2026-11-21 (counsel-approved) 1, 2, 5; SCL-282; DESIGN.md §5 (one
 *        filled primary action; empty, loading and error states; nothing below 14px)]
 *        | @implemented [2026-11-22]
 *
 * plain English: with no invite out, the card asks for the teen's email and the guardian's
 * agreement to the Parent / Guardian Terms; **Send invite** is the one filled action, and
 * **Copy a link instead** makes a link without sending anything. Each open invite shows when its
 * link was emailed or made and when it stops working, with Resend, Copy new link and Cancel.
 * Every new link replaces the one before it (the server keeps only a hash, so a link can be shown
 * only once, right after it is made). At most 3 invites can be open at a time. An open invite can
 * also carry a card saved for a plan, charged only when the teen joins (ruling 3; SCL-286; see
 * GuardianInviteCardForm).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelGuardianInvite,
  newGuardianInviteLink,
  resendGuardianInvite,
  startGuardianInvite,
  useGuardianInviteMutation,
  useGuardianInvites,
} from "@/hooks/useGuardianInvites";
import {
  GUARDIAN_INVITE_MAX_OPEN,
  type GuardianInviteView,
} from "@lyceon/shared/guardian-invite-schema";
import { GuardianInviteCardForm } from "./GuardianInviteCardForm";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message.length > 0
    ? err.message
    : "Something went wrong. Please try again.";
}

/** The link just made, with a copy button. Shown once: the server cannot show it again. */
function FreshLink({ url }: { url: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2" data-testid="invite-fresh-link">
      <Label htmlFor="invite-link" className="text-base">
        Your teen&rsquo;s invite link
      </Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="invite-link"
          readOnly
          value={url}
          className="min-w-0 flex-1 text-base"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          variant="outline"
          className="min-h-[44px] text-base"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(url)
              .then(() => setCopied(true));
          }}
          data-testid="invite-copy"
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="m-0 text-base text-muted-foreground">
        Send it to your teen yourself. It works for 14 days, and only for them.
      </p>
    </div>
  );
}

function InviteRow({
  invite,
  onFreshLink,
}: {
  invite: GuardianInviteView;
  onFreshLink: (url: string) => void;
}): JSX.Element {
  const [resending, setResending] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const [email, setEmail] = useState("");
  const resend = useGuardianInviteMutation((addr: string) =>
    resendGuardianInvite(invite.id, addr),
  );
  const relink = useGuardianInviteMutation(() =>
    newGuardianInviteLink(invite.id),
  );
  const cancel = useGuardianInviteMutation(() =>
    cancelGuardianInvite(invite.id),
  );
  const pending = resend.isPending || relink.isPending || cancel.isPending;
  const failed = resend.error ?? relink.error ?? cancel.error;

  const status = invite.expired
    ? `This link expired on ${formatDate(invite.expiresAt)}.`
    : `${invite.emailed ? "Emailed" : "Link made"} ${formatDate(invite.issuedAt)} · works until ${formatDate(invite.expiresAt)}`;

  return (
    <li
      className="flex flex-col gap-3 rounded-md border p-4 text-left"
      data-testid="invite-row"
    >
      <p className="m-0 text-base" data-testid="invite-status">
        {status}
      </p>
      {resending ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            resend.mutate(email.trim(), {
              onSuccess: (link) => {
                setResending(false);
                setEmail("");
                if (!link.emailed) onFreshLink(link.url);
              },
            });
          }}
        >
          <Label htmlFor={`resend-${invite.id}`} className="text-base">
            Your teen&rsquo;s email
          </Label>
          <Input
            id={`resend-${invite.id}`}
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="text-base"
            data-testid="invite-resend-email"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="outline"
              disabled={pending}
              className="min-h-[44px] text-base"
              data-testid="invite-resend-submit"
            >
              {resend.isPending ? "Sending…" : "Send new link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="min-h-[44px] text-base"
              onClick={() => setResending(false)}
            >
              Back
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={pending}
            className="min-h-[44px] text-base"
            onClick={() => setResending(true)}
            data-testid="invite-resend"
          >
            Resend
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            className="min-h-[44px] text-base"
            onClick={() =>
              relink.mutate(undefined, {
                onSuccess: (link) => onFreshLink(link.url),
              })
            }
            data-testid="invite-new-link"
          >
            {relink.isPending ? "Making a link…" : "Copy new link"}
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            className="min-h-[44px] text-base"
            onClick={() => cancel.mutate(undefined)}
            data-testid="invite-cancel"
          >
            {cancel.isPending ? "Cancelling…" : "Cancel invite"}
          </Button>
        </div>
      )}
      <p className="m-0 text-base text-muted-foreground">
        A new link replaces the earlier one, which stops working.
      </p>
      {!invite.expired && (
        <InviteCardOnFile
          invite={invite}
          open={cardOpen}
          onOpen={() => setCardOpen(true)}
          onClose={() => setCardOpen(false)}
        />
      )}
      {failed !== null && (
        <p
          role="alert"
          className="m-0 text-base text-destructive"
          data-testid="invite-row-error"
        >
          {errorMessage(failed)}
        </p>
      )}
    </li>
  );
}

const PLAN_WORD: Record<"monthly" | "quarterly" | "yearly", string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

/**
 * The optional card on file for this invite (owner ruling 2026-11-21 3; SCL-286): saved, being
 * saved, or an offer to save one. Charged only when the teen joins.
 */
function InviteCardOnFile({
  invite,
  open,
  onOpen,
  onClose,
}: {
  invite: GuardianInviteView;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}): JSX.Element {
  if (open) {
    return <GuardianInviteCardForm inviteId={invite.id} onClose={onClose} />;
  }
  const card = invite.card;
  if (card !== null && card.status === "saved") {
    return (
      <div className="flex flex-col gap-2" data-testid="invite-card-saved">
        <p className="m-0 text-base">
          Card saved for the {PLAN_WORD[card.plan]} plan. We&rsquo;ll charge it
          when your teen joins.
        </p>
        <Button
          variant="ghost"
          className="min-h-[44px] self-start text-base"
          onClick={onOpen}
          data-testid="invite-card-change"
        >
          Change card or plan
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {card !== null && card.status === "pending" && (
        <p
          className="m-0 text-base text-muted-foreground"
          data-testid="invite-card-pending"
        >
          Finishing saving your card. This can take a minute.
        </p>
      )}
      <Button
        variant="ghost"
        className="min-h-[44px] self-start text-base"
        onClick={onOpen}
        data-testid="invite-card-open"
      >
        Save a card now (optional)
      </Button>
    </div>
  );
}

function NewInviteForm({
  onFreshLink,
}: {
  onFreshLink: (url: string) => void;
}): JSX.Element {
  const [email, setEmail] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [termsMissing, setTermsMissing] = useState(false);
  const start = useGuardianInviteMutation((addr: string | null) =>
    startGuardianInvite(addr),
  );

  function begin(addr: string | null): void {
    if (!acceptedTerms) {
      setTermsMissing(true);
      return;
    }
    setTermsMissing(false);
    start.mutate(addr, {
      onSuccess: (link) => {
        setEmail("");
        if (!link.emailed) onFreshLink(link.url);
      },
    });
  }

  return (
    <form
      className="flex flex-col gap-3 text-left"
      onSubmit={(e) => {
        e.preventDefault();
        begin(email.trim());
      }}
      data-testid="invite-new"
    >
      <Label htmlFor="invite-email" className="text-base">
        Your teen&rsquo;s email
      </Label>
      <Input
        id="invite-email"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="text-base"
        data-testid="invite-email"
      />
      <label className="flex items-start gap-2 text-base">
        <input
          type="checkbox"
          className="mt-1.5"
          checked={acceptedTerms}
          onChange={(e) => setAcceptedTerms(e.target.checked)}
          data-testid="invite-terms"
        />
        <span>
          I agree to the{" "}
          <a
            href="/legal/parent-guardian-terms"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            LYCEON Parent / Guardian Terms
          </a>
          .
        </span>
      </label>
      {termsMissing && (
        <p role="alert" className="m-0 text-base text-destructive">
          Agree to the Parent / Guardian Terms to send an invite.
        </p>
      )}
      {start.error !== null && (
        <p
          role="alert"
          className="m-0 text-base text-destructive"
          data-testid="invite-error"
        >
          {errorMessage(start.error)}
        </p>
      )}
      {start.isSuccess && start.data.emailed && (
        <p role="status" className="m-0 text-base" data-testid="invite-sent">
          Invite sent. It works for 14 days.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={start.isPending}
          className="min-h-[48px] px-6 text-base"
          data-testid="invite-send"
        >
          {start.isPending ? "Sending…" : "Send invite"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={start.isPending}
          className="min-h-[48px] px-6 text-base"
          onClick={() => begin(null)}
          data-testid="invite-copy-instead"
        >
          Copy a link instead
        </Button>
      </div>
    </form>
  );
}

export function GuardianInviteCard(): JSX.Element {
  const invites = useGuardianInvites();
  const [freshLink, setFreshLink] = useState<string | null>(null);

  let body: JSX.Element;
  if (invites.isLoading) {
    body = (
      <div
        role="status"
        aria-label="Loading your invites"
        className="flex flex-col gap-3"
        data-testid="invite-loading"
      >
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-1/2" />
      </div>
    );
  } else if (invites.isError) {
    body = (
      <div className="flex flex-col gap-3" data-testid="invite-load-error">
        <p role="alert" className="m-0 text-base text-destructive">
          We couldn&rsquo;t load your invites.
        </p>
        <Button
          variant="outline"
          className="min-h-[44px] self-start text-base"
          onClick={() => void invites.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  } else {
    const open = invites.data ?? [];
    body = (
      <div className="flex flex-col gap-4">
        {open.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {open.map((invite) => (
              <InviteRow
                key={invite.id}
                invite={invite}
                onFreshLink={setFreshLink}
              />
            ))}
          </ul>
        )}
        {freshLink !== null && <FreshLink url={freshLink} />}
        {open.length < GUARDIAN_INVITE_MAX_OPEN ? (
          <NewInviteForm onFreshLink={setFreshLink} />
        ) : (
          <p className="m-0 text-base text-muted-foreground">
            You have {GUARDIAN_INVITE_MAX_OPEN} open invites. Cancel one to
            start another.
          </p>
        )}
      </div>
    );
  }

  const waiting = (invites.data ?? []).length > 0;
  return (
    <section
      className="mx-auto flex w-full max-w-xl flex-col gap-4 rounded-lg border p-6 text-left"
      aria-labelledby="invite-card-title"
      data-testid="guardian-invite-card"
    >
      <h2 id="invite-card-title" className="m-0 text-xl font-semibold">
        {waiting ? "Waiting for your teen" : "Invite your teen"}
      </h2>
      <p className="m-0 text-base text-muted-foreground">
        We&rsquo;ll email your teen a link. When they join as a student,
        you&rsquo;re connected and can see their progress.
      </p>
      {body}
    </section>
  );
}
