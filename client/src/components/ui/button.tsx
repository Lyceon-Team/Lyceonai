import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1 "Hierarchy", "Focus and motion"] |
 *       @implemented [2026-10-03]
 * plain English: the one Button. The student variants (`lyc-*`) and sizes extend it rather than
 * forking a second button. The focus ring for them comes from the variant classes below (3px
 * --focus outline, 2px offset), and the box-shadow ring of the base classes is switched off.
 * Exported (UI-41) so the shells' links take the same ring instead of a second copy of it.
 */
export const LYC_FOCUS =
  "transition-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus focus-visible:ring-0 focus-visible:ring-offset-0";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary shadow-sm",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
        outline:
          "border-2 border-border bg-transparent text-foreground hover:bg-primary hover:text-primary-foreground",
        secondary:
          "bg-secondary text-foreground hover:bg-muted border border-border",
        ghost: "text-foreground hover:bg-secondary hover:text-foreground",
        link: "text-foreground underline-offset-4 hover:underline",
        /* Student UI (register UI-46; DESIGN.md §1 "Hierarchy"). Keyed to the student tokens, so
           they render correctly only inside the `.lyc` root every student shell renders. The
           existing variants above stay as they are for guardian, admin and marketing pages.
           - lyc-primary: the ONE primary action on a screen, filled --primary-bg.
           - lyc-outline: every other button, 1px --ink-strong border.
           - lyc-quiet:   a borderless text button (modal "Not now", close, icon buttons).
           - lyc-link:    a real inline link; the only variant that is underlined.
           Focus: the 3px --focus ring with 2px offset, never the shadcn box-shadow ring. No
           shadows, no gradients; hover lightens or tints, it never animates. */
        "lyc-primary": `${LYC_FOCUS} border-0 bg-lyc-primary-bg font-semibold text-lyc-primary-ink hover:brightness-110`,
        "lyc-outline": `${LYC_FOCUS} border border-lyc-ink-strong bg-transparent font-semibold text-lyc-ink-strong hover:bg-lyc-hover`,
        "lyc-quiet": `${LYC_FOCUS} border-0 bg-transparent font-semibold text-lyc-ink-strong hover:bg-lyc-hover`,
        "lyc-link": `${LYC_FOCUS} h-auto rounded-none border-0 bg-transparent p-0 font-semibold text-lyc-ink-strong underline underline-offset-4 hover:no-underline`,
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
        /* Student sizes (DESIGN.md §1; prototype buttons): 44px with 16px text, 52px with 18px
           text for the page's primary call to action, and a 44px square icon button. */
        lyc: "h-11 rounded-md px-5 text-lyc-body",
        "lyc-lg": "h-[52px] rounded-md px-7 text-[18px]",
        "lyc-icon": "h-11 w-11 rounded-md",
      },
    },
    /* A student variant left on the default size gets the student size, never the 14px shadcn
       one; the link variant takes the body size only, because it sits inline in text. */
    compoundVariants: [
      {
        variant: ["lyc-primary", "lyc-outline", "lyc-quiet"],
        size: "default",
        class: "h-11 rounded-md px-5 text-lyc-body",
      },
      { variant: "lyc-link", class: "h-auto px-0 py-0 text-lyc-body" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
