import { Component, ReactNode, Suspense, lazy } from "react";
import { Switch, Route, Redirect, useLocation, useSearch } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { HelmetProvider } from "react-helmet-async";
import {
  SupabaseAuthProvider,
  useSupabaseAuth,
} from "@/contexts/SupabaseAuthContext";
import { UIProvider } from "@/components/providers/ui-provider";
import { UpgradeModalProvider } from "@/components/billing/UpgradeModal";
import { CookieConsentRoot } from "@/components/consent/CookieConsentRoot";
import "@/styles/tokens.css";
import "@/styles/student-tokens.css";
import "@/styles/accessibility.css";

import HomePage from "@/pages/home";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
// The route fallback's own module (it imports the loader's module, not the `student-ui` barrel:
// the barrel also carries the filter bar (Radix menus), the modal and the notice, which only
// signed-in pages use (SEO plan F8)).
import { RouteLoading } from "@/components/layout/RouteSkeleton";
import { Button } from "@/components/ui/button";
import { BareCard, BareCardHeader } from "@/components/layout/BareCardShell";
import { ActiveThemeLockProvider } from "@/components/layout/theme-lock";
import { GUARDIAN_ROUTES } from "@/features/guardian/routes";
import { CONTENT_PAGE_PATHS } from "@shared/content/pages/paths";
import { useInAppHistoryTracking } from "@/lib/in-app-history";
import { useRouteScrollReset } from "@/lib/route-scroll-reset";

// @spec [Coding Standards §11; student-ui register UI-11] | @implemented [2026-09-29] |
// plain English: only `/` (HomePage), `/login` (Login) and the catch-all (NotFound) stay
// eager, because they are the landing surfaces whose first paint should not wait on a second
// chunk request. Every other page, including these two, is lazy and loads under the Router's
// Suspense fallback.
// @spec [SEO plan F8; Coding Standards §11] | @implemented [2026-10-05] | plain English: the
// role guard (with its re-consent modal) and the pending-deletion screen are signed-in surfaces,
// so they load on demand instead of in the entry bundle every public page downloads. The guard
// renders inside the router's Suspense boundary, as the pages it wraps do. `/login` stays eager:
// it is a landing page (student-ui register UI-11).
const RequireRole = lazy(() =>
  import("@/components/auth/RequireRole").then((m) => ({
    default: m.RequireRole,
  })),
);
const PendingDeletionScreen = lazy(() =>
  import("@/components/account-deletion/PendingDeletionScreen").then((m) => ({
    default: m.PendingDeletionScreen,
  })),
);
// @spec [SEO plan F8; student-UI register UI-41] | @implemented [2026-10-07] | plain English: the
// student shell frame (the App shell's rail, header menu and notification bell) only wraps signed-in
// pages, so it loads with them, inside the same Suspense boundary, as RequireRole does.
const StudentRouteFrame = lazy(() =>
  import("@/components/layout/StudentRouteFrame").then((m) => ({
    default: m.StudentRouteFrame,
  })),
);
const UpdatePassword = lazy(() => import("@/pages/update-password"));
const NotificationsPage = lazy(() => import("@/pages/notifications"));

const AccountRecover = lazy(() => import("@/pages/account-recover"));

const LyceonDashboard = lazy(() => import("@/pages/lyceon-dashboard"));
const Chat = lazy(() => import("@/pages/chat"));
const Practice = lazy(() => import("@/pages/practice"));
// Full-length exam shell (E7b). Wrappers are module-scope components, not inline
// arrows, so a re-render of the Switch never remounts a running module.
const TestsHomePage = lazy(() => import("@/features/exam/pages/TestsHomePage"));
const ExamSessionPage = lazy(
  () => import("@/features/exam/pages/ExamSessionPage"),
);
const ExamModulePage = lazy(
  () => import("@/features/exam/pages/ExamModulePage"),
);
const ExamReportPage = lazy(
  () => import("@/features/exam/pages/ExamReportPage"),
);
function TestsHomeRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests">
        <TestsHomePage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
function ExamSessionRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests/:sessionId">
        <ExamSessionPage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
function ExamModuleRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests/:sessionId/:section/:module">
        <ExamModulePage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
function ExamReportRoute() {
  return (
    <RequireRole allow={["student", "admin"]}>
      <StudentRouteFrame route="/tests/:sessionId/report">
        <ExamReportPage />
      </StudentRouteFrame>
    </RequireRole>
  );
}
// UI-41: the three unguarded student routes, wrapped in their shell at module scope (an inline
// arrow would remount the page on every Switch render).
function LoginRoute() {
  return (
    <StudentRouteFrame route="/login">
      <Login />
    </StudentRouteFrame>
  );
}
function AccountRecoverRoute() {
  return (
    <StudentRouteFrame route="/account/recover">
      <AccountRecover />
    </StudentRouteFrame>
  );
}
/**
 * @spec [production re-test 2026-10-08 item E (Karl: "restyle the 404 page with student tokens,
 *        fonts and theme"); DESIGN.md §2 "Bare card" (the 404 is a Bare-card page); SEO F6/F2]
 *        | @implemented [2026-10-08; replaces the unshelled SEO card of the PR 1069 merge]
 * plain English: the catch-all, framed in the Bare card here (it has no path, so it has no row in
 * the student route table for `StudentRouteFrame` to look up), as the error screen and the
 * pending-deletion screen are. The static 404.html is this same render, so it gets the card too,
 * in the theme the boot script in index.html sets before the first paint. Exported for the
 * bare-page suite, which renders the 404 the way the router does.
 */
export function NotFoundRoute(): JSX.Element {
  return (
    <BareCard>
      <NotFound />
    </BareCard>
  );
}

/**
 * @spec [production re-test 2026-10-08 item E (Karl: "Redirect /settings → /profile")]
 *        | @implemented [2026-10-08]
 * plain English: Settings lives at `/profile` (UI-58); `/settings` used to fall through to the
 * 404. It now replaces itself with `/profile` (a history replace, so Back does not bounce back
 * through it), keeping the query (`?tab=` picks the section) and the hash. Admission is
 * `/profile`'s own guard's; this route renders nothing of its own.
 */
function SettingsRedirect(): JSX.Element {
  const search = useSearch();
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  return (
    <Redirect
      to={`/profile${search === "" ? "" : `?${search}`}${hash}`}
      replace
    />
  );
}
// Doc 05F §17.1. Lazy like every other authenticated page: the calendar pulls in @dnd-kit
// and its own stylesheet, and a student who never opens it should not download either.
const Calendar = lazy(() => import("@/pages/calendar"));
// Guardian pages (the student calendar and exam results included) are routed by
// GUARDIAN_ROUTES (`features/guardian/routes.tsx`), which lazy-loads them itself.
const ScoreReport = lazy(() => import("@/pages/score-report"));
const BrowseTopics = lazy(() => import("@/pages/browse-topics"));
const ResumePractice = lazy(() => import("@/pages/resume-practice"));
const Review = lazy(() => import("@/pages/review"));
const ResumeReview = lazy(() => import("@/pages/resume-review"));
const UserProfile = lazy(() => import("@/pages/UserProfile"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const HelpPage = lazy(() => import("@/pages/help"));

/**
 * @spec [student-UI register UI-58; Guardian_Closure_Plan G4-08] | @implemented [2026-10-03]
 * plain English: `/profile` is two pages behind one URL. A student (or admin) gets Settings in
 * the App shell (UI-58); a guardian keeps the guardian profile in the guardian shell (G4-08),
 * which `StudentRouteFrame` leaves unwrapped for a guardian. Chosen by role for presentation
 * only; every read and write on both pages is authorised by the server.
 */
function ProfileRoute(): JSX.Element {
  const { user } = useSupabaseAuth();
  return user?.role === "guardian" ? <UserProfile /> : <SettingsPage />;
}
const ProfileComplete = lazy(() => import("@/pages/profile-complete"));
const GuardianRequired = lazy(() => import("@/pages/guardian-required"));

// SEO Wave 3 (C2): every content page renders through one component, mounted at each path in
// CONTENT_PAGE_PATHS (the light path list; the copy loads with the page's own chunk).
const ContentPage = lazy(() => import("@/pages/content-page"));
const Blog = lazy(() => import("@/pages/blog"));
const BlogPost = lazy(() => import("@/pages/blog-post"));
const SatQuestionOfTheDay = lazy(
  () => import("@/pages/sat-question-of-the-day"),
);
const SatQuestionOfTheDayArchive = lazy(
  () => import("@/pages/sat-question-of-the-day-day"),
);
const LegalHub = lazy(() => import("@/pages/legal"));
const LegalDoc = lazy(() => import("@/pages/legal-doc"));
const TrustHub = lazy(() => import("@/pages/trust"));
const MasteryPage = lazy(() => import("@/pages/mastery"));
const UpgradePage = lazy(() => import("@/pages/upgrade"));
const CrisisReviewList = lazy(() => import("@/pages/admin/CrisisReviewList"));
const CrisisReviewDetail = lazy(
  () => import("@/pages/admin/CrisisReviewDetail"),
);

/**
 * @spec [student-UI register UI-46; audit §6.2 "Full-page spinner"; production QA 2026-10-07
 *        items 5 and 12 (Karl: page skeletons instead of the full-page cream "Loading…" flash,
 *        which also broke dark mode)] | @implemented [2026-10-03; route-aware 2026-10-07]
 * plain English: the route Suspense fallback. On a student route it is that route's own shell,
 * sketched, in the route's own theme (RouteSkeleton.tsx); on every other route (guardian, admin,
 * marketing, none of them themed) it is still the light FullPageLoader. The `page-loader` test id
 * and the "Loading..." name are kept on both: the guardian e2e
 * (tests/e2e/guardian-surfaces.spec.ts) waits on them. Every lazy route stays lazy.
 */
const ROUTE_FALLBACK = <RouteLoading data-testid="page-loader" />;

/** The route switch — exported so the guardian route walk (G4-01) renders the real table. */
export function Router() {
  // UI-41: the Focus shell's back arrow asks whether the entry behind is an in-app page.
  useInAppHistoryTracking();
  // QA2-I (production re-test 2026-10-08): every pathname change opens the page at its top.
  useRouteScrollReset();
  return (
    <Suspense fallback={ROUTE_FALLBACK}>
      <Switch>
        {/* Public routes */}
        <Route path="/" component={HomePage} />
        <Route path="/login" component={LoginRoute} />

        {/* Signup redirects to login page (signup happens via modal/form on login page) */}
        <Route path="/signup">{() => <Redirect to="/login" replace />}</Route>

        {/* SEO Content Pages */}
        {/* @spec [owner decision 3 on SEO Wave 3 Step 0, 2026-10-05: the three /digital-sat*
            301s] | @implemented [2026-10-05] | plain English: the edge answers these with a 301
            (vercel.json, from the registry's redirect_to); these routes only cover an in-app
            navigation that reaches the old path. */}
        <Route path="/digital-sat">
          {() => <Redirect to="/online-sat-prep" replace />}
        </Route>
        <Route path="/digital-sat/math">
          {() => <Redirect to="/sat-practice-questions/math" replace />}
        </Route>
        <Route path="/digital-sat/reading-writing">
          {() => (
            <Redirect
              to="/sat-practice-questions/reading-and-writing"
              replace
            />
          )}
        </Route>
        {CONTENT_PAGE_PATHS.map((path) => (
          <Route key={path} path={path} component={ContentPage} />
        ))}
        <Route path="/blog" component={Blog} />
        <Route path="/blog/:slug" component={BlogPost} />
        <Route
          path="/sat-question-of-the-day"
          component={SatQuestionOfTheDay}
        />
        <Route
          path="/sat-question-of-the-day/:date"
          component={SatQuestionOfTheDayArchive}
        />

        {/* Trust & Legal pages - public */}
        <Route path="/trust" component={TrustHub} />
        {/* @spec [owner ruling 2026-09-29, UI-04] | @implemented [2026-09-29] |
            plain English: the old tutor page is retired; /tutor now sends
            everyone to /chat, whose guard handles sign-in (next=/chat). */}
        <Route path="/tutor">{() => <Redirect to="/chat" replace />}</Route>
        <Route path="/legal" component={LegalHub} />
        <Route path="/legal/:slug" component={LegalDoc} />

        {/* Legacy legal redirects */}
        <Route path="/privacy">
          {() => <Redirect to="/legal/privacy-policy" replace />}
        </Route>
        <Route path="/terms">
          {() => <Redirect to="/legal/student-terms" replace />}
        </Route>

        {/* Student-only routes - require student or admin role */}
        <Route
          path="/dashboard"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/dashboard">
                <LyceonDashboard />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/chat"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/chat">
                <Chat />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/practice"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/practice">
                <Practice />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/practice/topics"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/practice/topics">
                <BrowseTopics />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route path="/practice/math">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route path="/practice/reading-writing">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route path="/practice/random">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route
          path="/practice/session/:sessionId"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/practice/session/:sessionId">
                <ResumePractice />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Full-length exams (Doc 04A §16, Doc 04C §16.1) — E7b. */}
        <Route path="/tests" component={TestsHomeRoute} />
        <Route path="/tests/:sessionId/report" component={ExamReportRoute} />
        <Route
          path="/tests/:sessionId/:section/:module"
          component={ExamModuleRoute}
        />
        <Route path="/tests/:sessionId" component={ExamSessionRoute} />
        {/*
          SCL-191 — the post-exam score report and retake answer. Student-only, and the path has
          no id in it on purpose: the occasion comes from the prompt the server sent, so there is
          nothing here a caller could point at somebody else's sitting.
        */}
        <Route
          path="/score-report"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/score-report">
                <ScoreReport />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Doc 05F §17.1 — the student's own calendar. */}
        <Route
          path="/calendar"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/calendar">
                <Calendar />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route path="/math-practice">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route path="/reading-writing-practice">
          {() => <Redirect to="/practice" replace />}
        </Route>
        <Route
          path="/mastery"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/mastery">
                <MasteryPage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/upgrade"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/upgrade">
                <UpgradePage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Review vertical — the mistake queue. Same gate as practice. */}
        <Route
          path="/review"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/review">
                <Review />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/review/session/:sessionId"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/review/session/:sessionId">
                <ResumeReview />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* Profile routes - allow all authenticated roles */}
        <Route
          path="/profile"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/profile">
                <ProfileRoute />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* QA2-E: the old Settings address lands on Settings. */}
        <Route path="/settings" component={SettingsRedirect} />
        {/* UI-58 (OQ-46): the Help page; the rail, the avatar menu and the footer land here. */}
        <Route
          path="/help"
          component={() => (
            <RequireRole allow={["student", "admin"]}>
              <StudentRouteFrame route="/help">
                <HelpPage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* G2-04: an under-13 student with no active guardian link lands here. */}
        <Route
          path="/guardian-required"
          component={() => (
            <RequireRole allow={["student"]}>
              <StudentRouteFrame route="/guardian-required">
                <GuardianRequired />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/profile/complete"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/profile/complete">
                <ProfileComplete />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        <Route
          path="/update-password"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/update-password">
                <UpdatePassword />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />
        {/* §40.4 deletion recovery — public (token-gated, no session needed) */}
        <Route path="/account/recover" component={AccountRecoverRoute} />
        <Route
          path="/notifications"
          component={() => (
            <RequireRole allow={["student", "guardian", "admin"]}>
              <StudentRouteFrame route="/notifications">
                <NotificationsPage />
              </StudentRouteFrame>
            </RequireRole>
          )}
        />

        {/* Admin routes — require admin role */}
        <Route
          path="/admin/crisis-review/:id"
          component={() => (
            <RequireRole allow={["admin"]}>
              <CrisisReviewDetail />
            </RequireRole>
          )}
        />
        <Route
          path="/admin/crisis-review"
          component={() => (
            <RequireRole allow={["admin"]}>
              <CrisisReviewList />
            </RequireRole>
          )}
        />

        {/* Guardian routes (G4-01) — one table, guardian role only (G2-01; the server refuses
            admins too). */}
        {GUARDIAN_ROUTES.map(({ path, Page }) => (
          <Route
            key={path}
            path={path}
            component={() => (
              <RequireRole allow={["guardian"]}>
                <Page />
              </RequireRole>
            )}
          />
        ))}

        {/* 404 */}
        <Route component={NotFoundRoute} />
      </Switch>
    </Suspense>
  );
}

/**
 * @spec [Coding Standards §12, §16; student UI vertical UI-10] | @implemented [2026-09-29]
 * plain English: the app-wide render boundary. On a render error it shows fixed copy and a
 * reload button. It never shows the raw `error.message` (which can carry server or
 * developer text) and never writes to the console: the client has no structured logger,
 * and the fallback screen itself is the surfaced failure, so nothing is swallowed.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      // UI-41: the error screen is a Bare card (DESIGN.md §2). BareCard reads no context, so it
      // renders here, above every provider. UI-59: on the student tokens only, so it follows the
      // device theme (the boot script in index.html sets <html data-theme> before any provider).
      return (
        <BareCard>
          <div
            className="flex flex-col items-center"
            data-testid="error-screen"
          >
            <BareCardHeader
              title="Something went wrong"
              description="An unexpected error occurred. Reloading the page usually fixes it."
              align="center"
            />
            <Button
              type="button"
              variant="lyc-primary"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </Button>
          </div>
        </BareCard>
      );
    }

    return this.props.children;
  }
}

/**
 * @spec [Doc-01_V8 §40.3 soft-delete state behaviour] | @implemented 2026-06-21
 * plain English: routes a grace-window (soft-locked) user to the restricted pending-deletion screen —
 * except the recovery page, which must stay reachable. Unauthenticated + non-pending users pass
 * straight through. The server is authoritative (pendingDeletion comes from /api/profile via the auth
 * context + the global deletion lock); this only mirrors that state in the UI.
 */
export function DeletionGate({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const [location] = useLocation();
  if (user?.pendingDeletion && location !== "/account/recover") {
    // UI-41: the pending-deletion screen is a Bare card (DESIGN.md §2). UI-59: on the student
    // tokens only, so it follows the device theme. The screen is lazy since SEO F8: the card
    // draws at once and the screen fills it when its chunk arrives (no full-page loader inside
    // a card).
    return (
      <BareCard>
        <Suspense fallback={null}>
          <PendingDeletionScreen />
        </Suspense>
      </BareCard>
    );
  }
  return <>{children}</>;
}

/**
 * @spec [student-UI register UI-44; §2 Free versus paid; SCL-185; OQ-29; OQ-39(e); DESIGN.md §3]
 * | @implemented [2026-10-03]
 * plain English: the one upgrade modal, mounted once inside the query client so its denial
 * listener sees every query and mutation. It auto-opens on `entitlement_required` for a student
 * only: a guardian's per-student reads answer the same body, and this is the student's modal. A
 * display choice; the server decides every request.
 */
function StudentUpgradeModal({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  return (
    <UpgradeModalProvider autoOpenOnDenial={user?.role === "student"}>
      {children}
    </UpgradeModalProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <QueryClientProvider client={queryClient}>
          <SupabaseAuthProvider>
            <UIProvider>
              {/* F-65: the shell on screen publishes its theme lock here, above the upgrade
                  modal, so the modal's portal matches the page under it. */}
              <ActiveThemeLockProvider>
                <StudentUpgradeModal>
                  <DeletionGate>
                    <Router />
                  </DeletionGate>
                </StudentUpgradeModal>
              </ActiveThemeLockProvider>
              {/* SEO F10/F11: cookie banner + the only switch that starts PostHog (after
                  Accept, never for under-13). Every route, including the deletion screen. */}
              <CookieConsentRoot />
            </UIProvider>
          </SupabaseAuthProvider>
        </QueryClientProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
