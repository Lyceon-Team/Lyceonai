/**
 * Private feedback: a dialog with one text box, and the entry points that open it.
 *
 * @spec [docs/plans/seo/seo-marketing-vertical.md R28 ("private feedback (always available)"),
 *       row Q6; owner answers 2026-10-05: stored only; self-contained so the student-UI rebuild
 *       (UI-58) can mount it on its Help page; guardians reach it from the avatar menu]
 *       | @implemented [2026-10-05]
 *
 * plain English: `FeedbackDialog` is controlled (`open` / `onOpenChange`) and owns everything
 * else — the text, the idempotency key (one per opening, so a double click or a retry stores one
 * row), the send, the thank-you and the error. `FeedbackButton` is the outline-button entry for
 * Settings or Help. Feedback is open to every student and guardian at any age (R28 "always
 * available"); an admin account gets no entry, and the server refuses one anyway.
 *
 * Privacy: the text goes to the server and nowhere else — no analytics, no log. The area carries
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  submitFeedback,
  useFeedbackAudience,
} from "@/lib/product-feedback-api";
import { SURFACE, type Surface } from "./surface";
import {
  FEEDBACK_MAX_LENGTH,
  type FeedbackSource,
} from "../../../../packages/shared/src/product-feedback-schema";

function newKey(): string {
  return crypto.randomUUID();
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
  const [text, setText] = useState("");
  const [key, setKey] = useState(newKey);
  const send = useMutation({
    mutationFn: () =>
      submitFeedback({ body: text.trim(), source, idempotencyKey: key }),
    onSuccess: () => onSent?.(),
  });

  const close = (next: boolean): void => {
    if (!next) {
      // A fresh key and an empty box for the next opening; a sent one stays sent.
      setText("");
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
              <p className="text-xs text-muted-foreground">
                Please don&apos;t include personal details like your full name,
                address or phone number.
              </p>
            </div>
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
 * The avatar-menu entry (owner answer 2026-10-05: guardians reach feedback from their avatar
 * menu, since they have no Help page). The dialog cannot live inside the dropdown — the menu
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
