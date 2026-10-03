"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { LYC_INPUT } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-59; UI-46 (student variants extend the shared primitive);
 *       DESIGN.md §1 (tokens only, no motion beyond LISA's dots, nothing below 14px)] |
 *       @implemented [2026-10-03]
 * plain English: `variant="lyc"` on the trigger, the list and each item is the student select:
 * the trigger is the student field (`LYC_INPUT`, the 3px --focus ring), the list a hairline-ruled
 * --sheet box with no shadow and no open/close animation, the items 16px with a --hover
 * highlight. The list portals onto <body>, outside the page's `.lyc` root, so the lyc list
 * carries its own `.lyc` root to read the tokens (and the device theme). The default variant is
 * the existing select, unchanged for guardian, admin and the other pages.
 */
type SelectVariant = "default" | "lyc";

const triggerVariants: Record<SelectVariant, string> = {
  default:
    "flex h-11 w-full items-center justify-between rounded-lg border-2 border-border bg-card px-4 py-2 text-sm text-foreground ring-offset-background data-[placeholder]:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-warm-gray-800 focus:ring-offset-2 focus:border-border disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 transition-colors",
  lyc: `${LYC_INPUT} flex items-center justify-between data-[placeholder]:text-lyc-muted disabled:cursor-not-allowed disabled:opacity-60 [&>span]:line-clamp-1`,
};

const triggerIconVariants: Record<SelectVariant, string> = {
  default: "h-4 w-4 text-muted-foreground",
  lyc: "h-4 w-4 text-lyc-muted",
};

const contentVariants: Record<SelectVariant, string> = {
  default:
    "rounded-lg border border-border bg-card text-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
  lyc: "lyc rounded-md border border-lyc-rule bg-lyc-sheet text-lyc-ink",
};

const itemVariants: Record<SelectVariant, string> = {
  default: "text-sm focus:bg-secondary focus:text-foreground",
  lyc: "text-lyc-body text-lyc-ink focus:bg-lyc-hover focus:text-lyc-ink-strong",
};

const Select = SelectPrimitive.Root;

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & {
    variant?: SelectVariant;
  }
>(({ className, children, variant = "default", ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(triggerVariants[variant], className)}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className={triggerIconVariants[variant]} />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content> & {
    variant?: SelectVariant;
  }
>(
  (
    { className, children, position = "popper", variant = "default", ...props },
    ref,
  ) => (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        className={cn(
          "relative z-50 max-h-[--radix-select-content-available-height] min-w-[8rem] overflow-y-auto overflow-x-hidden origin-[--radix-select-content-transform-origin]",
          contentVariants[variant],
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className,
        )}
        position={position}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  ),
);
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn("py-1.5 pl-8 pr-2 text-sm font-semibold", className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    variant?: SelectVariant;
  }
>(({ className, children, variant = "default", ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full cursor-default select-none items-center rounded-md py-2 pl-8 pr-3 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      itemVariants[variant],
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>

    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
));
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
