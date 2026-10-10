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
 * Three bare surfaces are not keys here: the pending-deletion screen (rendered by App's
 * `DeletionGate` in place of any route), the error screen (App's `ErrorBoundary`) and the 404
 * (App's catch-all, which declares no path; QA2-E, 2026-10-08). All three render `BareCard`
 * directly.
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
 * A Wave 5 row sets its route to null when its page is themed (so far: /dashboard, UI-50;
 * /practice, UI-51; /review, UI-52; /practice/session/:sessionId, UI-53; /tests, /tests/:sessionId
 * and /tests/:sessionId/report, UI-54; /calendar, UI-55; /chat, UI-56; /mastery, UI-57; /upgrade,
 * /profile, /help and /notifications, UI-58; every bare-card page, UI-59; the review runner
 * /review/session/:sessionId, UI-53 with OQ-54 (a), 2026-10-05). The timed exam module
 * stays "light" for good (DESIGN.md §2).
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
  themeLock: ThemeLock = "light",
): FocusShellSpec {
  return {
    shell: "focus",
    section,
    sectionHome,
    back: !timed,
    themeLock: timed ? "light" : themeLock,
  };
}

// UI-59 (2026-10-03): every bare page (login and signup, profile completion, update password,
// account recovery, the guardian-required page, the 404, and the pending-deletion and error
// screens App.tsx renders directly) is rebuilt on the student tokens only; off the light lock.
const BARE: BareShellSpec = { shell: "bare", themeLock: null };

export const STUDENT_ROUTE_SHELLS = {
  // App shell (DESIGN.md §2).
  // UI-50 (2026-10-03): Home is rebuilt on the student tokens only, so it follows the device
  // theme (light and dark); the first route off the OQ-49 light lock.
  "/dashboard": app(360, true, "column", null),
  // UI-51 (2026-10-03): Practice is rebuilt on the student tokens only; off the light lock too.
  "/practice": app(360, true, "column", null),
  // UI-52 (2026-10-03): Review is rebuilt on the student tokens only; off the light lock too.
  "/review": app(360, true, "column", null),
  // UI-54 (2026-10-03): Full-Length home is rebuilt on the student tokens only; off the lock too.
  "/tests": app(360, true, "column", null),
  // UI-55 (2026-10-03): the student calendar draws its chrome, grid and sheets with the student
  // tokens only (`calendar-student.css`); off the light lock. The guardian calendar is not a
  // student route and keeps its own shell.
  "/calendar": app(340, false, "full", null),
  // UI-56 (2026-10-03): LISA is rebuilt on the student tokens only (the page and the thread
  // parts it shares with the review panel); off the light lock.
  "/chat": app(320, false, "full", null),
  // UI-57 (2026-10-03): the Mastery page is rebuilt on the student tokens only; off the light
  // lock. No right panel and no footer (UI-41 route table; DESIGN.md §2 lists neither for it).
  "/mastery": app(null, false, "column", null),
  // UI-58 (2026-10-03): the plans page, Settings, Help and Notifications are rebuilt on the
  // student tokens only; off the light lock. Settings and Help: no right panel (DESIGN.md §4),
  // footer yes (§2). The plans page and Notifications: no panel, no footer (UI-41 route table).
  "/upgrade": app(null, false, "column", null),
  "/profile": app(null, true, "column", null),
  "/help": app(null, true, "column", null),
  "/notifications": app(null, false, "column", null),
  // Focus shell: the runners, the exam session and report pages.
  // UI-53 (2026-10-03): the practice runner is rebuilt on the student tokens only; off the light
  // lock. The review runner followed on 2026-10-05, owner ruling on OQ-54 (a) and OQ-57 (f):
  // "Move the review runner's LISA panel onto student tokens in #1073 now". UI-56 had moved the
  // thread parts the panel shares with /chat; the panel's own frame, header chip and opener
  // (ScopedTutorPanel) and its denial card (LisaUpgradeCard, now /chat's locked card with the
  // approved copy) followed, so nothing in the review runner reads the light tokens; off the lock.
  "/practice/session/:sessionId": focus("Practice", "/practice", false, null),
  // Owner brief 2026-10-10 rule 3: the diagnostic start page hands straight over to the session
  // above, so it is drawn in the same Focus frame (no shell change between the two).
  "/practice/diagnostic": focus("Practice", "/practice", false, null),
  "/review/session/:sessionId": focus("Review", "/review", false, null),
  // UI-54 (2026-10-03): the exam session page and the report are rebuilt on the student tokens
  // only; off the lock. The timed module keeps its Bluebook layout and stays light for good.
  "/tests/:sessionId": focus("Full-Length", "/tests", false, null),
  "/tests/:sessionId/:section/:module": focus("Full-Length", "/tests", true),
  "/tests/:sessionId/report": focus("Full-Length", "/tests", false, null),
  "/score-report": focus("Full-Length", "/tests"),
  // Bare card.
  "/login": BARE,
  "/profile/complete": BARE,
  "/update-password": BARE,
  "/account/recover": BARE,
  "/guardian-required": BARE,
} as const satisfies Record<string, ShellSpec>;

export type StudentShellRoute = keyof typeof STUDENT_ROUTE_SHELLS;

/** Why a route App.tsx declares is not in the table above. */
export type ShellExclusionReason =
  | "redirect"
  | "not-found"
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
 *   - not-found: the catch-all (404). It has no path to key this table on, so App.tsx frames it
 *     in the Bare card itself (`NotFoundRoute`), on the student tokens with no theme lock.
 */
export const SHELL_EXCLUDED_ROUTES: Readonly<
  Record<string, ShellExclusionReason>
> = {
  "/": "public-marketing",
  // SEO Wave 3 decision 3 (2026-10-05): 301s to the content pages, which are mounted from
  // CONTENT_PAGE_PATHS (shared/content/pages/paths.ts) and excluded as a set, like the guardian
  // routes: all public-marketing, in PublicLayout.
  "/digital-sat": "redirect",
  "/digital-sat/math": "redirect",
  "/digital-sat/reading-writing": "redirect",
  "/blog": "public-marketing",
  "/blog/:slug": "public-marketing",
  "/sat-question-of-the-day": "public-marketing",
  "/sat-question-of-the-day/:date": "public-marketing",
  "/trust": "public-legal",
  "/legal": "public-legal",
  "/legal/:slug": "public-legal",
  "/signup": "redirect",
  // QA2-E (production re-test 2026-10-08): /settings replaces itself with /profile (Settings).
  "/settings": "redirect",
  "/tutor": "redirect",
  "/privacy": "redirect",
  "/terms": "redirect",
  "/practice/math": "redirect",
  "/practice/reading-writing": "redirect",
  "/practice/random": "redirect",
  // OQ-68 (a) (Karl, 2026-10-08): the topic browser is retired; /practice/topics replaces itself
  // with /practice.
  "/practice/topics": "redirect",
  "/math-practice": "redirect",
  "/reading-writing-practice": "redirect",
  "/admin/crisis-review/:id": "admin",
  "/admin/crisis-review": "admin",
  // The 404 is the SEO page (main, F6/F2) and the same render as the static 404.html. Since the
  // production re-test of 2026-10-08 (item E, Karl: "restyle the 404 page with student tokens,
  // fonts and theme") it is a Bare-card page, framed by App.tsx's catch-all; it was unshelled
  // from the PR 1069 merge (owner choice 2026-10-05) until then.
  [NOT_FOUND_ROUTE]: "not-found",
};

/**
 * The shell a pathname renders in, or null when it is not a student route.
 *
 * @spec [production QA 2026-10-07 item 5 (Karl: "route-level lazy loading with page skeletons
 *        instead of the full-page cream 'Loading…' flash", which "also breaks dark mode"); UI-41;
 *        DESIGN.md §2; UI-59 / OQ-60 (e) (owner ruling 2026-10-05: no light flash before a dark
 *        Bare card), which this generalises from the Bare routes to every student route]
 *        | @implemented [2026-10-07; replaces `requireRoleLoaderThemeLock` of 2026-10-05]
 *
 * plain English: what loads above the shells (the router's Suspense fallback and the route
 * guard's auth wait) asks this which shell to sketch, so the first paint is the page's own shell
 * in the page's own theme (its lock from this table), not a light full-page loader. Matched
 * against the table's own keys: an exact key, or a key whose `:param` segments stand for any one
 * non-empty segment. When two keys match, the one with fewer parameters wins (a literal segment
 * is more specific).
 *
 * edge cases: the catch-all key is not a path and never matches (the 404's Bare card is drawn by
 * App.tsx's catch-all itself, so nothing above it sketches one);
 * a wouter pathname carries no query; `constructor` and friends never match, because the lookup
 * walks the table's own entries.
 */
export function studentShellAt(pathname: string): ShellSpec | null {
  const parts = pathname.split("/");
  let best: { spec: ShellSpec; params: number } | null = null;
  const entries: readonly (readonly [string, ShellSpec])[] =
    Object.entries(STUDENT_ROUTE_SHELLS);
  for (const [route, spec] of entries) {
    const keys = route.split("/");
    if (keys.length !== parts.length) continue;
    let params = 0;
    const matches = keys.every((key, i) => {
      const part = parts[i] ?? "";
      if (key.startsWith(":")) {
        params += 1;
        return part.length > 0;
      }
      return key === part;
    });
    if (matches && (best === null || params < best.params))
      best = { spec, params };
  }
  return best?.spec ?? null;
}

/**
 * @spec [Production QA 2026-10-07 item 7; DESIGN.md §2 (rail labels)] | @implemented [2026-10-07]
 * plain English: the name a student knows a page by, for the Focus shell's back arrow when it
 * returns to the previous in-app page. App-shell pages use their rail/menu names; a Focus page
 * uses its section ("Practice", "Review", "Full-Length"). Anything else (an unknown path) is
 * null, and the arrow then says "Back" rather than guess.
 */
const APP_PAGE_NAMES: Readonly<Record<string, string>> = {
  "/dashboard": "Home",
  "/practice": "Practice",
  "/review": "Review",
  "/tests": "Full-Length",
  "/calendar": "Calendar",
  "/chat": "LISA",
  "/mastery": "Mastery",
  "/upgrade": "Plans",
  "/profile": "Settings",
  "/help": "Help",
  "/notifications": "Notifications",
};

export function pageNameAt(pathname: string): string | null {
  const named = APP_PAGE_NAMES[pathname];
  if (named !== undefined) return named;
  const spec = studentShellAt(pathname);
  return spec !== null && spec.shell === "focus" ? spec.section : null;
}
