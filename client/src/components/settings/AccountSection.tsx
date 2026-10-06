/**
 * Settings → Account: email and sign-in method (read-only), Change password, Delete account.
 *
 * @spec [DESIGN.md §4 Settings "Account" (change password with the current password required;
 *        hidden for Google-only accounts, F-38; the Delete account box); prototype
 *        Settings.dc.html; student-UI register UI-S4 (`POST /api/auth/change-password` requires
 *        the current password), OQ-26 (`hasPassword` on GET /api/profile), OQ-41 (owner ruling
 *        2026-10-03: `hasPassword: null` shows the form; the server's F-38 refusal stays the
 *        authority), SCL-090 (the email-suppression notice sits above the control that can
 *        create a suppression), Doc-01_V8 §40.1 (delete account)] | @implemented [2026-10-03]
 *
 * plain English: the email and sign-in method are shown, never edited. The password form shows
 * unless the profile says `hasPassword: false` (`showsChangePassword`); the server checks the
 * identity itself and refuses a Google-only account, so the form cannot grant anything. The
 * body always carries the current password (the shared `.strict()` schema refuses one without
 * it), and the new password is checked against the shared policy before it is sent. Refusals the
 * server words (CURRENT_PASSWORD_INCORRECT, PASSWORD_UNCHANGED, NO_PASSWORD_IDENTITY) are shown as
 * sent. The passwords live in this form's state only; nothing logs them.
 *
 * edge cases: `hasPassword: null` (the identity read failed) shows no sign-in method line, since
 * it is unknown, but does show the form (OQ-41).
 */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { changePasswordRequestSchema } from "@lyceon/shared/password-policy";
import { DeleteAccountBox } from "@/components/account-deletion/DeleteAccountCard";
import { EmailNotificationsCard } from "@/components/account/EmailNotificationsCard";
import { MarketingEmailCard } from "@/components/account/MarketingEmailCard";
import { FeedbackSettingsRow } from "@/components/product-feedback/FeedbackDialog";
import { Button } from "@/components/ui/button";
import {
  showsChangePassword,
  type ProfileHydrationUser,
} from "@/hooks/useProfileQuery";
import { changePassword, settingsErrorMessage } from "@/lib/settings-api";
import {
  BoxHeading,
  FIELD_HELP,
  FIELD_INPUT,
  FIELD_LABEL,
  SectionHeading,
  SheetBox,
} from "./settings-ui";

/** The sign-in method line; `null` (unknown) shows none. */
function signInMethod(hasPassword: boolean | null): string | null {
  if (hasPassword === null) return null;
  return hasPassword ? "Email and password" : "Google";
}

export function AccountSection({
  email,
  hasPassword,
}: {
  email: string;
  hasPassword: ProfileHydrationUser["hasPassword"];
}): JSX.Element {
  const headingId = useId();
  const method = signInMethod(hasPassword);
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-6"
      data-testid="settings-account"
    >
      <SectionHeading id={headingId}>Account</SectionHeading>
      <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 text-[17px] sm:grid-cols-[180px_1fr] sm:gap-y-3.5">
        <dt className="text-lyc-muted">Email</dt>
        <dd
          className="m-0 mb-2 break-words text-lyc-ink sm:mb-0"
          data-testid="settings-email"
        >
          {email}
        </dd>
        {method === null ? null : (
          <>
            <dt className="text-lyc-muted">Sign-in method</dt>
            <dd
              className="m-0 text-lyc-ink"
              data-testid="settings-sign-in-method"
            >
              {method}
            </dd>
          </>
        )}
      </dl>
      <p className={FIELD_HELP}>To change your email, contact support.</p>

      {showsChangePassword(hasPassword) ? <ChangePasswordBox /> : null}

      {/* SCL-090: renders only when this address is suppressed. */}
      <EmailNotificationsCard variant="lyc" />
      {/* Plan R26 / R28 (Q5, Q6; owner answers 2026-10-05): the marketing toggle and private
          feedback, each self-contained and rendering nothing for an account that cannot use it. */}
      <MarketingEmailCard variant="lyc" />
      <FeedbackSettingsRow variant="lyc" />
      <DeleteAccountBox />
    </section>
  );
}

function ChangePasswordBox(): JSX.Element {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setDone(true);
    },
  });

  const error =
    localError ??
    (mutation.error ? settingsErrorMessage(mutation.error) : null);

  return (
    <SheetBox data-testid="settings-change-password">
      <BoxHeading>Change password</BoxHeading>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setDone(false);
          mutation.reset();
          if (next !== confirm) {
            setLocalError("Passwords do not match");
            return;
          }
          const parsed = changePasswordRequestSchema.safeParse({
            current_password: current,
            new_password: next,
          });
          if (!parsed.success) {
            setLocalError(
              parsed.error.issues[0]?.message ??
                "Password does not meet the requirements",
            );
            return;
          }
          setLocalError(null);
          mutation.mutate(parsed.data);
        }}
      >
        <label className={FIELD_LABEL}>
          Current password
          <input
            type="password"
            value={current}
            autoComplete="current-password"
            onChange={(event) => setCurrent(event.target.value)}
            className={FIELD_INPUT}
            data-testid="settings-current-password"
          />
        </label>
        <label className={FIELD_LABEL}>
          New password
          <input
            type="password"
            value={next}
            autoComplete="new-password"
            onChange={(event) => setNext(event.target.value)}
            className={FIELD_INPUT}
            data-testid="settings-new-password"
          />
          <span className={FIELD_HELP}>
            At least 8 characters, including a letter and a number.
          </span>
        </label>
        <label className={FIELD_LABEL}>
          Confirm new password
          <input
            type="password"
            value={confirm}
            autoComplete="new-password"
            onChange={(event) => setConfirm(event.target.value)}
            className={FIELD_INPUT}
            data-testid="settings-confirm-password"
          />
        </label>
        {error === null ? null : (
          <p
            className="m-0 text-lyc-body text-lyc-danger"
            role="alert"
            data-testid="settings-password-error"
          >
            {error}
          </p>
        )}
        {done ? (
          <p
            className="m-0 text-lyc-body font-semibold text-lyc-ok"
            role="status"
            data-testid="settings-password-updated"
          >
            Your password has been successfully changed.
          </p>
        ) : null}
        <Button
          type="submit"
          variant="lyc-outline"
          className="self-start"
          disabled={mutation.isPending || current.length === 0}
          data-testid="settings-update-password"
        >
          Update password
        </Button>
      </form>
    </SheetBox>
  );
}
