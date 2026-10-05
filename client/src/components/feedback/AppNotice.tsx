import { type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  Info,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1; audit §6.2 "Alert / notice", "Brand colors as
 *       raw hex"] | @implemented [2026-10-03]
 * plain English: the one notice. The `lyc-*` variants are the student look, keyed to the student
 * tokens (so they render inside the `.lyc` root): a hairline-ruled block, body-size text at full
 * contrast (no opacity), student outline/quiet buttons, and no shadow even when floating.
 *   lyc-neutral  the plain note, on --sheet;
 *   lyc-info     on --chip;
 *   lyc-warning  a margin note: --margin with a --rule-strong rule (no mastery colour, which
 *                means a level, never a warning);
 *   lyc-danger   --danger on --danger-bg, announced with role="alert";
 *   lyc-success  on --paper with an --ok icon.
 * Every other variant renders as before; the session and premium tones now name the brand tokens
 * (`brand-cream`, `brand-navy`) instead of retyping their hex values.
 */
export type AppNoticeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "session"
  | "premium"
  | "lyc-neutral"
  | "lyc-info"
  | "lyc-warning"
  | "lyc-danger"
  | "lyc-success";

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
  "data-testid"?: string;
};

const variantClasses: Record<AppNoticeVariant, string> = {
  neutral: "border-border/80 bg-card text-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-900",
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  session: "border-amber-200 bg-brand-cream text-brand-navy",
  premium: "border-brand-navy/25 bg-brand-cream text-brand-navy",
  "lyc-neutral": "border-lyc-rule bg-lyc-sheet text-lyc-ink",
  "lyc-info": "border-lyc-rule bg-lyc-chip text-lyc-ink",
  "lyc-warning": "border-lyc-rule-strong bg-lyc-margin text-lyc-ink",
  "lyc-danger": "border-lyc-danger bg-lyc-danger-bg text-lyc-danger",
  "lyc-success": "border-lyc-rule bg-lyc-paper text-lyc-ink",
};

function isStudentVariant(variant: AppNoticeVariant): boolean {
  return variant.startsWith("lyc-");
}

const variantIcon: Record<AppNoticeVariant, ReactNode> = {
  neutral: <AlertCircle className="h-4 w-4" aria-hidden="true" />,
  info: <Info className="h-4 w-4" aria-hidden="true" />,
  success: <CheckCircle2 className="h-4 w-4" aria-hidden="true" />,
  warning: <TriangleAlert className="h-4 w-4" aria-hidden="true" />,
  session: <ShieldAlert className="h-4 w-4" aria-hidden="true" />,
  premium: <Crown className="h-4 w-4" aria-hidden="true" />,
  "lyc-neutral": <Info className="h-5 w-5" aria-hidden="true" />,
  "lyc-info": <Info className="h-5 w-5" aria-hidden="true" />,
  "lyc-warning": <TriangleAlert className="h-5 w-5" aria-hidden="true" />,
  "lyc-danger": <AlertCircle className="h-5 w-5" aria-hidden="true" />,
  "lyc-success": (
    <CheckCircle2 className="h-5 w-5 text-lyc-ok" aria-hidden="true" />
  ),
};

const modeClasses: Record<NonNullable<AppNoticeProps["mode"]>, string> = {
  inline: "w-full rounded-xl px-4 py-3",
  floating:
    "fixed right-4 bottom-4 z-50 w-[min(440px,calc(100vw-2rem))] rounded-xl px-4 py-3 shadow-lg",
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
  "data-testid": testId,
}: AppNoticeProps) {
  const student = isStudentVariant(variant);
  const urgent = variant === "lyc-danger";
  return (
    <section
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      data-testid={testId}
      data-variant={variant}
      className={cn(
        "border",
        variantClasses[variant],
        modeClasses[mode],
        mode === "compact" ? "text-sm" : "",
        student ? "rounded-lg text-lyc-body shadow-none" : "",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">{icon ?? variantIcon[variant]}</div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold leading-tight">{title}</p>
          {message ? (
            <p
              className={
                student ? "mt-1 text-lyc-body" : "mt-1 text-sm opacity-90"
              }
            >
              {message}
            </p>
          ) : null}
          {(actionLabel && onAction) ||
          (secondaryActionLabel && onSecondaryAction) ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {actionLabel && onAction ? (
                <Button
                  type="button"
                  size={student ? "lyc" : "sm"}
                  variant={student ? "lyc-outline" : "outline"}
                  onClick={onAction}
                >
                  {actionLabel}
                </Button>
              ) : null}
              {secondaryActionLabel && onSecondaryAction ? (
                <Button
                  type="button"
                  size={student ? "lyc" : "sm"}
                  variant={student ? "lyc-quiet" : "ghost"}
                  onClick={onSecondaryAction}
                >
                  {secondaryActionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {dismissible && onDismiss ? (
          <Button
            type="button"
            variant={student ? "lyc-quiet" : "ghost"}
            size={student ? "lyc-icon" : "icon"}
            className={student ? undefined : "h-7 w-7"}
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
