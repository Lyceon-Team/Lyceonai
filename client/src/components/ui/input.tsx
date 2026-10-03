import * as React from "react";

import { LYC_FOCUS } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-59 (bare-card pages); UI-46 (student variants extend the shared
 *       primitive, never fork it); DESIGN.md §1 "Focus and motion", "Nothing below 14px"] |
 *       @implemented [2026-10-03]
 * plain English: the one text Input. `variant="lyc"` is the student field from the Settings
 * prototype (46px, 17px text, a 1px --input-bd border on --sheet, the 3px --focus ring), keyed to
 * the student tokens, so it renders correctly only inside a `.lyc` root (every student shell).
 * The default variant is the existing field, unchanged for guardian, admin and marketing pages.
 * `LYC_INPUT` is the same field as a class string, for the Settings sections that draw a native
 * input or select (`settings-ui.tsx` FIELD_INPUT), so the two never drift apart.
 */
export const LYC_INPUT = `${LYC_FOCUS} h-[46px] w-full rounded-md border border-lyc-input-bd bg-lyc-sheet px-3.5 text-[17px] font-normal text-lyc-ink`;

const inputVariants = {
  default:
    "flex h-11 w-full rounded-lg border-2 border-border bg-card px-4 py-2 text-base text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-gray-800 focus-visible:ring-offset-2 focus-visible:border-border disabled:cursor-not-allowed disabled:opacity-50 transition-colors md:text-sm",
  lyc: `${LYC_INPUT} flex placeholder:text-lyc-muted disabled:cursor-not-allowed disabled:opacity-60`,
} as const;

export type InputVariant = keyof typeof inputVariants;

type InputProps = React.ComponentProps<"input"> & { variant?: InputVariant };

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, variant = "default", ...props }, ref) => {
    return (
      <input
        type={type}
        data-variant={variant === "default" ? undefined : variant}
        className={cn(inputVariants[variant], className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
