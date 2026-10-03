import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1 "Direction", "Focus and motion"] |
 *       @implemented [2026-10-03]
 * plain English: the one Tabs. `TabsList` takes an optional `variant`; "lyc" is the student
 * look (a row of text tabs on a hairline rule, the active one underlined in --ink-strong, the 3px
 * --focus ring), keyed to the student tokens, so it renders correctly inside the `.lyc` root.
 * The triggers read the variant from the list through context, so a page sets it once. Arrow-key
 * switching, Home/End and the tab/tabpanel roles all come from Radix. The default variant is the
 * existing pill look, unchanged for the pages that use it today.
 */
type TabsVariant = "default" | "lyc";

const TabsVariantContext = React.createContext<TabsVariant>("default");

const Tabs = TabsPrimitive.Root;

const listVariants: Record<TabsVariant, string> = {
  default:
    "inline-flex h-11 items-center justify-center rounded-lg bg-secondary p-1 text-muted-foreground",
  lyc: "flex items-end gap-6 border-b border-lyc-rule text-lyc-muted",
};

const triggerVariants: Record<TabsVariant, string> = {
  default:
    "inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-gray-800 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
  lyc: "-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 border-transparent px-0.5 text-lyc-body font-semibold text-lyc-muted hover:text-lyc-ink-strong focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus disabled:pointer-events-none disabled:opacity-50 data-[state=active]:border-lyc-ink-strong data-[state=active]:text-lyc-ink-strong",
};

const contentVariants: Record<TabsVariant, string> = {
  default:
    "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
  lyc: "mt-6 focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-lyc-focus",
};

type TabsListProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.List
> & { variant?: TabsVariant };

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "default", ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      data-variant={variant}
      className={cn(listVariants[variant], className)}
      {...props}
    />
  </TabsVariantContext.Provider>
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(triggerVariants[variant], className)}
      {...props}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

type TabsContentProps = React.ComponentPropsWithoutRef<
  typeof TabsPrimitive.Content
> & { variant?: TabsVariant };

/* Content sits outside the list, so it takes the variant as its own prop. */
const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(({ className, variant = "default", ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(contentVariants[variant], className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
export type { TabsVariant };
