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

/**
 * UI-55: type a value into a field (the free calendar's inline setup form), addressed per
 * viewport like a click. `null` for a viewport skips it there.
 */
export type FillStep = { fill: Record<Viewport, string | null>; value: string };

export type Step = ClickStep | PickStep | FillStep;

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
  /**
   * SCL-211 / OQ-56 (b): the persona's study profile is deleted from the harness database
   * before every capture, so a first-save click path starts from "no profile" in each viewport
   * and theme (the free form is read-only once a profile exists, so a second pass would find no
   * form). Listed in the index next to the shot.
   */
  freshCalendarProfile?: true;
  /** UI-53: text the page must show after `steps` (e.g. "Question 2 of 10"); the capture fails otherwise. */
  expectText?: string;
  /** UI-56: a selector the page must show after `steps` (the capture fails otherwise). */
  expectVisible?: string;
  /** UI-56: a selector the page must NOT show after `steps` (e.g. no bubbles in a new column). */
  expectGone?: string;
  /**
   * UI-56: a request the browser holds unanswered for the whole capture and then aborts, so an
   * in-flight state can be shot (LISA's typing indicator while `POST /api/tutor/messages`
   * waits). The request never reaches the harness server. Steps then wait a fixed settle time
   * instead of network idle, which a held request would never reach.
   */
  holdRequest?: { method: "POST" | "GET"; path: string };
  /**
   * UI-58: a request the browser answers itself with a fixed body, for a page whose real answer
   * needs a third party the harness never calls (`GET /api/billing/plans` reads prices from
   * Stripe, and the harness has no Stripe key). The request never reaches the harness server; the
   * index says so, with `reason`. The body must be built from the shared response schema.
   */
  fulfillRequest?: {
    method: "GET";
    path: string;
    body: unknown;
    reason: string;
  };
  /**
   * UI-59: requests the browser fails itself (a network error, never reaching the server), for a
   * state production reaches only when the network does: the app's error screen, which renders
   * when a page's code chunk cannot load (a lazy route whose chunk request fails throws into the
   * app's ErrorBoundary). `pathPattern` is a RegExp source over the request's pathname. The index
   * records it with `reason`; the capture fails if no request matched.
   */
  failRequest?: { pathPattern: string; reason: string };
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
   * "calendar-goal" (UI-55): the paid student's SAT date set, through the real
   * `PUT /api/calendar/profile`, to a day inside the current week, so the week, month and mini
   * month can show the starred test day.
   * "lisa-history" (UI-56): four LISA conversations for the paid student (seed.ts
   * `seedLisaHistory`), one with the prototype's four turns, one ended.
   * "mastery-skills" (UI-57): the harness bank retagged with each domain's canonical skills
   * (db.ts `useCanonicalSkills`) before any answer, so the Mastery page's skills lists are real
   * skill names, some measured by the base seed's answers and some not.
   * "bare-pages" (UI-59): three more students (personas.ts BARE_PAGE_PERSONAS: an incomplete
   * profile, an unlinked under-13, a pending deletion through the real SQL writer), the deletion
   * lifecycle flag on and the deletion routes mounted in the harness server.
   * Off by default, so the other groups' payloads do not change.
   */
  seed?:
    | "review-history"
    | "exam-history"
    | "calendar-goal"
    | "lisa-history"
    | "mastery-skills"
    | "bare-pages";
};
