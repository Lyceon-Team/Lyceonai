/**
 * The no-student guardian home's invite card, card first: step 1 "Pick a plan and add your
 * card.", step 2 "Invite your teen." (locked until step 1 is done).
 *
 * @spec [owner brief "Build: /parent page + card-first parent onboarding" (Karl, 2026-11-22),
 *        Part 2 "Guardian home, no-student state"; owner ruling 2026-11-22 (2) card first,
 *        charged when the teen joins; rulings 2026-11-21 (counsel-approved) 1, 2, 3, 5;
 *        SCL-282, SCL-286, SCL-287; DESIGN.md §5 (one filled primary action; empty, loading and
 *        error states; nothing below 14px)] | @implemented [2026-11-22]
 *
 * plain English:
 *   Step 1 is the existing setup-mode card flow and consent box (GuardianInviteCardForm): pick a
 *   plan, read the charge sentence, tick the boxes, **Save card** opens Stripe's card page. With
 *   no invite yet it also starts a draft invite. Card details are never collected on our page.
 *   Step 2 is the email field with **Send invite** (or **Resend** once emailed), **Copy link**,
 *   and **Cancel invite**. It is shown but disabled until a card is saved on the invite; the
 *   server refuses all of it until then too (20261210000000), so the lock here is a convenience,
 *   never the control. The filled action is **Save card** while step 1 is open, then **Send
 *   invite**. Every new link replaces the one before it and is shown once, right after it is
 *   made (the server keeps only a hash). At most 3 invites can be open at a time.
 */
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  cancelGuardianInvite,
  newGuardianInviteLink,
  resendGuardianInvite,
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

type CardPlan = "monthly" | "quarterly" | "yearly";

const PLAN_WORD: Record<CardPlan, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

function hasSavedCard(invite: GuardianInviteView): boolean {
  return invite.card !== null && invite.card.status === "saved";
}

function StepHeading({
  n,
  title,
  done,
}: {
  n: 1 | 2;
  title: string;
  done: boolean;
}): JSX.Element {
  return (
    <h3 className="m-0 flex items-center gap-2 text-lg font-semibold">
      <span
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border text-base"
        aria-hidden="true"
      >
        {done ? "✓" : n}
      </span>
      <span>
        {title}
        {done && <span className="sr-only"> Done.</span>}
      </span>
    </h3>
  );
}

/** Step 1, done: the card saved on this invite, with a way to change it (outline). */
function SavedCard({
  invite,
  plan,
}: {
  invite: GuardianInviteView;
  plan: CardPlan;
}): JSX.Element {
  const [changing, setChanging] = useState(false);
  if (changing) {
    return (
      <GuardianInviteCardForm
        inviteId={invite.id}
        onClose={() => setChanging(false)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2" data-testid="invite-card-saved">
      <p className="m-0 text-base">
        Card saved for the {PLAN_WORD[plan]} plan. We&rsquo;ll charge it when
        your teen joins.
      </p>
      <Button
        variant="ghost"
        className="min-h-[44px] self-start text-base"
        onClick={() => setChanging(true)}
        data-testid="invite-card-change"
      >
        Change card or plan
      </Button>
    </div>
  );
}

/** Step 2 for one invite with a card: send (or resend) by email, copy a link, or cancel. */
function SendStep({
  invite,
  primary,
  onFreshLink,
}: {
  invite: GuardianInviteView;
  primary: boolean;
  onFreshLink: (url: string) => void;
}): JSX.Element {
  const [email, setEmail] = useState("");
  const send = useGuardianInviteMutation((addr: string) =>
    resendGuardianInvite(invite.id, addr),
  );
  const relink = useGuardianInviteMutation(() =>
    newGuardianInviteLink(invite.id),
  );
  const cancel = useGuardianInviteMutation(() =>
    cancelGuardianInvite(invite.id),
  );
  const pending = send.isPending || relink.isPending || cancel.isPending;
  const failed = send.error ?? relink.error ?? cancel.error;
  const status = invite.expired
    ? `This link expired on ${formatDate(invite.expiresAt)}. Send or copy a new one.`
    : invite.emailed
      ? `Emailed ${formatDate(invite.issuedAt)} · works until ${formatDate(invite.expiresAt)}`
      : null;

  return (
    <li className="flex flex-col gap-3 text-left" data-testid="invite-row">
      {status !== null && (
        <p className="m-0 text-base" data-testid="invite-status">
          {status}
        </p>
      )}
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate(email.trim(), {
            onSuccess: (link) => {
              setEmail("");
              if (!link.emailed) onFreshLink(link.url);
            },
          });
        }}
      >
        <Label htmlFor={`invite-email-${invite.id}`} className="text-base">
          Your teen&rsquo;s email
        </Label>
        <Input
          id={`invite-email-${invite.id}`}
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="text-base"
          data-testid="invite-email"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant={primary ? "default" : "outline"}
            disabled={pending}
            className="min-h-[48px] px-6 text-base"
            data-testid={invite.emailed ? "invite-resend" : "invite-send"}
          >
            {send.isPending
              ? "Sending…"
              : invite.emailed
                ? "Resend"
                : "Send invite"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            className="min-h-[48px] px-6 text-base"
            onClick={() =>
              relink.mutate(undefined, {
                onSuccess: (link) => onFreshLink(link.url),
              })
            }
            data-testid="invite-new-link"
          >
            {relink.isPending ? "Making a link…" : "Copy link"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            className="min-h-[48px] text-base"
            onClick={() => cancel.mutate(undefined)}
            data-testid="invite-cancel"
          >
            {cancel.isPending ? "Cancelling…" : "Cancel invite"}
          </Button>
        </div>
      </form>
      {send.isSuccess && send.data.emailed && (
        <p role="status" className="m-0 text-base" data-testid="invite-sent">
          Invite sent. It works for 14 days.
        </p>
      )}
      <p className="m-0 text-base text-muted-foreground">
        A new link replaces the earlier one, which stops working.
      </p>
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

/** Step 2 before a card is saved: the same controls, disabled, and why. */
function LockedSendStep(): JSX.Element {
  return (
    <fieldset
      disabled
      className="m-0 flex flex-col gap-3 border-0 p-0 text-left opacity-60"
      data-testid="invite-step2-locked"
    >
      <Label htmlFor="invite-email-locked" className="text-base">
        Your teen&rsquo;s email
      </Label>
      <Input id="invite-email-locked" type="email" className="text-base" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-[48px] px-6 text-base"
        >
          Send invite
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-[48px] px-6 text-base"
        >
          Copy link
        </Button>
      </div>
      <p className="m-0 text-base text-muted-foreground">
        Add your card in step 1 first. You&rsquo;re only charged once your teen
        joins.
      </p>
    </fieldset>
  );
}

export function GuardianInviteCard(): JSX.Element {
  const invites = useGuardianInvites();
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [addingAnother, setAddingAnother] = useState(false);

  if (invites.isLoading) {
    return (
      <Frame waiting={false}>
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
      </Frame>
    );
  }
  if (invites.isError) {
    return (
      <Frame waiting={false}>
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
      </Frame>
    );
  }

  const open = invites.data ?? [];
  const ready = open.filter(hasSavedCard);
  // The invite step 1 works on: an unexpired one with no saved card yet (a draft, or one whose
  // card is still being saved). Null means step 1 starts a new draft.
  const draft = open.find((i) => !hasSavedCard(i) && !i.expired) ?? null;
  const roomForAnother =
    open.filter((i) => !i.expired).length < GUARDIAN_INVITE_MAX_OPEN;
  const stepOneOpen = ready.length === 0 || addingAnother || draft !== null;
  const firstReady = ready[0];
  const firstReadyPlan = firstReady?.card?.plan;

  return (
    <Frame waiting={ready.some((i) => i.emailed)}>
      <ol className="m-0 flex list-none flex-col gap-6 p-0">
        <li className="flex flex-col gap-3" data-testid="invite-step1">
          <StepHeading
            n={1}
            title="Pick a plan and add your card."
            done={!stepOneOpen}
          />
          {stepOneOpen ? (
            <>
              {draft?.card?.status === "pending" && (
                <p
                  className="m-0 text-base text-muted-foreground"
                  data-testid="invite-card-pending"
                >
                  Finishing saving your card. This can take a minute.
                </p>
              )}
              {roomForAnother || draft !== null ? (
                <GuardianInviteCardForm
                  inviteId={draft?.id ?? null}
                  primary
                  {...(ready.length > 0 && draft === null
                    ? { onClose: () => setAddingAnother(false) }
                    : {})}
                />
              ) : (
                <p className="m-0 text-base text-muted-foreground">
                  You have {GUARDIAN_INVITE_MAX_OPEN} open invites. Cancel one
                  to start another.
                </p>
              )}
            </>
          ) : (
            firstReady !== undefined &&
            firstReadyPlan !== undefined && (
              <SavedCard invite={firstReady} plan={firstReadyPlan} />
            )
          )}
        </li>
        <li className="flex flex-col gap-3" data-testid="invite-step2">
          <StepHeading n={2} title="Invite your teen." done={false} />
          {ready.length === 0 ? (
            <LockedSendStep />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-5 p-0">
              {ready.map((invite) => (
                <SendStep
                  key={invite.id}
                  invite={invite}
                  primary={!stepOneOpen}
                  onFreshLink={setFreshLink}
                />
              ))}
            </ul>
          )}
          {freshLink !== null && <FreshLink url={freshLink} />}
          {ready.length > 0 && !stepOneOpen && roomForAnother && (
            <Button
              variant="ghost"
              className="min-h-[44px] self-start text-base"
              onClick={() => setAddingAnother(true)}
              data-testid="invite-another"
            >
              Invite another teen
            </Button>
          )}
        </li>
      </ol>
    </Frame>
  );
}

function Frame({
  waiting,
  children,
}: {
  waiting: boolean;
  children: ReactNode;
}): JSX.Element {
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
        Add your card, then invite your teen. You&rsquo;re only charged once
        they join, and then you&rsquo;re connected and can see their progress.
      </p>
      {children}
    </section>
  );
}
