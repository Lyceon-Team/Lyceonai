/**
 * The two looks the Q5/Q6 components come in: `default` (guardian and admin pages, shadcn
 * tokens) and `lyc` (student pages inside the `.lyc` root, student tokens — so they follow the
 * student theme, light or dark). Same words and behaviour either way; only classes differ.
 *
 * @spec [DESIGN.md §1 (student tokens; one primary action; lyc-quiet for "Not now"); UI-46
 *       button variants] | @implemented [2026-10-05]
 *
 * Dialogs are always `default`: Radix portals them to <body>, outside the `.lyc` root, where the
 * student tokens do not apply.
 */
export type Surface = "default" | "lyc";

export const SURFACE = {
  default: {
    box: "rounded-lg border border-border bg-card p-5 text-card-foreground",
    row: "flex items-start justify-between gap-4 rounded-md border border-border p-4",
    title: "text-base font-semibold",
    rowTitle: "font-medium",
    muted: "text-sm text-muted-foreground",
    note: "text-xs text-muted-foreground",
    error: "text-sm text-destructive",
    primary: "default",
    outline: "outline",
    quiet: "ghost",
    checkbox: "default",
    star: "text-foreground",
    starOff: "text-muted-foreground",
  },
  lyc: {
    box: "rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 text-lyc-ink sm:px-7",
    row: "flex flex-col gap-4 rounded-lg border border-lyc-rule bg-lyc-sheet px-5 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-7",
    title: "m-0 font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong",
    rowTitle:
      "m-0 font-lyc-serif text-[21px] font-semibold text-lyc-ink-strong",
    muted: "m-0 text-lyc-body text-lyc-muted",
    note: "m-0 text-lyc-meta-lg text-lyc-muted",
    error: "m-0 text-lyc-body text-lyc-danger",
    primary: "lyc-primary",
    outline: "lyc-outline",
    quiet: "lyc-quiet",
    checkbox: "lyc",
    star: "text-lyc-ink-strong",
    starOff: "text-lyc-muted",
  },
} as const;
