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
export const DIVIDER_PX = 14; // conservative; actual CSS is w-px, but grip + hit area widen
export const APP_HORIZONTAL_PADDING = 32;
export const BREAKPOINT_EXTRA = 20;
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
 * CALC_MIN_PX x CALC_COLUMN_HEIGHT_PX is the calculator's one fixed-size box, and the
 * size of the exam's floating calculator (E10b, owner ruling 2026-09-26).
 */
export const CALC_COLUMN_HEIGHT_PX = 640;
