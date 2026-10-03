/**
 * Every page group capture.ts knows, by id. A Wave 5 page PR adds its file here.
 * @implemented [2026-10-03]
 */
import type { PageGroup } from "./types";
import { UI_41 } from "./ui-41";

export const PAGE_GROUPS: Readonly<Record<string, PageGroup>> = {
  [UI_41.id]: UI_41,
};
