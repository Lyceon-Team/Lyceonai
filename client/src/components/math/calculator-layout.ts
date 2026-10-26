/**
 * The calculator's sizes, shared by every surface that mounts DesmosCalculator.
 *
 * @spec [Doc-02B_v4 §28 (Desmos on practice, review and full-length); SCL-P-DESMOS-01
 *        (480px host floor); W4-4 (review's calculator over LISA's column); E10b]
 * | @implemented [2026-09-26]
 *
 * plain English: these numbers were written inside CanonicalPracticePage (practice and
 * review). The exam's floating calculator must use the same ones, so they live here, one
 * definition, and the practice page imports them. Moved verbatim: practice and review
 * compute exactly what they computed before.
 */

export const DESMOS_HOST_MIN_PX = 480;
export const CALC_PANEL_PAD_PX = 16;
export const CALC_MIN_PX = DESMOS_HOST_MIN_PX + CALC_PANEL_PAD_PX; // 496
export const QUESTION_MIN_PX = 500;
const DIVIDER_PX = 14; // conservative; actual CSS is w-px, but grip + hit area widen
const APP_HORIZONTAL_PADDING = 32;
const BREAKPOINT_EXTRA = 20;
export const SPLIT_BREAKPOINT =
  CALC_MIN_PX +
  QUESTION_MIN_PX +
  DIVIDER_PX +
  APP_HORIZONTAL_PADDING +
  BREAKPOINT_EXTRA; // 1062

/**
 * Static percentages computed once at the known-minimum container width
 * (SPLIT_BREAKPOINT − APP_HORIZONTAL_PADDING). These give the library a soft
 * bound that prevents it from allocating less than the pixel minimum during
 * drag at the breakpoint container width. The CSS `min-width` on each panel
 * is the TRUE pixel floor (browser-enforced, continuous); these percentages
 * are a secondary initial constraint only.
 */
export const CONTAINER_AT_BREAKPOINT =
  SPLIT_BREAKPOINT - APP_HORIZONTAL_PADDING; // 1030
export const CALC_MIN_PCT = Math.ceil(
  (CALC_MIN_PX / CONTAINER_AT_BREAKPOINT) * 100,
); // 49
export const QUESTION_MIN_PCT = Math.ceil(
  (QUESTION_MIN_PX / CONTAINER_AT_BREAKPOINT) * 100,
); // 49
export const CALC_DEFAULT_PCT = CALC_MIN_PCT; // 49
export const QUESTION_DEFAULT_PCT = 100 - CALC_DEFAULT_PCT; // 51

/**
 * W4-4: review's column beside the question, 640px tall. Between `lg` and
 * THREE_PANEL_BREAKPOINT the calculator is laid over it at CALC_MIN_PX wide, so
 * CALC_MIN_PX x CALC_COLUMN_HEIGHT_PX is the calculator's one fixed-size box.
 *
 * NOT DERIVED FOR THE EXAM. 640 is review's LISA column height: it exists because
 * review's middle breakpoint lays the calculator over that column. The exam has no LISA
 * column and nothing in the exam produces 640. The exam's floating calculator adopts
 * this box for CONSISTENCY across surfaces (E10b, owner ruling 2026-09-26: practice and
 * review size the calculator differently; follow review, the newer, and the only fixed
 * size). Changing it for the exam's own reasons means giving the exam its own constant.
 */
export const CALC_COLUMN_HEIGHT_PX = 640;

/**
 * @spec [owner brief "restore the pre-#1300 runner layout" (Karl, 2026-10-26): "LISA is a docked
 *       right column ... Opening the calculator places it BETWEEN the question and LISA.
 *       Calculator's right edge is exactly LISA's left edge"; the test widths 1366x650,
 *       1440x900, 1920x1080] | @implemented [2026-10-26]
 *
 * plain English: the practice and review runners with LISA docked as their right column (from
 * 768px). The column is the pre-#1300 360px panel plus a 12px inset from the top-right corner.
 * With it open, the calculator opens beside the question (between the question and LISA) from
 * DOCKED_SPLIT_BREAKPOINT with the 360px panel; below it, the 300px tier and the
 * take-turns tier (below), so it never sits behind or over LISA's column.
 *
 * APPROVED (Karl, ruling of 2026-10-26 on #1322): the 420px question floor while LISA is docked.
 * trade-offs: the question's floor beside both is 420px, not QUESTION_MIN_PX (500): with 500 the
 * three columns need 1434px, so the owner's 1366px case would stack. Pre-#1300 the calculator
 * covered LISA's column below 1446px (owner ruling 2026-09-25), which the 2026-10-26 brief rules
 * out ("neither ever renders behind or over the other"). The Desmos floor (CALC_MIN_PX) is kept.
 */
const DOCKED_LISA_PANEL_PX = 360;
const DOCKED_LISA_INSET_PX = 12;
export const DOCKED_LISA_COLUMN_PX =
  DOCKED_LISA_PANEL_PX + DOCKED_LISA_INSET_PX; // 372
export const QUESTION_MIN_DOCKED_PX = 420;
/** The question-and-calculator group's left padding beside LISA (`pl-4`; no right padding). */
const DOCKED_GROUP_PAD_PX = 16;
export const DOCKED_SPLIT_BREAKPOINT =
  DOCKED_GROUP_PAD_PX +
  QUESTION_MIN_DOCKED_PX +
  DIVIDER_PX +
  CALC_MIN_PX +
  DOCKED_LISA_COLUMN_PX +
  BREAKPOINT_EXTRA; // 1338
/** The group's width at that breakpoint, and the percentages computed from it (as above). */
const DOCKED_CONTAINER_AT_BREAKPOINT =
  DOCKED_SPLIT_BREAKPOINT - DOCKED_GROUP_PAD_PX - DOCKED_LISA_COLUMN_PX; // 950
export const DOCKED_CALC_MIN_PCT = Math.ceil(
  (CALC_MIN_PX / DOCKED_CONTAINER_AT_BREAKPOINT) * 100,
); // 53
export const DOCKED_QUESTION_MIN_PCT = Math.ceil(
  (QUESTION_MIN_DOCKED_PX / DOCKED_CONTAINER_AT_BREAKPOINT) * 100,
); // 45

/**
 * @spec [owner ruling on #1322 (Karl, 2026-10-26): "below 1338px, LISA's docked column narrows to
 *       ~300px so question, calculator and LISA stay side by side with a shared boundary ... Only
 *       below W3, fall back to option (a): the calculator and the docked LISA column are mutually
 *       exclusive"] | @implemented [2026-10-26]
 *
 * plain English: the three tiers. From DOCKED_SPLIT_BREAKPOINT (1338) LISA's panel is 360px;
 * from DOCKED_NARROW_SPLIT_BREAKPOINT (W3, 1278) up to 1337 it is 300px and the three columns
 * still fit (the same 420px question floor, Desmos floor, divider, padding and 20px slack); below
 * W3 the calculator and the docked column take turns (CanonicalPracticePage).
 */
export const DOCKED_LISA_NARROW_COLUMN_PX = 300 + DOCKED_LISA_INSET_PX; // 312
export const DOCKED_NARROW_SPLIT_BREAKPOINT =
  DOCKED_SPLIT_BREAKPOINT -
  DOCKED_LISA_COLUMN_PX +
  DOCKED_LISA_NARROW_COLUMN_PX; // 1278 (W3)
