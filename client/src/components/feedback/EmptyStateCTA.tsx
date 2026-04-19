import { Sparkles } from "lucide-react";
import { AppNotice, type AppNoticeProps } from "@/components/feedback/AppNotice";

type EmptyStateCTAProps = {
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  mode?: AppNoticeProps["mode"];
  className?: string;
};

export function EmptyStateCTA({
  title = "Unlock score insights",
  message = "Upgrade to premium to view this insight and personalized recommendations.",
  actionLabel = "View plans",
  onAction,
  mode = "inline",
  className,
}: EmptyStateCTAProps) {
  return (
    <AppNotice
      variant="premium"
      title={title}
      message={message}
      mode={mode}
      className={className}
      actionLabel={onAction ? actionLabel : undefined}
      onAction={onAction}
      icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
    />
  );
}
