import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

const Popover = PopoverPrimitive.Root;

const PopoverTrigger = PopoverPrimitive.Trigger;

/**
 * @spec [production QA 2026-10-07 items 12 and 13 (the notifications popover in dark mode, on the
 *       student tokens); student-UI register §8 F-70, F-65] | @implemented [2026-10-07]
 * plain English: the same portal wrapper `DropdownMenuContent` has had since F-70.
 * `portalClassName` wraps the portalled popover in one element; the App shell's bell passes
 * `lyc contents`, so the student tokens (light or dark) resolve on <body>, outside the shell's
 * `.lyc` root, and `portalThemeLock` carries the shell's lock onto that wrapper. Callers that
 * pass neither render exactly as before (the guardian shell's bell, every other popover).
 */
type PopoverContentProps = React.ComponentPropsWithoutRef<
  typeof PopoverPrimitive.Content
> & {
  portalClassName?: string;
  portalThemeLock?: "light" | null;
};

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(
  (
    {
      className,
      align = "center",
      sideOffset = 4,
      portalClassName,
      portalThemeLock = null,
      ...props
    },
    ref,
  ) => {
    const content = (
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
          className,
        )}
        {...props}
      />
    );
    return (
      <PopoverPrimitive.Portal>
        {portalClassName === undefined ? (
          content
        ) : (
          <div
            className={portalClassName}
            data-theme-lock={portalThemeLock ?? undefined}
          >
            {content}
          </div>
        )}
      </PopoverPrimitive.Portal>
    );
  },
);
PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
