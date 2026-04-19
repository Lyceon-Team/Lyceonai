import { type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Crown, Info, ShieldAlert, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AppNoticeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "session"
  | "premium";

export type AppNoticeProps = {
  variant?: AppNoticeVariant;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  dismissible?: boolean;
  onDismiss?: () => void;
  mode?: "inline" | "floating" | "compact";
  icon?: ReactNode;
  className?: string;
};

const variantClasses: Record<AppNoticeVariant, string> = {
  neutral: "border-border/80 bg-card text-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  session: "border-amber-200 bg-[#FFFAEF] text-[#0F2E48]",
  premium: "border-[#0F2E48]/25 bg-[#FFFAEF] text-[#0F2E48]",
};

const variantIcon: Record<AppNoticeVariant, ReactNode> = {
  neutral: <AlertCircle className="h-4 w-4" aria-hidden="true" />,
  info: <Info className="h-4 w-4" aria-hidden="true" />,
  success: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  warning: <TriangleAlert className="h-4 w-4" aria-hidden="true" />,
  session: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
  premium: <Crown className="h-4 w-4" aria-hidden="true" />,
};

const modeClasses: Record<NonNullable<AppNoticeProps["mode"]>, string> = {
  inline: "w-full rounded-xl px-4 py-3",
  floating: "fixed right-4 bottom-4 z-50 w-[min(440px,calc(100vw-2rem))] rounded-xl px-4 py-3 shadow-lg",
  compact: "w-full rounded-lg px-3 py-2",
};

export function AppNotice({
  variant = "neutral",
  title,
  message,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  dismissible = false,
  onDismiss,
  mode = "inline",
  icon,
  className,
}: AppNoticeProps) {
  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        "border",
        variantClasses[variant],
        modeClasses[mode],
        mode === "compact" ? "text-sm" : "",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon ?? variantIcon[variant]}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight">{title}</p>
          {message ? <p className="mt-1 text-sm opacity-90">{message}</p> : null}
          {(actionLabel && onAction) || (secondaryActionLabel && onSecondaryAction) ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {actionLabel && onAction ? (
                <Button type="button" size="sm" variant="outline" onClick={onAction}>
                  {actionLabel}
                </Button>
              ) : null}
              {secondaryActionLabel && onSecondaryAction ? (
                <Button type="button" size="sm" variant="ghost" onClick={onSecondaryAction}>
                  {secondaryActionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {dismissible && onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Dismiss notice"
            onClick={onDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </section>
  );
}
