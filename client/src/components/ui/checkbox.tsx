import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { LYC_FOCUS } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-59; UI-46 (student variants extend the shared primitive);
 *       DESIGN.md §1 "Hierarchy", "Focus and motion"] | @implemented [2026-10-03]
 * plain English: the one Checkbox. `variant="lyc"` is the student box: 20px, a 1px --ink-strong
 * border on --sheet, filled --primary-bg with a --primary-ink tick when checked (so it inverts
 * with the primary button in dark), and the 3px --focus ring. Keyed to the student tokens inside
 * a `.lyc` root. The default variant is the existing box, unchanged.
 */
const checkboxVariants = {
  default:
    "h-4 w-4 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
  lyc: `${LYC_FOCUS} h-5 w-5 rounded-sm border border-lyc-ink-strong bg-lyc-sheet data-[state=checked]:bg-lyc-primary-bg data-[state=checked]:text-lyc-primary-ink`,
} as const;

type CheckboxProps = React.ComponentPropsWithoutRef<
  typeof CheckboxPrimitive.Root
> & { variant?: keyof typeof checkboxVariants };

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, variant = "default", ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-variant={variant === "default" ? undefined : variant}
    className={cn(
      "peer shrink-0 disabled:cursor-not-allowed disabled:opacity-50",
      checkboxVariants[variant],
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
