/**
 * Every page group capture.ts knows, by id. A Wave 5 page PR adds its file here.
 * @implemented [2026-10-03]
 */
import type { PageGroup } from "./types";
import { UI_41 } from "./ui-41";
import { UI_50 } from "./ui-50";
import { UI_51 } from "./ui-51";
import { UI_52 } from "./ui-52";
import { UI_53 } from "./ui-53";
import { UI_54 } from "./ui-54";
import { UI_55 } from "./ui-55";
import { UI_56 } from "./ui-56";

export const PAGE_GROUPS: Readonly<Record<string, PageGroup>> = {
  [UI_41.id]: UI_41,
  [UI_50.id]: UI_50,
  [UI_51.id]: UI_51,
  [UI_52.id]: UI_52,
  [UI_53.id]: UI_53,
  [UI_54.id]: UI_54,
  [UI_55.id]: UI_55,
  [UI_56.id]: UI_56,
};
