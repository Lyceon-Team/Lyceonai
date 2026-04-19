import { AppNotice, type AppNoticeProps } from "@/components/feedback/AppNotice";

type RecoveryNoticeProps = {
  title?: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  mode?: AppNoticeProps["mode"];
  className?: string;
};

export function RecoveryNotice({
  title = "We couldn’t load this right now.",
  message = "Try again. If this keeps happening, refresh the page or contact support.",
  retryLabel = "Try again",
  onRetry,
  mode = "inline",
  className,
}: RecoveryNoticeProps) {
  return (
    <AppNotice
      variant="neutral"
      title={title}
      message={message}
      actionLabel={onRetry ? retryLabel : undefined}
      onAction={onRetry}
      mode={mode}
      className={className}
    />
  );
}
