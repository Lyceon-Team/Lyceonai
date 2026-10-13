/**
 * Settings → Notifications: one toggle, "Daily question email".
 *
 * @spec [owner ruling on #1166 (Karl, 2026-10-09) item 2: "Settings → Notifications returns with
 *        one toggle: 'Daily question email' (on = the email channel for qotd_daily). It reads and
 *        writes the same preference the pop-up and the unsubscribe link use. One source of
 *        truth"; supersedes student-UI register OQ-27 (2026-10-02, no Notifications section);
 *        DESIGN.md §4 Settings; Coding Standards §11.2, §11.3] | @implemented [2026-10-09]
 *
 * plain English: a switch over GET/PUT /api/qotd/email-preference. It shows the server's answer,
 * never an optimistic guess. Turning it on is a consent given against the same wording version as
 * the Home prompt's "Yes" (the server logs it); turning it off withdraws it and stops the prompt.
 * When the 7-send sunset has paused the email, the switch stays on and a "Resume" button turns it
 * back on through the same write. An account that cannot have the email (under 13) sees the
 * switch off and disabled; if it is somehow on, it stays usable so it can be turned off.
 * The in-app reminder needs no setting: every student gets it.
 */
import { useId } from "react";
import { QOTD_EMAIL_SETTING_LABEL } from "@lyceon/shared/home-qotd-schema";
import { Button, LYC_FOCUS } from "@/components/ui/button";
import {
  useQotdEmailPreference,
  useSetQotdEmailPreference,
} from "@/hooks/useHomeQotd";
import { cn } from "@/lib/utils";
import { FIELD_HELP, SectionHeading, SheetBox } from "./settings-ui";

export function NotificationsSection(): JSX.Element {
  const headingId = useId();
  const labelId = useId();
  const preference = useQotdEmailPreference();
  const save = useSetQotdEmailPreference();

  const data = preference.data;
  const on = data?.enabled === true;
  const locked = data === undefined || (!data.eligible && !on);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-5"
      data-testid="settings-notifications"
    >
      <SectionHeading id={headingId}>Notifications</SectionHeading>
      <SheetBox>
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <p
              id={labelId}
              className="m-0 text-[17px] font-semibold text-lyc-ink"
            >
              {QOTD_EMAIL_SETTING_LABEL}
            </p>
            <p className={FIELD_HELP}>
              Today&apos;s question in your inbox at 5 PM Central, on days you
              haven&apos;t answered a question yet.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby={labelId}
            disabled={locked || save.isPending}
            onClick={() => save.mutate(!on)}
            data-testid="settings-qotd-email-toggle"
            className={cn(
              LYC_FOCUS,
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50",
              on
                ? "border-lyc-ink-strong bg-lyc-ink-strong"
                : "border-lyc-input-bd bg-lyc-paper",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-5 w-5 rounded-full transition-transform motion-reduce:transition-none",
                on
                  ? "translate-x-6 bg-lyc-paper"
                  : "translate-x-1 bg-lyc-muted",
              )}
            />
          </button>
        </div>
        {data !== undefined && !data.eligible && !on ? (
          <p
            className={FIELD_HELP}
            data-testid="settings-qotd-email-ineligible"
          >
            Daily question emails aren&apos;t available for this account.
          </p>
        ) : null}
        {on && data?.paused ? (
          <div
            className="flex flex-wrap items-center gap-3"
            data-testid="settings-qotd-email-paused"
          >
            <p className={FIELD_HELP}>
              Paused after 7 emails in a row went unanswered.
            </p>
            <Button
              type="button"
              variant="lyc-outline"
              disabled={save.isPending}
              onClick={() => save.mutate(true)}
              data-testid="settings-qotd-email-resume"
            >
              Resume
            </Button>
          </div>
        ) : null}
        <p className={FIELD_HELP}>
          You&apos;ll still see the daily question in your notifications.
        </p>
        {preference.isError || save.isError ? (
          <p className="m-0 text-lyc-meta-lg text-lyc-danger" role="alert">
            {save.isError
              ? "Your choice couldn’t be saved. Please try again."
              : "We couldn’t load this setting. Please try again."}
          </p>
        ) : null}
      </SheetBox>
    </section>
  );
}
