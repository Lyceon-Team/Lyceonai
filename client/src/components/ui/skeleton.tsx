import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1 "Focus and motion"] | @implemented [2026-10-03]
 * plain English: the one Skeleton. `variant="lyc"` is the student placeholder: a still block in
 * the --seg-empty tone (the colour of an empty mastery segment), with no pulse, because the
 * design limits motion to the LISA typing dots. It is decorative (`aria-hidden`); the region that
 * is loading announces itself (FullPageLoader carries role="status"). The default
 * variant is the existing pulsing block, unchanged for the pages that use it today.
 */
type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "lyc";
};

function Skeleton({ className, variant = "default", ...props }: SkeletonProps) {
  return (
    <div
      aria-hidden={variant === "lyc" ? true : undefined}
      data-variant={variant}
      className={cn(
        variant === "lyc"
          ? "rounded-md bg-lyc-seg-empty"
          : "animate-pulse rounded-md bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
export type { SkeletonProps };
