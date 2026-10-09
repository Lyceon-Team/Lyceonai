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
import { UI_57 } from "./ui-57";
import { UI_58 } from "./ui-58";
import { UI_59 } from "./ui-59";
import { SEO_Q6 } from "./seo-q6";
import { QA2_A } from "./qa2-a";
import { W6_UI_65, W6_UI_66 } from "./w6-code";
import { W6_OQ_68A } from "./oq68";
import { W6_UI_64 } from "./w6-ui-64";
import { BRAND_MARK } from "./brand-mark";
import { HOME_QOTD } from "./home-qotd";

export const PAGE_GROUPS: Readonly<Record<string, PageGroup>> = {
  [UI_41.id]: UI_41,
  [UI_50.id]: UI_50,
  [UI_51.id]: UI_51,
  [UI_52.id]: UI_52,
  [UI_53.id]: UI_53,
  [UI_54.id]: UI_54,
  [UI_55.id]: UI_55,
  [UI_56.id]: UI_56,
  [UI_57.id]: UI_57,
  [UI_58.id]: UI_58,
  [UI_59.id]: UI_59,
  [SEO_Q6.id]: SEO_Q6,
  [QA2_A.id]: QA2_A,
  [W6_UI_65.id]: W6_UI_65,
  [W6_UI_66.id]: W6_UI_66,
  [W6_OQ_68A.id]: W6_OQ_68A,
  [W6_UI_64.id]: W6_UI_64,
  [BRAND_MARK.id]: BRAND_MARK,
  [HOME_QOTD.id]: HOME_QOTD,
};
