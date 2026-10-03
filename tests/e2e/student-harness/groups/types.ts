/**
 * The shape of a page group: what capture.ts shoots for one Wave 5 page PR.
 *
 * @spec [student-UI register §6 Wave 5 (side-by-side with the signed-off prototype, light and
 *        dark, desktop and 390px — OQ-4)] | @implemented [2026-10-03]
 *
 * plain English: a group is a list of shots. Each shot names a persona, a built route (which
 * may use `{free.openPracticeSessionId}`-style placeholders filled from the seed manifest), and
 * the prototype screen it pairs with (or the reason there is none). Optional steps run after
 * the page settles (e.g. click the locked LISA rail item to open the upgrade modal); a step's
 * selector may differ by viewport because the rail becomes a bottom tab bar below `lg`.
 */
import type { Persona } from "../personas";

export type Viewport = "desktop" | "mobile";
export type Theme = "light" | "dark";

/** A click, addressed per viewport. `null` for a viewport means "skip this shot there". */
export type Step = { click: Record<Viewport, string | null> };

export type PrototypePairing =
  | {
      kind: "screen";
      /** File name under docs/plans/student-ui/design/prototype/. */
      file: string;
      /** The canvas `plan` prop, where the screen has one (Runner and Report do not). */
      plan?: "paid" | "free" | "guardian-paid";
      steps?: readonly string[];
      /** One line on what this screen shows, for the index. */
      note?: string;
    }
  | { kind: "none"; reason: string };

export type Shot = {
  id: string;
  title: string;
  persona: Persona;
  route: string;
  /**
   * Browser-session state the student would have set by an earlier click, written before the
   * page loads (e.g. the dismissed diagnostic prompt). Listed in the index next to the shot.
   */
  sessionStorage?: Readonly<Record<string, string>>;
  /** Per-device state written before load (the theme key is always set by capture.ts). */
  localStorage?: Readonly<Record<string, string>>;
  /** A selector the built page must show before the screenshot (beyond network idle). */
  waitFor?: Record<Viewport, string>;
  steps?: readonly Step[];
  /**
   * A click path's proof: the pathname the page must land on after `steps` (a RegExp source).
   * The capture fails if it lands anywhere else, and the index records the expectation next to
   * the path it saw.
   */
  expectPath?: string;
  /**
   * Shoot the whole document instead of the viewport. On a phone the right panel stacks under
   * the main column (DESIGN.md §2 Mobile), so only a full-page shot shows it.
   */
  fullPage?: boolean;
  prototype: PrototypePairing;
};

export type PageGroup = {
  id: string;
  title: string;
  shots: readonly Shot[];
};
