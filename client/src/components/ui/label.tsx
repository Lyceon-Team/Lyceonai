import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-59; UI-46 (student variants extend the shared primitive);
 *       DESIGN.md §1 (tokens only, nothing below 14px)] | @implemented [2026-10-03]
 * plain English: the one Label. `variant="lyc"` is the student field label from the Settings
 * prototype (17px, semibold, --ink), keyed to the student tokens inside a `.lyc` root. The
 * default variant is the existing 14px label, unchanged for the pages that use it today.
 */
const labelVariants = cva(
  "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
  {
    variants: {
      variant: {
        default: "text-sm font-medium leading-none",
        lyc: "text-[17px] font-semibold leading-snug text-lyc-ink",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, variant, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants({ variant }), className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label };
