/**
 * @spec [owner brief "Video player: near-fullscreen" (Karl, 2026-10-27): shrunk, the player "stays
 *       docked beside the question so the student can work while watching"] | @implemented [2026-10-27]
 *
 * plain English: the runner's docked LISA panel (ChatDock, `docked`), for what renders inside
 * it. ChatDock provides its panel element here only when it is a runner's docked column (null on
 * Home and Review, whose panel floats). The shrunk video player reads it so it lies inside LISA's
 * column, at the column's own width, instead of a fixed size that would spill over the question
 * where the column is narrower (312px below 1338px, calculator-layout.ts). Its own module so the
 * player does not import ChatDock, which imports the thread the player is rendered in.
 */
import { createContext, type RefObject } from "react";

export const DockedLisaPanelContext =
  createContext<RefObject<HTMLElement> | null>(null);
