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
export type ClickStep = { click: Record<Viewport, string | null> };

/**
 * UI-53: pick a runner choice by what it IS, resolved by capture.ts from the served item in
 * the harness database (its stored `option_order` and correct key): "correct", "incorrect" (the
 * first choice on screen that is not correct), or "first" (the first on screen). The client
 * never knows which choice is correct; only the harness, reading its own database, does.
 */
export type PickStep = { pick: "correct" | "incorrect" | "first" };

export type Step = ClickStep | PickStep;

/**
 * UI-53: a fresh runner session for each capture, started through the REAL create route before
 * the page loads (`{session}` in the route is its id), bound to the seed's client instance, and
 * ended through the real terminate route after the screenshot, so every viewport x theme starts
 * on the same step. capture.ts retries a start whose first item is a grid-in (`mcqFirst`).
 */
export type FreshSession = {
  engine: "practice" | "review";
  body: Readonly<Record<string, unknown>>;
  mcqFirst?: boolean;
};

export type PrototypePairing =
  | {
      kind: "screen";
      /** File name under docs/plans/student-ui/design/prototype/. */
      file: string;
      /** The canvas `plan` prop, where the screen has one (Runner and Report do not). */
      plan?: "paid" | "free" | "guardian-paid";
      steps?: readonly string[];
      /**
       * Names the clicked state in the prototype PNG's file name, when one screen is clicked
       * into more than one state (UI-53: the runner selected, answered right, answered wrong).
       */
      state?: string;
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
  /** UI-53: a fresh runner session per capture (see FreshSession). */
  freshSession?: FreshSession;
  /** UI-53: text the page must show after `steps` (e.g. "Question 2 of 10"); the capture fails otherwise. */
  expectText?: string;
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
  /**
   * UI-54: the themes to shoot, when not both. The timed exam module is light only (DESIGN.md
   * §2), so a dark capture of it would show the same page twice.
   */
  themes?: readonly Theme[];
  prototype: PrototypePairing;
};

export type PageGroup = {
  id: string;
  title: string;
  shots: readonly Shot[];
  /**
   * Extra history the group's pages need, seeded through the real routes after the base seed
   * (seed.ts). "review-history": more practice sessions with misses and an open review session,
   * so Review's queue, domain chips and past-session list (past five rows) are non-empty.
   * "exam-history" (UI-54): the paid student's full-length history, a third published form
   * ("Practice Test 3", never taken), a test walked to a scored report and a test left in
   * Reading and Writing Module 2, all through the real exam routes (seed.ts, db.ts).
   * Off by default, so the other groups' payloads do not change.
   */
  seed?: "review-history" | "exam-history";
};
