import { type AppNoticeProps, AppNotice } from "@/components/feedback/AppNotice";

type SessionNoticeProps = {
  title?: string;
  message?: string;
  onRefreshSession?: () => void;
  onSignInAgain?: () => void;
  mode?: AppNoticeProps["mode"];
  className?: string;
};

export function SessionNotice({
  title = "Your session needs to be refreshed.",
  message = "Refresh your session or sign in again to continue.",
  onRefreshSession,
  onSignInAgain,
  mode = "inline",
  className,
}: SessionNoticeProps) {
  return (
    <AppNotice
      variant="session"
      title={title}
      message={message}
      actionLabel={onRefreshSession ? "Refresh session" : undefined}
      onAction={onRefreshSession}
      secondaryActionLabel={onSignInAgain ? "Sign in again" : undefined}
      onSecondaryAction={onSignInAgain}
      mode={mode}
      className={className}
    />
  );
}
