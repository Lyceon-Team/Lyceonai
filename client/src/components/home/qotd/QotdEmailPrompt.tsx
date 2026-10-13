/**
 * "Keep your streak alive 🔥" — the daily-email prompt after a Question of the Day answer.
 *
 * @spec [owner brief "Question of the Day on Home" (Karl, 2026-10-08/09) "Email prompt rule":
 *       exact copy (title, body, "Yes" primary, "Not now", and from the 3rd ask a text link
 *       "Don't ask again"); never for under-13s or students who already said yes (server-decided:
 *       `show_email_prompt`); acceptance 10 (focus and keyboard behaviour); SCL-225]
 *       | @implemented [2026-10-09]
 *
 * plain English: the shared student Modal (Radix Dialog: focus moves in and is trapped, Esc
 * closes, focus returns to what opened it). "Yes" has focus first. Closing it any way other than
 * a button (Esc, the ✕, the scrim) counts as "Not now" — the student said no for today, which is
 * what dismissing means. Whether to show it, and whether "Don't ask again" is offered, are the
 * server's answers; this component only draws them.
 */
import { QOTD_EMAIL_PROMPT_COPY } from "@lyceon/shared/home-qotd-schema";
import { Modal } from "@/components/student-ui";
import { Button } from "@/components/ui/button";
import type { QotdEmailDecision } from "@/hooks/useHomeQotd";

export function QotdEmailPrompt({
  open,
  showDontAskAgain,
  pending,
  error,
  onDecide,
}: {
  open: boolean;
  showDontAskAgain: boolean;
  pending: boolean;
  error: string | null;
  onDecide: (decision: QotdEmailDecision) => void;
}): JSX.Element {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onDecide("not_now");
      }}
      title={QOTD_EMAIL_PROMPT_COPY.title}
      description={QOTD_EMAIL_PROMPT_COPY.body}
      data-testid="qotd-email-prompt"
      footer={
        <div className="flex w-full flex-col gap-4">
          {error !== null ? (
            <p role="alert" className="m-0 text-base text-lyc-danger">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="lyc-primary"
              size="lyc-lg"
              autoFocus
              pending={pending}
              disabled={pending}
              onClick={() => onDecide("grant")}
              data-testid="qotd-email-yes"
            >
              {QOTD_EMAIL_PROMPT_COPY.yes}
            </Button>
            <Button
              type="button"
              variant="lyc-outline"
              size="lyc-lg"
              disabled={pending}
              onClick={() => onDecide("not_now")}
              data-testid="qotd-email-not-now"
            >
              {QOTD_EMAIL_PROMPT_COPY.notNow}
            </Button>
          </div>
          {showDontAskAgain ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => onDecide("never")}
              className="self-start bg-transparent p-0 text-base font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline"
              data-testid="qotd-email-never"
            >
              {QOTD_EMAIL_PROMPT_COPY.never}
            </button>
          ) : null}
        </div>
      }
    />
  );
}
