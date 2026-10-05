import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * @spec [student-UI register UI-46; DESIGN.md §1 type scale] | @implemented [2026-10-03]
 * plain English: tailwind-merge only recognises a `text-*` class as a font size when the value is
 * a size it knows (`text-sm`, `text-[18px]`). The student type scale (`text-lyc-body`,
 * `text-lyc-title`, … from tailwind.config.ts `fontSize`) looks like a colour to it, so
 * `cn("text-lyc-body text-lyc-primary-ink")` silently dropped the size. Registering the scale as
 * font sizes keeps a size and a colour side by side, and lets a later size override an earlier one.
 */
const LYC_FONT_SIZES = [
  "lyc-title",
  "lyc-section",
  "lyc-panel",
  "lyc-body",
  "lyc-body-lg",
  "lyc-meta",
  "lyc-meta-lg",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: LYC_FONT_SIZES }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
