/**
 * Which of the three student shells each student route renders inside.
 *
 * @spec [student-UI register UI-41 ("every student route renders inside exactly one of the three
 *        shells"); DESIGN.md §2 "Shells (exactly three)"; register §2 (Focus shell users, back
 *        target, timed module with no back arrow)] | @implemented [2026-10-03]
 *
 * plain English: ONE typed table, keyed by the exact `path` string each student `<Route>` in
 * App.tsx declares. The router wraps every student page in `StudentRouteFrame`, which takes a key
 * of this table, so a student route cannot name a shell that is not here (it would not compile),
 * and `route-shells.test.tsx` parses App.tsx and renders the real `Router` to prove the reverse:
 * every route App.tsx declares is either in this table or in `SHELL_EXCLUDED_ROUTES` (never both),
 * and each one renders inside exactly the shell named here.
 *
 *   - app:   rail + content column + optional right panel. `panel` is the right panel's width
 *            (DESIGN.md §2: 360 default, Calendar 340, LISA 320) or null for no panel (Settings,
 *            and the pages DESIGN.md §4 gives no panel: Mastery, Upgrade, Notifications, the
 *            topic browser). `footer` is the slim legal footer
 *            (DESIGN.md §2: Home, Practice, Review, Full-Length, Settings, Help).
 *   - focus: back arrow + section name + context; no rail, no panel. `sectionHome` is the back
 *            target when there is no in-app page to return to. The timed exam module has no back
 *            arrow and is light only.
 *   - bare:  a centered card on --paper.
 *
 * Two bare surfaces are not routes and so are not keys here: the pending-deletion screen (rendered
 * by App's `DeletionGate` in place of any route) and the error screen (App's `ErrorBoundary`).
 * Both render `BareCard` directly.
 *
 * trade-offs: the table is keyed by path string rather than holding the page components, so the
 * `<Route>` JSX in App.tsx (which several source-reading contract tests and
 * `scripts/validate-route-registry.mjs` parse) keeps its shape. The cost, a key repeated at the
 * route, is checked by the compiler one way and by the route test the other.
 */

export type ShellKind = "app" | "focus" | "bare";

/** DESIGN.md §2: the right panel is 360px, Calendar 340px, LISA 320px. */
export type RightPanelWidth = 360 | 340 | 320;

/**
 * "light" pins the light token set whatever the device theme. Every route not yet rebuilt carries
 * it: those page bodies still draw with the app-wide (light) tokens until their Wave 5 row
 * rebuilds them, and a dark shell around a light-token body leaves body text dark on dark.
 * A Wave 5 row sets its route to null when its page is themed (so far: /dashboard, UI-50). The
 * timed exam module stays "light" for good (DESIGN.md §2).
 */
export type ThemeLock = "light" | null;

/**
 * "column": the padded reading column (56px 72px, 800px max; DESIGN.md §2). "full": the page
 * fills the middle column edge to edge and lays itself out (the Calendar and LISA prototypes'
 * <main> has no padding and no max width: a week grid, a conversation with its composer).
 */
export type AppContentLayout = "column" | "full";

export type AppShellSpec = {
  readonly shell: "app";
  readonly panel: RightPanelWidth | null;
  readonly footer: boolean;
  readonly content: AppContentLayout;
  readonly themeLock: ThemeLock;
};

export type FocusShellSpec = {
  readonly shell: "focus";
  /** The section name shown in the top bar. */
  readonly section: string;
  /** The back target when the student did not come from another in-app page. */
  readonly sectionHome: string;
  /** False only for the timed exam module (DESIGN.md §2, Bluebook layout). */
  readonly back: boolean;
  /** The timed module is light only (DESIGN.md §2); see ThemeLock for the others. */
  readonly themeLock: ThemeLock;
};

export type BareShellSpec = {
  readonly shell: "bare";
  readonly themeLock: ThemeLock;
};

export type ShellSpec = AppShellSpec | FocusShellSpec | BareShellSpec;

/** The key App.tsx uses for its catch-all (404) route, which declares no path. */
export const NOT_FOUND_ROUTE = "*";

function app(
  panel: RightPanelWidth | null,
  footer: boolean,
  content: AppContentLayout = "column",
  themeLock: ThemeLock = "light",
): AppShellSpec {
  return { shell: "app", panel, footer, content, themeLock };
}

function focus(
  section: string,
  sectionHome: string,
  timed = false,
): FocusShellSpec {
  return {
    shell: "focus",
    section,
    sectionHome,
    back: !timed,
    themeLock: "light",
  };
}

const BARE: BareShellSpec = { shell: "bare", themeLock: "light" };

export const STUDENT_ROUTE_SHELLS = {
  // App shell (DESIGN.md §2).
  // UI-50 (2026-10-03): Home is rebuilt on the student tokens only, so it follows the device
  // theme (light and dark); the first route off the OQ-49 light lock.
  "/dashboard": app(360, true, "column", null),
  "/practice": app(360, true),
  "/practice/topics": app(null, false),
  "/review": app(360, true),
  "/tests": app(360, true),
  "/calendar": app(340, false, "full"),
  "/chat": app(320, false, "full"),
  "/mastery": app(null, false),
  "/upgrade": app(null, false),
  // Settings: no right panel (DESIGN.md §4), footer yes (§2).
  "/profile": app(null, true),
  "/notifications": app(null, false),
  // Focus shell: the runners, the exam session and report pages.
  "/practice/session/:sessionId": focus("Practice", "/practice"),
  "/review/session/:sessionId": focus("Review", "/review"),
  "/tests/:sessionId": focus("Full-Length", "/tests"),
  "/tests/:sessionId/:section/:module": focus("Full-Length", "/tests", true),
  "/tests/:sessionId/report": focus("Full-Length", "/tests"),
  "/score-report": focus("Full-Length", "/tests"),
  // Bare card.
  "/login": BARE,
  "/profile/complete": BARE,
  "/update-password": BARE,
  "/account/recover": BARE,
  "/guardian-required": BARE,
  [NOT_FOUND_ROUTE]: BARE,
} as const satisfies Record<string, ShellSpec>;

export type StudentShellRoute = keyof typeof STUDENT_ROUTE_SHELLS;

/** Why a route App.tsx declares is not in the table above. */
export type ShellExclusionReason =
  | "redirect"
  | "public-marketing"
  | "public-legal"
  | "admin";

/**
 * Every literal `<Route path>` in App.tsx that is not a student page, and why. Guardian routes are
 * mounted from `GUARDIAN_ROUTES` (features/guardian/routes.tsx), which carries its own shell
 * (`GuardianShell`), so they are excluded as a set by the route test rather than listed here.
 *   - redirect: renders `<Redirect>` and nothing else; the target route's shell applies
 *     (`/signup` → `/login`, a bare card).
 *   - public-marketing / public-legal: the signed-out site, which has its own layout and footer.
 *   - admin: the crisis-review queue keeps its in-page `AppShell` (rail, no student locks: the
 *     server sends no feature-access map for an admin).
 */
export const SHELL_EXCLUDED_ROUTES: Readonly<
  Record<string, ShellExclusionReason>
> = {
  "/": "public-marketing",
  "/digital-sat": "public-marketing",
  "/digital-sat/math": "public-marketing",
  "/digital-sat/reading-writing": "public-marketing",
  "/blog": "public-marketing",
  "/blog/:slug": "public-marketing",
  "/trust": "public-legal",
  "/trust/evidence": "public-legal",
  "/legal": "public-legal",
  "/legal/:slug": "public-legal",
  "/signup": "redirect",
  "/tutor": "redirect",
  "/privacy": "redirect",
  "/terms": "redirect",
  "/practice/math": "redirect",
  "/practice/reading-writing": "redirect",
  "/practice/random": "redirect",
  "/math-practice": "redirect",
  "/reading-writing-practice": "redirect",
  "/admin/crisis-review/:id": "admin",
  "/admin/crisis-review": "admin",
};
