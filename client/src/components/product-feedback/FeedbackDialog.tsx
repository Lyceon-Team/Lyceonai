/**
 * Private feedback: the dialog, and the entry points that open it.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 ("private feedback (always available)"),
 *       row Q6; owner answers 2026-10-05: self-contained so the student-UI rebuild (UI-58) can
 *       mount it on its Help page; guardians reach it from the avatar menu; final brief
 *       "Trustpilot card + Feedback" (Karl, 2026-10-20) §3: type Bug · Idea · Something else,
 *       the 2,000-character message, "May we reply by email?" (default off, hidden for
 *       under-13s), the route pattern and the app version attached, no screenshots, no student
 *       work; DESIGN.md §5 (2–3 options: a segmented control)]
 *       | @implemented [2026-10-05; type, reply and context 2026-10-20]
 *
 * plain English: `FeedbackDialog` is controlled (`open` / `onOpenChange`) and owns everything
 * else — the type, the text, the reply choice, the idempotency key (one per opening, so a double
 * click or a retry stores one row), the send, the thank-you and the error. It attaches the page as
 * a route pattern (`currentRoutePattern`: no ids, no query string) and the app version, and says
 * so under the form. `FeedbackButton` is the outline-button entry for Settings or Help;
 * `useFeedbackMenuEntry` is the account-menu entry (students and guardians). Feedback is open to
 * every student and guardian at any age (R28 "always available"); an admin account gets no entry,
 * and the server refuses one anyway.
 *
 * Privacy: the text goes to the server only (which posts at most 300 characters of an 18+
 * sender's text to the team's Slack, SCL-237) — no analytics, no log. The area carries
 * `ph-no-capture` so session recording never sees it.
 */
import { useState, type ReactNode } from "react";
import { MessageSquare } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  submitFeedback,
  useFeedbackAudience,
  useFeedbackReplyAllowed,
} from "@/lib/product-feedback-api";
import { appVersion } from "@/lib/app-version";
import { currentRoutePattern } from "@/lib/route-pattern";
import { SURFACE, type Surface } from "./surface";
import {
  FEEDBACK_MAX_LENGTH,
  FEEDBACK_TYPE_LABELS,
  FEEDBACK_TYPES,
  type FeedbackSource,
  type FeedbackType,
} from "../../../../packages/shared/src/product-feedback-schema";

function newKey(): string {
  return crypto.randomUUID();
}

/** Bug · Idea · Something else, as one segmented control (DESIGN.md §5: 2–3 options). */
function FeedbackTypeControl({
  value,
  onChange,
}: {
  value: FeedbackType;
  onChange: (type: FeedbackType) => void;
}): JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-labelledby="feedback-type-label"
      className="inline-flex rounded-md border border-input"
      data-testid="feedback-type"
    >
      {FEEDBACK_TYPES.map((type) => {
        const selected = type === value;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={`feedback-type-${type}`}
            onClick={() => onChange(type)}
            className={`min-h-9 px-3 text-sm font-medium first:rounded-l-md last:rounded-r-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-background text-foreground hover:bg-muted"
            }`}
          >
            {FEEDBACK_TYPE_LABELS[type]}
          </button>
        );
      })}
    </div>
  );
}

export function FeedbackDialog({
  open,
  onOpenChange,
  source,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: FeedbackSource;
  onSent?: () => void;
}): JSX.Element {
  const [type, setType] = useState<FeedbackType>("bug");
  const [text, setText] = useState("");
  const [replyOk, setReplyOk] = useState(false);
  const [key, setKey] = useState(newKey);
  const replyAllowed = useFeedbackReplyAllowed();
  const send = useMutation({
    mutationFn: () =>
      submitFeedback({
        body: text.trim(),
        source,
        idempotencyKey: key,
        type,
        // Never sent true for an account that may not ask (the server refuses it as well).
        replyOk: replyAllowed && replyOk,
        routePattern: currentRoutePattern(),
        appVersion: appVersion(),
      }),
    onSuccess: () => onSent?.(),
  });

  const close = (next: boolean): void => {
    if (!next) {
      // A fresh key and an empty form for the next opening; a sent one stays sent.
      setType("bug");
      setText("");
      setReplyOk(false);
      setKey(newKey());
      send.reset();
    }
    onOpenChange(next);
  };

  const sent = send.isSuccess;
  const trimmed = text.trim();

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="feedback-dialog" className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send feedback</DialogTitle>
          <DialogDescription>
            {sent
              ? "Thanks — your feedback was sent to the Lyceon team."
              : "Tell the Lyceon team what's working and what isn't. Only the team sees this; it's never published."}
          </DialogDescription>
        </DialogHeader>
        {sent ? (
          <DialogFooter>
            <Button onClick={() => close(false)} data-testid="feedback-done">
              Done
            </Button>
          </DialogFooter>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (trimmed.length > 0 && !send.isPending) send.mutate();
            }}
          >
            <div className="space-y-2">
              <p id="feedback-type-label" className="text-sm font-medium">
                Type
              </p>
              <FeedbackTypeControl value={type} onChange={setType} />
            </div>
            <div className="ph-no-capture space-y-2">
              <Label htmlFor="feedback-text">Your feedback</Label>
              <Textarea
                id="feedback-text"
                data-testid="feedback-text"
                value={text}
                maxLength={FEEDBACK_MAX_LENGTH}
                onChange={(event) => setText(event.target.value)}
                rows={5}
              />
              <p className="text-sm text-muted-foreground">
                Please don&apos;t include personal details like your full name,
                address or phone number.
              </p>
            </div>
            {replyAllowed ? (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="feedback-reply-ok"
                  data-testid="feedback-reply-ok"
                  checked={replyOk}
                  onCheckedChange={(checked) => setReplyOk(checked === true)}
                />
                <Label
                  htmlFor="feedback-reply-ok"
                  className="text-sm font-normal"
                >
                  May we reply by email?
                </Label>
              </div>
            ) : null}
            <p
              className="text-sm text-muted-foreground"
              data-testid="feedback-context-note"
            >
              We&apos;ll include the page you&apos;re on and the app version.
            </p>
            {send.isError ? (
              <p className="text-sm text-destructive" role="alert">
                Your feedback couldn&apos;t be sent. Please try again.
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => close(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="feedback-send"
                disabled={trimmed.length === 0 || send.isPending}
              >
                {send.isPending ? "Sending…" : "Send feedback"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The Settings / Help entry. Nothing for an admin (no student/guardian bucket). */
export function FeedbackButton({
  source,
  label = "Send feedback",
  variant = "default",
}: {
  source: Extract<FeedbackSource, "settings" | "help">;
  label?: string;
  variant?: Surface;
}): JSX.Element | null {
  const audience = useFeedbackAudience();
  const [open, setOpen] = useState(false);
  if (audience === null) return null;
  return (
    <>
      <Button
        variant={SURFACE[variant].outline}
        className="self-start"
        onClick={() => setOpen(true)}
        data-testid={`feedback-open-${source}`}
      >
        {label}
      </Button>
      <FeedbackDialog open={open} onOpenChange={setOpen} source={source} />
    </>
  );
}

/** A Settings row in the same bordered-row pattern as its neighbours. */
export function FeedbackSettingsRow({
  variant = "default",
}: {
  variant?: Surface;
} = {}): JSX.Element | null {
  const audience = useFeedbackAudience();
  if (audience === null) return null;
  const look = SURFACE[variant];
  return (
    <div className={look.row} data-testid="feedback-settings-row">
      <div className="flex flex-col gap-1">
        <p className={look.rowTitle}>Feedback</p>
        <p className={look.muted}>Send the Lyceon team a private note.</p>
      </div>
      <FeedbackButton source="settings" variant={variant} />
    </div>
  );
}

/**
 * The account-menu entry (owner answer 2026-10-05: guardians reach feedback from their avatar
 * menu; final brief 2026-10-20 §3: students too, on every app-shell page — the practice, review
 * and test screens use the focus layout, which has no account menu). The dialog cannot live inside the dropdown — the menu
 * unmounts its content when it closes — so the shell renders `dialog` beside the menu and puts
 * `item` (null for an ineligible account) among its menu items.
 */
export function useFeedbackMenuEntry(): {
  item: ReactNode;
  dialog: ReactNode;
} {
  const audience = useFeedbackAudience();
  const [open, setOpen] = useState(false);
  if (audience === null) return { item: null, dialog: null };
  return {
    item: (
      <DropdownMenuItem
        onClick={() => setOpen(true)}
        data-testid="menu-send-feedback"
      >
        <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
        Send feedback
      </DropdownMenuItem>
    ),
    dialog: <FeedbackDialog open={open} onOpenChange={setOpen} source="menu" />,
  };
}
